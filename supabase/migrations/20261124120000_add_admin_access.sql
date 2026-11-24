-- ============================================================================
-- NexTech — Secure Admin Access application workflow
--   20261124120000_add_admin_access.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261122120000_add_owner_access.sql (already applied).
--
-- What this migration does:
--   §1  fail-closed prerequisite guard: the live owner layer must be intact, and
--       none of this migration's own objects may already exist — they are created,
--       never overwritten
--   §2  public.admin_applications (one *pending* row per applicant, enforced by a
--       partial unique index)
--   §3  public.admin_accounts — the ONLY place an admin grant is recorded
--   §4  public.nextech_set_admin_application_identity() — a BEFORE INSERT trigger
--       that writes applicant_id / email / status from the authenticated JWT, so a
--       browser can never choose who it is applying as. Trusted service-role writes
--       are recognised via the verified JWT role (auth.role()), never current_user
--       (which is always the owner inside a SECURITY DEFINER function)
--   §5  public.is_admin() and public.has_admin_access()
--   §6  public.review_admin_application() — the single approve/reject path,
--       EXECUTE granted to service_role only, re-checks ownership inside the DB
--   §7  grants + RLS: authenticated may only SELECT and INSERT its own pending
--       application; every decision is a service-role write
--   §8  postconditions: any failure rolls the whole transaction back
--
-- What this migration deliberately DOES NOT do:
--   * it never touches public.profiles.role or its protection trigger
--   * it never touches public.owner_accounts (no row, no policy, no grant) — the
--     owner is never granted admin access, the owner already has it
--   * it creates no UPDATE / DELETE policy on admin_applications, so an approved or
--     rejected decision can never be written from a browser
--   * it creates no INSERT / UPDATE / DELETE policy on admin_accounts, so admin
--     membership can only be written by §6 running as the table owner
--
-- HOW TO RUN (manual, later):
--   1. Run the ENTIRE file as ONE batch, as the postgres role.
--   2. Then deploy the review-admin-application Edge Function.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guard — fail closed
-- ============================================================================

-- §1.1  public.is_owner(): the reviewed shape (SECURITY DEFINER, owned by
--       postgres, empty search_path)
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception '§1.1 failed: public.is_owner() is missing. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  select p.prosecdef,
         p.pronargs,
         p.prorettype,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.is_owner()'::regprocedure;

  if v_rec.pronargs <> 0 or v_rec.prorettype <> 'boolean'::regtype then
    raise exception '§1.1 failed: public.is_owner() must be a zero-argument boolean function.';
  end if;

  if not v_rec.prosecdef then
    raise exception '§1.1 failed: public.is_owner() must be SECURITY DEFINER.';
  end if;

  v_owner := v_rec.owner;
  if v_owner is null then
    raise exception '§1.1 failed: could not resolve the owner role of public.is_owner().';
  end if;
  if v_owner <> 'postgres' then
    raise exception '§1.1 failed: public.is_owner() must be owned by postgres, found %.', v_owner;
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§1.1 failed: public.is_owner() must set an empty search_path. Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;
end;
$$;

-- §1.2  public.owner_accounts: locked down, policy-free, and holding the owner
do $$
declare
  v_rec record;
begin
  if to_regclass('public.owner_accounts') is null then
    raise exception '§1.2 failed: public.owner_accounts is missing. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  select c.relrowsecurity,
         c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.owner_accounts'::regclass;

  if not v_rec.relrowsecurity then
    raise exception '§1.2 failed: row level security is not enabled on public.owner_accounts.';
  end if;

  if v_rec.relforcerowsecurity then
    raise exception '§1.2 failed: FORCE ROW LEVEL SECURITY must NOT be set on public.owner_accounts.';
  end if;

  if v_rec.owner <> 'postgres' then
    raise exception '§1.2 failed: public.owner_accounts must be owned by postgres, found %.', v_rec.owner;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_accounts'
  ) then
    raise exception '§1.2 failed: public.owner_accounts must not have any RLS policies.';
  end if;

  if has_table_privilege('authenticated', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'DELETE') then
    raise exception '§1.2 failed: the authenticated role must not have any privileges on public.owner_accounts.';
  end if;

  if (select count(*) from public.owner_accounts) = 0 then
    raise exception '§1.2 failed: public.owner_accounts is empty. Register the NexTech owner account before enabling admin applications.';
  end if;
end;
$$;

-- §1.3  the profile role-protection trigger is intact and enabled
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§1.3 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;
end;
$$;

-- §1.4  this migration's own objects must NOT already exist — it only ever
--       creates them, it never adopts or overwrites an object of unknown shape
do $$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.is_admin()',
    'public.has_admin_access()',
    'public.review_admin_application(uuid,text,uuid,text)',
    'public.nextech_set_admin_application_identity()'
  ];
begin
  if to_regclass('public.admin_applications') is not null then
    raise exception '§1.4 failed: public.admin_applications already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  if to_regclass('public.admin_accounts') is not null then
    raise exception '§1.4 failed: public.admin_accounts already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is not null then
      raise exception '§1.4 failed: % already exists. Inspect it before applying this migration; it will not be replaced.', v_sig;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §2  public.admin_applications
-- ============================================================================
create table public.admin_applications (
  id              uuid primary key default gen_random_uuid(),
  applicant_id    uuid not null references auth.users (id) on delete cascade,
  applicant_name  text not null check (char_length(btrim(applicant_name)) between 1 and 120),
  email           text not null default '' check (char_length(email) <= 320),
  reason          text not null check (char_length(btrim(reason)) between 1 and 2000),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A decision is only ever recorded together with its reviewer: a row can never
  -- be left claiming "approved" without an owner behind it.
  constraint admin_applications_decision_consistent check (
    (status = 'pending'  and reviewed_by is null     and reviewed_at is null)
    or
    (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

-- Prevent duplicate pending applications from the same applicant. A rejected
-- applicant may apply again; only the *pending* row is unique.
create unique index admin_applications_pending_unique_idx
  on public.admin_applications (applicant_id)
  where status = 'pending';

create index admin_applications_status_created_idx
  on public.admin_applications (status, created_at desc);

-- ============================================================================
-- §3  public.admin_accounts — the only record of an admin grant
-- ============================================================================
create table public.admin_accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  note       text check (note is null or char_length(note) <= 500)
);

-- Both tables are read (and, for the review path, written) by SECURITY DEFINER
-- functions. Those run as the table owner, so the owner MUST be a role that
-- bypasses RLS (postgres) once RLS is enabled. Pin it explicitly and fail loudly.
do $$
declare
  v_tbl   text;
  v_owner name;
begin
  foreach v_tbl in array array['public.admin_applications', 'public.admin_accounts'] loop
    select r.rolname
      into v_owner
    from pg_class c
    join pg_roles r on r.oid = c.relowner
    where c.oid = v_tbl::regclass;

    if v_owner is null then
      raise exception '§3 failed: could not resolve the owner of %.', v_tbl;
    end if;

    if v_owner <> 'postgres' then
      begin
        execute format('alter table %s owner to postgres', v_tbl);
      exception
        when insufficient_privilege then
          raise exception 'Could not transfer ownership of % from % to postgres. Run this migration as the postgres role.', v_tbl, v_owner;
      end;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §4  Applicant identity comes from the JWT, never from the request body
-- ============================================================================
-- A browser may send only applicant_name and reason. This BEFORE INSERT trigger
-- overwrites applicant_id, email and status from the verified session, so a forged
-- payload can never apply as somebody else or pre-mark itself approved.
--
-- It is SECURITY DEFINER (owned by postgres) purely so it can read auth.users.email
-- for the caller: auth.uid() still resolves to the calling user, because it reads
-- the request JWT, not the executing role.
--
-- The trusted-writer check must NOT use current_user. Because this function is
-- SECURITY DEFINER, current_user is ALWAYS the owner (postgres) — even for an
-- ordinary browser insert — so a current_user test silently skips the identity
-- derivation below and lets the client choose applicant_id / email / status.
-- Instead it uses auth.role(), which reads the *verified* JWT role claim that
-- PostgREST derives from the signed token and that a browser cannot forge. Only a
-- genuine service-role request may set these columns itself; 'authenticated',
-- 'anon' and a missing JWT all fall through to the derived path, and a missing
-- identity then fails closed.
create or replace function public.nextech_set_admin_application_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_role    text := coalesce((select auth.role()), '');
  v_email   text;
begin
  -- Verified service-role writers (Edge Functions, server jobs) set the columns.
  if v_role = 'service_role' then
    return new;
  end if;

  if v_uid is null then
    raise exception 'An authenticated user is required to apply for admin access.'
      using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  new.applicant_id    := v_uid;
  new.email           := coalesce(v_email, '');
  new.status          := 'pending';
  new.reviewed_by     := null;
  new.reviewed_at     := null;
  new.decision_reason := null;
  new.updated_at      := clock_timestamp();

  return new;
end;
$$;

alter function public.nextech_set_admin_application_identity() owner to postgres;
revoke all on function public.nextech_set_admin_application_identity() from public, anon;
grant execute on function public.nextech_set_admin_application_identity() to authenticated, service_role;

create trigger nextech_set_admin_application_identity
  before insert on public.admin_applications
  for each row
  execute function public.nextech_set_admin_application_identity();

-- ============================================================================
-- §5  public.is_admin() / public.has_admin_access()
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_accounts
    where user_id = (select auth.uid())
  );
$$;

-- The gate the dashboard uses: the owner always has access, and an approved admin
-- has access. It is derived server-side from owner_accounts + admin_accounts and
-- never from anything the client sends.
create or replace function public.has_admin_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner()
      or exists (
           select 1
           from public.admin_accounts
           where user_id = (select auth.uid())
         );
$$;

do $$
declare
  v_sig   text;
  v_sigs  text[] := array['public.is_admin()', 'public.has_admin_access()'];
  v_owner name;
begin
  foreach v_sig in array v_sigs loop
    select r.rolname
      into v_owner
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = v_sig::regprocedure;

    if v_owner is null then
      raise exception '§5 failed: could not resolve the owner role of %.', v_sig;
    end if;

    if v_owner <> 'postgres' then
      begin
        execute format('alter function %s owner to postgres', v_sig);
      exception
        when insufficient_privilege then
          raise exception 'Could not transfer ownership of % from % to postgres. Run this migration as the postgres role.', v_sig, v_owner;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.has_admin_access() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.has_admin_access() to authenticated, service_role;

-- ============================================================================
-- §6  public.review_admin_application() — the only approve/reject path
-- ============================================================================
-- service_role EXECUTE only, so it can never be called from a browser. It re-checks
-- ownership inside the database and refuses a second decision on the same row, so
-- the Edge Function's owner check is defence in depth rather than the only check.
create or replace function public.review_admin_application(
  p_application_id uuid,
  p_decision       text,
  p_reviewer_id    uuid,
  p_reason         text
)
returns public.admin_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app    public.admin_applications;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_application_id is null then
    raise exception 'An application is required.' using errcode = '22023';
  end if;

  if p_reviewer_id is null then
    raise exception 'A reviewer is required.' using errcode = '22023';
  end if;

  if p_decision is distinct from 'approved' and p_decision is distinct from 'rejected' then
    raise exception 'A decision must be either approved or rejected.' using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'The decision reason must be 2,000 characters or fewer.' using errcode = '22023';
  end if;

  -- Only the registered NexTech owner may decide. Checked here, against the
  -- database, regardless of what the caller claims.
  if not exists (select 1 from public.owner_accounts where user_id = p_reviewer_id) then
    raise exception 'Only the NexTech owner can review admin applications.' using errcode = '42501';
  end if;

  -- One row lock per application: two owners (or two clicks) cannot both decide it.
  select * into v_app
  from public.admin_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Application % does not exist.', p_application_id using errcode = 'P0002';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'This application has already been % .', v_app.status using errcode = '22023';
  end if;

  update public.admin_applications
     set status          = p_decision,
         reviewed_by     = p_reviewer_id,
         reviewed_at     = clock_timestamp(),
         decision_reason = v_reason,
         updated_at      = clock_timestamp()
   where id = p_application_id
   returning * into v_app;

  -- Approval is the ONLY way an entry appears in admin_accounts. A rejection never
  -- removes an existing admin either: the two concerns stay independent.
  if p_decision = 'approved' then
    insert into public.admin_accounts (user_id, granted_by, granted_at, note)
    values (
      v_app.applicant_id,
      p_reviewer_id,
      clock_timestamp(),
      'Approved from admin application ' || v_app.id::text
    )
    on conflict (user_id) do update
      set granted_by = excluded.granted_by,
          granted_at = excluded.granted_at,
          note       = excluded.note;
  end if;

  return v_app;
end;
$$;

alter function public.review_admin_application(uuid, text, uuid, text) owner to postgres;
revoke all on function public.review_admin_application(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.review_admin_application(uuid, text, uuid, text) to service_role;

-- ============================================================================
-- §7  Grants + RLS — read/write-your-own-application, decisions are service-role
-- ============================================================================
alter table public.admin_applications enable row level security;
alter table public.admin_accounts     enable row level security;

revoke all on public.admin_applications from public, anon, authenticated;
revoke all on public.admin_accounts     from public, anon, authenticated;
grant select, insert on public.admin_applications to authenticated;
grant select         on public.admin_accounts     to authenticated;
grant all            on public.admin_applications to service_role;
grant all            on public.admin_accounts     to service_role;

-- admin_applications: an applicant can read their own rows and insert their own
-- pending application. There is deliberately no UPDATE or DELETE policy, so a
-- decision can never be written from a browser. The WITH CHECK pins the insert to
-- the caller's own id and to a pending, decision-free row.
create policy "Applicants read their own admin applications"
  on public.admin_applications for select
  to authenticated
  using ((select auth.uid()) = applicant_id);

create policy "Owners read all admin applications"
  on public.admin_applications for select
  to authenticated
  using ((select public.is_owner()));

create policy "Applicants create their own pending admin application"
  on public.admin_applications for insert
  to authenticated
  with check (
    (select auth.uid()) = applicant_id
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and decision_reason is null
  );

-- admin_accounts: an approved admin may read its own grant; the owner may read all.
-- No write policy at all — §6 is the only writer.
create policy "Admins read their own admin account"
  on public.admin_accounts for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owners read all admin accounts"
  on public.admin_accounts for select
  to authenticated
  using ((select public.is_owner()));

-- ============================================================================
-- §8  Postconditions — prove the end state, or roll everything back
-- ============================================================================

-- §8.1  the two tables: ordinary tables, RLS on, owned by postgres
do $$
declare
  v_tbl  text;
  v_rec  record;
begin
  foreach v_tbl in array array['public.admin_applications', 'public.admin_accounts'] loop
    if to_regclass(v_tbl) is null then
      raise exception '§8.1 failed: % does not exist.', v_tbl;
    end if;

    select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
           (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
      into v_rec
    from pg_class c
    where c.oid = v_tbl::regclass;

    if v_rec.relkind <> 'r' then
      raise exception '§8.1 failed: % must be an ordinary table.', v_tbl;
    end if;
    if not v_rec.relrowsecurity then
      raise exception '§8.1 failed: row level security is not enabled on %.', v_tbl;
    end if;
    if v_rec.relforcerowsecurity then
      raise exception '§8.1 failed: FORCE ROW LEVEL SECURITY must not be set on %.', v_tbl;
    end if;
    if v_rec.owner <> 'postgres' then
      raise exception '§8.1 failed: % must be owned by postgres, found %.', v_tbl, v_rec.owner;
    end if;
  end loop;
end;
$$;

-- §8.2  identity trigger present, enabled, SECURITY DEFINER, owned by postgres
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.admin_applications'::regclass
      and tgname = 'nextech_set_admin_application_identity'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§8.2 failed: the admin application identity trigger is missing or disabled.';
  end if;

  select p.prosecdef,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.nextech_set_admin_application_identity()'::regprocedure;

  v_owner := v_rec.owner;

  if v_owner is null then
    raise exception '§8.2 failed: could not resolve the owner role of the identity trigger function.';
  end if;
  if v_owner <> 'postgres' then
    raise exception '§8.2 failed: the identity trigger function must be owned by postgres, found %.', v_owner;
  end if;
  if not v_rec.prosecdef then
    raise exception '§8.2 failed: the identity trigger function must be SECURITY DEFINER.';
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§8.2 failed: the identity trigger function must set an empty search_path.';
  end if;
end;
$$;

-- §8.2b  the identity trigger is proven, not just inspected: its security behaviour
--        is exercised against a throwaway temp table shaped like admin_applications
--        (no FK / no RLS), and the probe is discarded on commit.
create temp table nextech_admin_identity_probe (
  applicant_id    uuid not null,
  applicant_name  text not null,
  email           text not null default '',
  reason          text not null,
  status          text not null default 'pending',
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  decision_reason text,
  updated_at      timestamptz not null default now()
) on commit drop;

create trigger nextech_admin_identity_probe
  before insert on nextech_admin_identity_probe
  for each row execute function public.nextech_set_admin_application_identity();

do $$
declare
  v_def      text := pg_get_functiondef('public.nextech_set_admin_application_identity()'::regprocedure);
  v_uid      uuid := gen_random_uuid();
  v_row      record;
  v_failopen boolean := false;
begin
  -- static: the trusted-writer branch must read the verified JWT role. current_user
  -- would always be the function owner here, so it may not appear at all.
  if v_def ~* '\mcurrent_user\M' then
    raise exception '§8.2b failed: the identity trigger branches on current_user (always the SECURITY DEFINER owner).';
  end if;
  if v_def !~* 'auth\.role\(\)' then
    raise exception '§8.2b failed: the identity trigger does not check the verified JWT role.';
  end if;

  -- 1. ordinary authenticated applicant: spoofed columns must be overwritten
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_uid::text)::text, true);

  insert into nextech_admin_identity_probe
    (applicant_id, applicant_name, email, reason, status, reviewed_by, reviewed_at, decision_reason)
  values
    (gen_random_uuid(), 'Spoofed Applicant', 'spoofed@example.test', 'Let me in.',
     'approved', gen_random_uuid(), now(), 'self-approved')
  returning * into v_row;

  if v_row.applicant_id is distinct from v_uid then
    raise exception '§8.2b failed: applicant_id was not derived from the JWT (got %).', v_row.applicant_id;
  end if;
  if v_row.email <> coalesce((select u.email from auth.users u where u.id = v_uid), '') then
    raise exception '§8.2b failed: email was not derived from the authenticated account (got %).', v_row.email;
  end if;
  if v_row.status <> 'pending'
     or v_row.reviewed_by is not null
     or v_row.reviewed_at is not null
     or v_row.decision_reason is not null then
    raise exception '§8.2b failed: a client-supplied status or decision was trusted.';
  end if;

  -- 2. verified service-role writer: supplied columns are preserved, even when a
  --    JWT subject is present, because the decision must not be derived from it
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role', 'sub', gen_random_uuid()::text)::text, true);

  insert into nextech_admin_identity_probe
    (applicant_id, applicant_name, email, reason, status)
  values
    (v_uid, 'Trusted Writer', 'trusted@example.test', 'Seeded server-side.', 'pending')
  returning * into v_row;

  if v_row.applicant_id is distinct from v_uid then
    raise exception '§8.2b failed: a verified service-role applicant_id was overwritten.';
  end if;
  if v_row.email <> 'trusted@example.test' then
    raise exception '§8.2b failed: a verified service-role email was overwritten (got %).', v_row.email;
  end if;

  -- 3. no verified identity at all: the trigger must fail closed, never pass through
  perform set_config('request.jwt.claims', '', true);

  begin
    insert into nextech_admin_identity_probe
      (applicant_id, applicant_name, email, reason, status)
    values
      (gen_random_uuid(), 'Anonymous', '', 'No JWT present.', 'pending');
  exception
    when insufficient_privilege then v_failopen := true;
  end;

  if not v_failopen then
    raise exception '§8.2b failed: an insert without a verified JWT identity was allowed.';
  end if;

  drop table nextech_admin_identity_probe;
end;
$$;

-- §8.3  is_admin(), has_admin_access(), review_admin_application(): reviewed shape
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.is_admin()',
    'public.has_admin_access()',
    'public.review_admin_application(uuid,text,uuid,text)'
  ];
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception '§8.3 failed: % does not exist.', v_sig;
    end if;

    select p.prosecdef,
           p.prorettype,
           p.proconfig,
           (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
      into v_rec
    from pg_proc p
    where p.oid = v_sig::regprocedure;

    v_owner := v_rec.owner;

    if v_owner is null then
      raise exception '§8.3 failed: could not resolve the owner role of %.', v_sig;
    end if;
    if v_owner <> 'postgres' then
      raise exception '§8.3 failed: % must be owned by postgres, found %.', v_sig, v_owner;
    end if;
    if not v_rec.prosecdef then
      raise exception '§8.3 failed: % must be SECURITY DEFINER.', v_sig;
    end if;

    select exists (
      select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
    ) into v_ok;

    if not coalesce(v_ok, false) then
      raise exception '§8.3 failed: % must set an empty search_path. Actual proconfig: %.',
        v_sig, coalesce(v_rec.proconfig::text, 'NULL');
    end if;
  end loop;
end;
$$;

-- §8.4  grants: authenticated may read + insert applications and read its own
--       admin grant; nothing for anon; full DML for service_role; the review
--       function is service-role only
do $$
declare
  v_priv text;
begin
  if not has_table_privilege('authenticated', 'public.admin_applications', 'SELECT')
     or not has_table_privilege('authenticated', 'public.admin_applications', 'INSERT') then
    raise exception '§8.4 failed: authenticated must be able to SELECT and INSERT public.admin_applications.';
  end if;

  if not has_table_privilege('authenticated', 'public.admin_accounts', 'SELECT') then
    raise exception '§8.4 failed: authenticated must be able to SELECT public.admin_accounts.';
  end if;

  foreach v_priv in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.admin_applications', v_priv) then
      raise exception '§8.4 failed: authenticated must not hold % on public.admin_applications.', v_priv;
    end if;
    if has_table_privilege('authenticated', 'public.admin_accounts', v_priv) then
      raise exception '§8.4 failed: authenticated must not hold % on public.admin_accounts.', v_priv;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.admin_accounts', 'INSERT') then
    raise exception '§8.4 failed: authenticated must not be able to INSERT into public.admin_accounts.';
  end if;

  if has_table_privilege('anon', 'public.admin_applications', 'SELECT')
     or has_table_privilege('anon', 'public.admin_applications', 'INSERT')
     or has_table_privilege('anon', 'public.admin_accounts', 'SELECT') then
    raise exception '§8.4 failed: the anon role must have no privileges on the admin tables.';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.admin_applications', v_priv)
       or not has_table_privilege('service_role', 'public.admin_accounts', v_priv) then
      raise exception '§8.4 failed: service_role must hold % on both admin tables.', v_priv;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.review_admin_application(uuid,text,uuid,text)', 'EXECUTE') then
    raise exception '§8.4 failed: service_role must be able to EXECUTE review_admin_application.';
  end if;

  if has_function_privilege('authenticated', 'public.review_admin_application(uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.review_admin_application(uuid,text,uuid,text)', 'EXECUTE') then
    raise exception '§8.4 failed: review_admin_application must not be executable by authenticated or anon/PUBLIC.';
  end if;

  if not has_function_privilege('authenticated', 'public.has_admin_access()', 'EXECUTE') then
    raise exception '§8.4 failed: authenticated must be able to EXECUTE has_admin_access().';
  end if;

  if has_function_privilege('anon', 'public.has_admin_access()', 'EXECUTE') then
    raise exception '§8.4 failed: has_admin_access() must not be executable by anon or PUBLIC.';
  end if;
end;
$$;

-- §8.5  policies: exactly the five reviewed ones, each with the right command,
--       target role and clause shape
do $$
declare
  v_exp   record;
  v_cmd   text;
  v_roles text[];
  v_qual  text;
  v_check text;
begin
  for v_exp in
    select * from (values
      ('admin_applications', 'Applicants read their own admin applications',         'SELECT', true),
      ('admin_applications', 'Owners read all admin applications',                   'SELECT', true),
      ('admin_applications', 'Applicants create their own pending admin application','INSERT', false),
      ('admin_accounts',     'Admins read their own admin account',                  'SELECT', true),
      ('admin_accounts',     'Owners read all admin accounts',                       'SELECT', true)
    ) as t(tbl, pol, cmd, has_using)
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = v_exp.tbl
      and p.policyname = v_exp.pol;

    if not found then
      raise exception '§8.5 failed: policy "%" on public.% is missing.', v_exp.pol, v_exp.tbl;
    end if;

    if v_cmd <> v_exp.cmd then
      raise exception '§8.5 failed: policy "%" must be FOR %, found %.', v_exp.pol, v_exp.cmd, v_cmd;
    end if;

    if v_roles <> array['authenticated'] then
      raise exception '§8.5 failed: policy "%" must apply to authenticated, found %.', v_exp.pol, v_roles;
    end if;

    if v_exp.has_using then
      if v_qual is null then
        raise exception '§8.5 failed: policy "%" must define a USING expression.', v_exp.pol;
      end if;
      if v_check is not null then
        raise exception '§8.5 failed: policy "%" must not have a WITH CHECK clause.', v_exp.pol;
      end if;
    else
      if v_check is null then
        raise exception '§8.5 failed: policy "%" must define a WITH CHECK clause.', v_exp.pol;
      end if;
      if v_qual is not null then
        raise exception '§8.5 failed: policy "%" must not have a USING clause.', v_exp.pol;
      end if;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename in ('admin_applications', 'admin_accounts')) <> 5 then
    raise exception '§8.5 failed: expected exactly 5 policies across the admin tables, found %.',
      (select count(*) from pg_policies
       where schemaname = 'public' and tablename in ('admin_applications', 'admin_accounts'));
  end if;
end;
$$;

-- §8.5b  pg_temp expression normalizer (never persisted) — same conservative
--        approach as the messaging migration: comments, whitespace, the known
--        `public.` prefix and PostgreSQL's generated sub-select aliases are
--        removed; only parentheses wrapping the WHOLE expression are stripped, so
--        inner grouping can never be collapsed.
create or replace function pg_temp.norm_expr(input text)
returns text
language plpgsql
immutable
as $$
declare
  v       text := lower(coalesce(input, ''));
  v_len   int;
  v_i     int;
  v_depth int;
  v_ch    text;
  v_wraps boolean;
begin
  v := regexp_replace(v, '/\*([^*]|\*[^/])*\*/', ' ', 'g');
  v := regexp_replace(v, '--[^\n]*', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := regexp_replace(v, '\mpublic\.', '', 'g');
  v := regexp_replace(v, 'auth\.uid\(\) as uid', 'auth.uid()', 'g');
  v := regexp_replace(v, 'is_owner\(\) as is_owner', 'is_owner()', 'g');
  v := regexp_replace(v, '\s*\.\s*', '.', 'g');
  v := regexp_replace(v, '\s*,\s*', ',', 'g');
  v := regexp_replace(v, '\(\s+', '(', 'g');
  v := regexp_replace(v, '\s+\)', ')', 'g');
  v := btrim(v);

  loop
    v     := btrim(v);
    v_len := char_length(v);

    if v_len < 2 or left(v, 1) <> '(' or right(v, 1) <> ')' then
      exit;
    end if;

    v_depth := 0;
    v_wraps := true;
    v_i     := 1;

    while v_i <= v_len loop
      v_ch := substr(v, v_i, 1);

      if v_ch = '(' then
        v_depth := v_depth + 1;
      elsif v_ch = ')' then
        v_depth := v_depth - 1;

        if v_depth < 0 then
          v_wraps := false;
          exit;
        end if;

        if v_depth = 0 and v_i < v_len then
          v_wraps := false;
          exit;
        end if;
      end if;

      v_i := v_i + 1;
    end loop;

    if not v_wraps or v_depth <> 0 then
      exit;
    end if;

    v := substr(v, 2, v_len - 2);
  end loop;

  return v;
end;
$$;

do $$
declare
  v_exp  record;
  v_qual text;
begin
  for v_exp in
    select * from (values
      ('admin_applications', 'Applicants read their own admin applications', '(select auth.uid()) = applicant_id'),
      ('admin_applications', 'Owners read all admin applications',           '(select public.is_owner())'),
      ('admin_accounts',     'Admins read their own admin account',          '(select auth.uid()) = user_id'),
      ('admin_accounts',     'Owners read all admin accounts',               '(select public.is_owner())')
    ) as t(tbl, pol, expected_qual)
  loop
    select p.qual into v_qual
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = v_exp.tbl
      and p.policyname = v_exp.pol;

    if pg_temp.norm_expr(v_qual) <> pg_temp.norm_expr(v_exp.expected_qual) then
      raise exception E'§8.5b failed: policy "%" predicate is not the reviewed expression.\n  expected: %\n  actual  : %',
        v_exp.pol,
        pg_temp.norm_expr(v_exp.expected_qual),
        pg_temp.norm_expr(v_qual);
    end if;
  end loop;
end;
$$;

-- §8.5b2  the applicant INSERT policy must pin the caller's id and a pending,
--         decision-free row
do $$
declare
  v_check   text;
  v_compact text;
begin
  select p.with_check into v_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename  = 'admin_applications'
    and p.policyname = 'Applicants create their own pending admin application';

  if v_check is null then
    raise exception '§8.5b2 failed: the applicant INSERT policy has no WITH CHECK clause.';
  end if;

  -- Whitespace-only compaction. Parentheses are deliberately KEPT: the identity
  -- needle below is the function call `auth.uid()`, so stripping parentheses here
  -- (as an earlier revision did) makes that needle impossible to satisfy and
  -- fails §8.5b2 for a correct policy. PostgreSQL renders the sub-select as
  -- "(SELECT auth.uid() AS uid)", and only whitespace differs between rows.
  v_compact := regexp_replace(lower(v_check), '\s', '', 'g');

  if v_compact not like '%auth.uid()%'
     or v_compact not like '%=applicant_id%'
     or v_compact not like '%status=''pending''%'
     or v_compact not like '%reviewed_byisnull%'
     or v_compact not like '%reviewed_atisnull%'
     or v_compact not like '%decision_reasonisnull%' then
    raise exception E'§8.5b2 failed: the applicant INSERT policy does not pin identity and pending state.\n  actual: %',
      v_check;
  end if;
end;
$$;

-- §8.5c  no non-SELECT policy on admin_accounts, and no policy exposed to anon/public
do $$
declare
  v_bad text;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_accounts' and cmd <> 'SELECT'
  ) then
    raise exception '§8.5c failed: public.admin_accounts must not have any non-SELECT policy.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('admin_applications', 'admin_accounts') and cmd <> 'SELECT' and cmd <> 'INSERT'
  ) then
    raise exception '§8.5c failed: the admin tables must not have an UPDATE/DELETE/ALL policy.';
  end if;

  select string_agg(p.tablename || '.' || p.policyname, ', ')
    into v_bad
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('admin_applications', 'admin_accounts')
    and p.roles::text[] && array['anon', 'public']::text[];

  if v_bad is not null then
    raise exception '§8.5c failed: policies exposed to anon/public: %', v_bad;
  end if;
end;
$$;

-- §8.6  the duplicate-pending guard exists and covers exactly the pending rows
do $$
declare
  v_where text;
  v_cols  text[];
begin
  if to_regclass('public.admin_applications_pending_unique_idx') is null then
    raise exception '§8.6 failed: the duplicate-pending index is missing.';
  end if;

  select pg_get_expr(i.indpred, i.indrelid),
         (select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
    into v_where, v_cols
  from pg_index i
  where i.indexrelid = 'public.admin_applications_pending_unique_idx'::regclass;

  if not (select i.indisunique from pg_index i where i.indexrelid = 'public.admin_applications_pending_unique_idx'::regclass) then
    raise exception '§8.6 failed: the duplicate-pending index must be UNIQUE.';
  end if;

  if v_cols <> array['applicant_id'] then
    raise exception '§8.6 failed: the duplicate-pending index must cover exactly (applicant_id), found %.', v_cols;
  end if;

  -- PostgreSQL renders the partial-index predicate with an implicit cast, e.g.
  --   (status = 'pending'::text)
  -- because the literal is coerced to the column type. The cast (and the wrapping
  -- parentheses, whitespace and string quotes) is harmless, so it is normalized
  -- away before comparing against the reviewed predicate. The cast is stripped
  -- first and the result must equal exactly 'status=pending', so a different
  -- value, a negated comparison or any extra condition still fails.
  if regexp_replace(
       regexp_replace(lower(coalesce(v_where, '')), '::\s*[a-z_][a-z0-9_]*', '', 'g'),
       '[\s()'']', '', 'g'
     ) <> 'status=pending' then
    raise exception '§8.6 failed: the duplicate-pending index must be partial on status = pending, found %.', coalesce(v_where, 'NULL');
  end if;
end;
$$;

-- §8.7  preservation: the owner layer, profile role protection and every existing
--       customer/owner policy are untouched
do $$
declare
  v_pair record;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§8.7 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;

  if coalesce(
       (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.nextech_protect_profile_role()')),
       true
     ) then
    raise exception '§8.7 failed: profile role protection must remain SECURITY INVOKER.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_accounts'
  ) then
    raise exception '§8.7 failed: public.owner_accounts must not have gained any RLS policy.';
  end if;

  if has_table_privilege('authenticated', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'DELETE') then
    raise exception '§8.7 failed: the authenticated role must still have no privileges on public.owner_accounts.';
  end if;

  for v_pair in
    select * from (values
      ('profiles',         'Users can read their own profile',                      'SELECT'),
      ('profiles',         'Users can insert their own profile',                    'INSERT'),
      ('profiles',         'Users can update their own profile',                    'UPDATE'),
      ('orders',           'Clients can read their own orders',                     'SELECT'),
      ('services',         'Authenticated users can view active services',          'SELECT'),
      ('service_packages', 'Authenticated users can view packages for active services', 'SELECT'),
      ('orders',           'Owners can read all orders',                            'SELECT'),
      ('profiles',         'Owners can read all profiles',                          'SELECT'),
      ('services',         'Owners can read all services',                          'SELECT'),
      ('service_packages', 'Owners can read all service packages',                  'SELECT'),
      ('conversations',    'Customers read their own conversation',                 'SELECT'),
      ('conversations',    'Owners read all conversations',                         'SELECT'),
      ('messages',         'Customers read their own messages',                     'SELECT'),
      ('messages',         'Owners read all messages',                              'SELECT')
    ) as t(tbl, pol, cmd)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = v_pair.tbl
        and p.policyname = v_pair.pol
    ) then
      raise exception '§8.7 failed: existing policy "%" on public.% is missing.', v_pair.pol, v_pair.tbl;
    end if;

    if (select p.cmd from pg_policies p
        where p.schemaname = 'public' and p.tablename = v_pair.tbl and p.policyname = v_pair.pol) <> v_pair.cmd then
      raise exception '§8.7 failed: existing policy "%" on public.% changed command.', v_pair.pol, v_pair.tbl;
    end if;
  end loop;
end;
$$;

commit;

-- ============================================================================
-- AFTER this migration commits:
--   1. Deploy the review Edge Function (verify_jwt = true):
--        supabase functions deploy review-admin-application
--   2. Sanity check (both rows must show relrowsecurity = true):
--        select relname, relrowsecurity from pg_class
--        where oid in ('public.admin_applications'::regclass,
--                      'public.admin_accounts'::regclass);
--   3. Confirm nobody is an admin yet (should return 0):
--        select count(*) from public.admin_accounts;
-- ============================================================================
