-- ============================================================================
-- NexTech — Customer reports (schema + read/write-safe policies)
--   20261125170000_add_customer_reports.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261122120000_add_owner_access.sql   (public.is_owner(), and the
--             orders status check)                      — already applied
--             20261124120000_add_admin_access.sql      (public.has_admin_access(),
--             the gate the admin read RPCs use)         — already applied
--             20261115185300_create_client_orders.sql  (public.orders)  — applied
--             20261115192000_create_service_catalog.sql(public.services) — applied
--
-- PHASE 1 of the approved Reports & Reviews plan: database schema ONLY.
--   * creates public.reports
--   * a customer may report an ACTIVE SERVICE (public.services.is_active = true)
--     or one of their OWN ORDERS
--   * target_type is limited to 'service' and 'order' (user reports are deferred
--     until provider identities exist — approved reduced scope)
--   * category is one of the fixed values: spam / abuse / fraud / inappropriate
--     / other
--   * the reason is OPTIONAL: it defaults to an empty string and is capped at
--     2,000 characters
--   * report statuses are pending / reviewing / resolved / rejected; the OPEN
--     states are pending and reviewing
--   * a reporter may hold only ONE OPEN report per target; the partial unique
--     index makes a second open report for the same target impossible, while a
--     resolved or rejected report may be filed again
--   * moderation is a later phase; every new report starts 'pending'
--   * reports are PRIVATE for now: only the reporter and the owner can read them.
--   * reporter_id / resolved_by are NULLABLE ON DELETE SET NULL, and the
--     resolution decision is keyed on the resolved_at TIMESTAMP rather than on
--     the resolver identity, so deleting a customer or a moderator anonymises
--     the row without invalidating it and without blocking the account deletion
--
-- What this migration does:
--   §1  fail-closed prerequisite guards: the live owner layer, the target tables
--       (orders, services) and the profile role-protection trigger must be
--       intact; and public.reports must NOT already exist
--   §2  public.reports + its indexes and named constraints
--   §3  the updated_at trigger, and the BEFORE INSERT identity/eligibility trigger
--   §4  grants + RLS: a client may SELECT its own reports and INSERT its own open
--       report; there is NO update/delete policy, so a resolution cannot be
--       written from a browser
--   §5  pg_temp helpers used only by the §6 postconditions
--   §6  postconditions: any failure rolls the whole transaction back
--
-- What this migration deliberately DOES NOT do:
--   * it never touches public.profiles.role or its protection trigger
--   * it never drops, recreates or alters any existing table, policy or function
--   * it creates no UPDATE / DELETE policy, so authenticated users have no way to
--     change a report's status, resolution or content once written
--   * it publishes nothing publicly: there is no policy that lets an arbitrary
--     authenticated user read reports
--   * it creates no resolution/moderation function and no admin directory RPC
--     (later phases / separate migrations)
--
-- HOW TO RUN (manual, later):
--   Run the ENTIRE file as ONE batch, as the postgres role.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guards — fail closed
-- ============================================================================

-- §1.1  public.is_owner(): zero-arg boolean, SECURITY DEFINER, postgres-owned,
--       empty search_path (the owner read policy below depends on it)
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
         p.prorettype,
         p.pronargs,
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
  if v_owner is null or v_owner <> 'postgres' then
    raise exception '§1.1 failed: public.is_owner() must be owned by postgres, found %.', coalesce(v_owner, 'NULL');
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

-- §1.2  public.owner_accounts: locked down, policy-free, holding the owner
do $$
declare
  v_rec record;
begin
  if to_regclass('public.owner_accounts') is null then
    raise exception '§1.2 failed: public.owner_accounts is missing. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.owner_accounts'::regclass;

  if v_rec.relkind <> 'r' then
    raise exception '§1.2 failed: public.owner_accounts must be an ordinary table.';
  end if;
  if not v_rec.relrowsecurity then
    raise exception '§1.2 failed: row level security is not enabled on public.owner_accounts.';
  end if;
  if v_rec.relforcerowsecurity then
    raise exception '§1.2 failed: FORCE ROW LEVEL SECURITY must NOT be set on public.owner_accounts.';
  end if;
  if v_rec.owner <> 'postgres' then
    raise exception '§1.2 failed: public.owner_accounts must be owned by postgres, found %.', v_rec.owner;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') then
    raise exception '§1.2 failed: public.owner_accounts must not have any RLS policies.';
  end if;

  if (select count(*) from public.owner_accounts) = 0 then
    raise exception '§1.2 failed: public.owner_accounts is empty. Register the NexTech owner account before enabling reports.';
  end if;
end;
$$;

-- §1.3  the target tables exist with the columns reports depends on. The
--       services. is_active flag is included here because the §3 identity
--       trigger only allows reporting an ACTIVE service; if the column is
--       missing the migration fails closed rather than creating a trigger that
--       cannot enforce that rule.
do $$
declare
  v_missing text;
begin
  if to_regclass('public.orders') is null then
    raise exception '§1.3 failed: public.orders is missing. Apply 20261115185300_create_client_orders.sql first.';
  end if;

  if to_regclass('public.services') is null then
    raise exception '§1.3 failed: public.services is missing. Apply 20261115192000_create_service_catalog.sql first.';
  end if;

  select string_agg(col, ', ')
    into v_missing
  from (values ('id'), ('client_id'), ('service_name')) as t(col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'orders' and c.column_name = t.col
  );

  if v_missing is not null then
    raise exception '§1.3 failed: public.orders is missing required column(s): %.', v_missing;
  end if;

  select string_agg(col, ', ')
    into v_missing
  from (values ('id'), ('name'), ('is_active')) as t(col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'services' and c.column_name = t.col
  );

  if v_missing is not null then
    raise exception '§1.3 failed: public.services is missing required column(s): %. public.services.is_active is required to enforce that only active services can be reported.', v_missing;
  end if;
end;
$$;

-- §1.4  the profile role-protection trigger is present and enabled
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§1.4 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;
end;
$$;

-- §1.5  this migration only ever creates its own objects; it never adopts or
--       overwrites a pre-existing reports table or function of unknown shape
do $$
declare
  v_sig  text;
  v_sigs text[] := array[
    'public.update_reports_updated_at()',
    'public.nextech_set_report_identity()'
  ];
begin
  if to_regclass('public.reports') is not null then
    raise exception '§1.5 failed: public.reports already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is not null then
      raise exception '§1.5 failed: % already exists. Inspect it before applying this migration; it will not be replaced.', v_sig;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §2  public.reports
-- ============================================================================
-- A reporter may hold only ONE OPEN report per target. The partial unique index
-- (below) enforces that rather than convention, so a duplicate open report for
-- the same target is impossible at the schema level (Postgres 23505), while a
-- resolved/rejected report does not block a later one.
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  -- Set by the §3 BEFORE INSERT trigger from the verified JWT, never by a client.
  -- Nullable with ON DELETE SET NULL so deleting the reporter's auth account
  -- anonymises the report instead of destroying it. The trigger still guarantees
  -- a non-null identity on every new row.
  reporter_id     uuid references auth.users (id) on delete set null,
  -- 'service' | 'order' only. User reports are deferred until provider identities
  -- exist. target_id is a text column so it can hold a service id (text) or an
  -- order id (uuid); target_label is the server-derived display snapshot.
  target_type     text not null,
  target_id       text not null,
  target_label    text not null default '',
  category        text not null,
  -- The reason is OPTIONAL: a report may carry no explanation at all, so it
  -- defaults to an empty string. When supplied it is capped at 2,000 characters
  -- (whitespace-only is allowed and simply stored as-is).
  reason          text not null default '',
  -- A new report always starts 'pending'. The OPEN states are 'pending' and
  -- 'reviewing'; 'resolved' and 'rejected' are the closed states.
  status          text not null default 'pending',
  resolved_by     uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint reports_target_type_check
    check (target_type in ('service', 'order')),
  constraint reports_target_id_length_check
    check (char_length(btrim(target_id)) between 1 and 120),
  constraint reports_target_label_length_check
    check (char_length(target_label) <= 200),
  constraint reports_category_check
    check (category in ('spam', 'abuse', 'fraud', 'inappropriate', 'other')),
  constraint reports_reason_length_check
    check (char_length(reason) <= 2000),
  constraint reports_status_check
    check (status in ('pending', 'reviewing', 'resolved', 'rejected')),
  constraint reports_resolution_note_length_check
    check (resolution_note is null or char_length(resolution_note) <= 2000),
  -- A resolution decision is recorded by its TIMESTAMP, not by the resolver's
  -- identity: resolved_by is ON DELETE SET NULL, so keying this rule on the
  -- identity would make deleting a moderator fail. resolved_at is never nulled,
  -- so the audit trail survives while the resolver identity may be anonymised.
  -- The OPEN states (pending, reviewing) carry no timestamp; the closed states
  -- (resolved, rejected) must both carry one.
  constraint reports_resolution_consistent check (
    (status in ('pending', 'reviewing') and resolved_at is null)
    or
    (status in ('resolved', 'rejected') and resolved_at is not null)
  )
);

create index reports_status_created_idx
  on public.reports (status, created_at desc);

create index reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);

-- One OPEN report per reporter per target. The OPEN states are pending and
-- reviewing; resolved / rejected rows are outside the predicate, so the reporter
-- may file a fresh report once the earlier one is closed.
create unique index reports_one_open_per_target_idx
  on public.reports (reporter_id, target_type, target_id)
  where status in ('pending', 'reviewing');

-- ============================================================================
-- §3  Triggers
-- ============================================================================

-- §3a  updated_at (same convention as orders / reviews / the service catalog)
create function public.update_reports_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.update_reports_updated_at() from public, anon, authenticated;
grant execute on function public.update_reports_updated_at() to service_role;

create trigger reports_set_updated_at
  before update on public.reports
  for each row
  execute function public.update_reports_updated_at();

-- §3b  Identity + eligibility authoring
--
-- A browser may send only target_type, target_id, category and reason (reason is
-- optional). This BEFORE INSERT trigger derives reporter_id / target_label /
-- status / resolution fields from the verified session and the referenced target,
-- so a forged payload can never report as somebody else, report an order the
-- caller does not own, report an inactive service, or pre-mark itself resolved.
--
-- It is SECURITY DEFINER (owned by postgres) so it can read public.services and
-- public.orders regardless of RLS; auth.uid() still resolves to the CALLING user,
-- because auth.uid() reads the verified request JWT, not the executing role.
--
-- The trusted-writer check must NOT use current_user: inside a SECURITY DEFINER
-- function current_user is always the owner (postgres), so a current_user test
-- would silently skip the derivation below. auth.role() reads the *verified* JWT
-- role claim that a browser cannot forge; only a genuine service-role writer may
-- set these columns itself. A missing identity fails closed.
create function public.nextech_set_report_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_role  text := coalesce((select auth.role()), '');
  v_label text;
begin
  -- Verified service-role writers (later resolution/server paths) set the columns.
  if v_role = 'service_role' then
    return new;
  end if;

  if v_uid is null then
    raise exception 'An authenticated customer is required to report a service or an order.'
      using errcode = '42501';
  end if;

  if new.target_type is null or new.target_type not in ('service', 'order') then
    raise exception 'A report must target a service or an order.' using errcode = '22023';
  end if;

  if new.target_id is null or btrim(new.target_id) = '' then
    raise exception 'A report must name the service or order being reported.' using errcode = '22023';
  end if;

  if new.category is null
     or new.category not in ('spam', 'abuse', 'fraud', 'inappropriate', 'other') then
    raise exception 'Choose a valid report category.' using errcode = '22023';
  end if;

  if new.target_type = 'service' then
    -- Only an ACTIVE service may be reported. A missing service, or one that is
    -- no longer active, is rejected identically. The §1.3 guard already proved
    -- services.is_active exists, so this rule is always enforceable.
    select s.name
      into v_label
    from public.services s
    where s.id = new.target_id
      and s.is_active;

    if not found then
      raise exception 'The service being reported does not exist or is not active.' using errcode = '22023';
    end if;
  else
    -- The order id arrives as text. Validate that it is a well-formed UUID BEFORE
    -- the cast, so a malformed id yields a clear, uniform 22023 instead of a raw
    -- invalid_text_representation cast error (which would also expose the
    -- internal column type). Only a validated id is then cast.
    if new.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'The order being reported does not exist.' using errcode = '22023';
    end if;

    -- Only the caller's own orders may be reported; a missing order and an order
    -- that belongs to somebody else are reported identically, so the response
    -- never reveals whether an order id exists.
    select o.service_name
      into v_label
    from public.orders o
    where o.id = new.target_id::uuid
      and o.client_id = v_uid;

    if not found then
      raise exception 'You can only report your own orders.' using errcode = '42501';
    end if;
  end if;

  new.reporter_id     := v_uid;
  new.target_label    := coalesce(v_label, '');
  new.status          := 'pending';
  new.resolved_by     := null;
  new.resolved_at     := null;
  new.resolution_note := null;
  new.updated_at      := clock_timestamp();

  return new;
end;
$$;

alter function public.nextech_set_report_identity() owner to postgres;
revoke all on function public.nextech_set_report_identity() from public, anon;
grant execute on function public.nextech_set_report_identity() to authenticated, service_role;

create trigger nextech_set_report_identity
  before insert on public.reports
  for each row
  execute function public.nextech_set_report_identity();

-- ============================================================================
-- §4  Grants + RLS — read/write-your-own report, resolution is service-role only
-- ============================================================================
alter table public.reports enable row level security;

revoke all on public.reports from public, anon, authenticated;
grant select, insert on public.reports to authenticated;
grant all            on public.reports to service_role;

-- A reporter reads its own reports; the owner reads every report.
create policy "Reporters read their own reports"
  on public.reports for select
  to authenticated
  using ((select auth.uid()) = reporter_id);

create policy "Owners read all reports"
  on public.reports for select
  to authenticated
  using ((select public.is_owner()));

-- A reporter may create only its own, still-open report (pending or reviewing).
-- There is deliberately NO update or delete policy, so once written a report
-- cannot be changed from a browser; resolution is a later, service-role-only
-- phase.
create policy "Reporters create their own open report"
  on public.reports for insert
  to authenticated
  with check (
    (select auth.uid()) = reporter_id
    and status in ('pending', 'reviewing')
    and resolved_by is null
    and resolved_at is null
    and resolution_note is null
  );

-- ============================================================================
-- §5  Session-scoped helpers (live only in pg_temp; never persisted)
-- ============================================================================
create or replace function pg_temp.norm_sql(input text)
returns text
language sql
immutable
as $$
  select btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(input, '')), '/\*([^*]|\*[^/])*\*/', ' ', 'g'),
               '--[^\n]*', ' ', 'g'),
             '\s+', ' ', 'g'));
$$;

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

-- ============================================================================
-- §6  Postconditions — prove the end state, or roll everything back
-- ============================================================================

-- §6.1  the reports table: ordinary table, RLS on, not forced, owned by postgres
do $$
declare
  v_rec record;
begin
  if to_regclass('public.reports') is null then
    raise exception '§6.1 failed: public.reports does not exist.';
  end if;

  select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.reports'::regclass;

  if v_rec.relkind <> 'r' then
    raise exception '§6.1 failed: public.reports must be an ordinary table.';
  end if;
  if not v_rec.relrowsecurity then
    raise exception '§6.1 failed: row level security is not enabled on public.reports.';
  end if;
  if v_rec.relforcerowsecurity then
    raise exception '§6.1 failed: FORCE ROW LEVEL SECURITY must not be set on public.reports.';
  end if;
  if v_rec.owner <> 'postgres' then
    raise exception '§6.1 failed: public.reports must be owned by postgres, found %.', v_rec.owner;
  end if;
end;
$$;

-- §6.2  columns exist with the intended nullability
do $$
declare
  v_col  text;
  v_null text;
begin
  for v_col in
    select * from unnest(array['id','reporter_id','target_type','target_id','target_label','category','reason','status','resolved_by','resolved_at','resolution_note','created_at','updated_at'])
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'reports' and c.column_name = v_col
    ) then
      raise exception '§6.2 failed: public.reports is missing column %.', v_col;
    end if;
  end loop;

  -- the reporter-written columns must be NOT NULL (reporter_id is intentionally
  -- excluded: it is nullable ON DELETE SET NULL so an account deletion anonymises
  -- the report instead of failing)
  for v_col in select * from unnest(array['target_type','target_id','target_label','category','reason','status','created_at','updated_at']) loop
    select c.is_nullable into v_null
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'reports' and c.column_name = v_col;

    if v_null <> 'NO' then
      raise exception '§6.2 failed: public.reports.% must be NOT NULL.', v_col;
    end if;
  end loop;

  -- the anonymisable identities must be NULLABLE so ON DELETE SET NULL can succeed
  for v_col in select * from unnest(array['reporter_id','resolved_by']) loop
    select c.is_nullable into v_null
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'reports' and c.column_name = v_col;

    if v_null <> 'YES' then
      raise exception '§6.2 failed: public.reports.% must be nullable (ON DELETE SET NULL).', v_col;
    end if;
  end loop;
end;
$$;

-- §6.3  constraints: valid target/category/status/reason, FK SET NULL for the
--       reporter and the resolver, and the resolution rule keyed on the
--       timestamp (not the resolver identity)
do $$
declare
  v_rec record;
  v_def text;
begin
  -- reporter foreign key, SET NULL
  select con.contype, con.confrelid, con.confdeltype
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.reports'::regclass and con.conname = 'reports_reporter_id_fkey';

  if not found then
    raise exception '§6.3 failed: constraint reports_reporter_id_fkey is missing on public.reports.';
  end if;
  if v_rec.contype <> 'f' then
    raise exception '§6.3 failed: reports_reporter_id_fkey must be a FOREIGN KEY.';
  end if;
  if v_rec.confrelid <> 'auth.users'::regclass then
    raise exception '§6.3 failed: reports_reporter_id_fkey must reference auth.users.';
  end if;
  if v_rec.confdeltype <> 'n' then
    raise exception '§6.3 failed: reports_reporter_id_fkey must be ON DELETE SET NULL.';
  end if;

  -- resolver foreign key, SET NULL
  select con.contype, con.confrelid, con.confdeltype
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.reports'::regclass and con.conname = 'reports_resolved_by_fkey';

  if not found then
    raise exception '§6.3 failed: constraint reports_resolved_by_fkey is missing on public.reports.';
  end if;
  if v_rec.contype <> 'f' then
    raise exception '§6.3 failed: reports_resolved_by_fkey must be a FOREIGN KEY.';
  end if;
  if v_rec.confrelid <> 'auth.users'::regclass then
    raise exception '§6.3 failed: reports_resolved_by_fkey must reference auth.users.';
  end if;
  if v_rec.confdeltype <> 'n' then
    raise exception '§6.3 failed: reports_resolved_by_fkey must be ON DELETE SET NULL.';
  end if;

  -- check constraints present and validated
  for v_rec in
    select * from unnest(array[
      'reports_target_type_check',
      'reports_target_id_length_check',
      'reports_target_label_length_check',
      'reports_category_check',
      'reports_reason_length_check',
      'reports_status_check',
      'reports_resolution_note_length_check',
      'reports_resolution_consistent'
    ]) as t(name)
  loop
    if not exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.reports'::regclass and con.conname = v_rec.name and con.contype = 'c'
    ) then
      raise exception '§6.3 failed: CHECK constraint % is missing on public.reports.', v_rec.name;
    end if;

    if not (select con.convalidated from pg_constraint con
            where con.conrelid = 'public.reports'::regclass and con.conname = v_rec.name) then
      raise exception '§6.3 failed: CHECK constraint % is not validated.', v_rec.name;
    end if;
  end loop;

  -- the resolution rule must key the decision on the resolved_at timestamp and
  -- must never reference resolved_by (which is ON DELETE SET NULL), otherwise
  -- deleting a resolver would violate it
  select pg_temp.norm_sql(pg_get_constraintdef(con.oid))
    into v_def
  from pg_constraint con
  where con.conrelid = 'public.reports'::regclass and con.conname = 'reports_resolution_consistent';

  if v_def is null then
    raise exception '§6.3 failed: could not read reports_resolution_consistent.';
  end if;

  if v_def like '%resolved_by%' then
    raise exception '§6.3 failed: reports_resolution_consistent must not reference resolved_by.';
  end if;

  if v_def not like '%resolved_at%' then
    raise exception '§6.3 failed: reports_resolution_consistent must key the decision on resolved_at.';
  end if;
end;
$$;

-- §6.4  the indexes exist, and the one-open-report guard is a partial UNIQUE index
--       covering exactly (reporter_id, target_type, target_id) on the OPEN states
--       (status in ('pending', 'reviewing'))
do $$
declare
  v_where text;
  v_cols  text[];
  v_pred  text;
begin
  if to_regclass('public.reports_status_created_idx') is null then
    raise exception '§6.4 failed: index reports_status_created_idx is missing.';
  end if;
  if to_regclass('public.reports_reporter_created_idx') is null then
    raise exception '§6.4 failed: index reports_reporter_created_idx is missing.';
  end if;
  if to_regclass('public.reports_one_open_per_target_idx') is null then
    raise exception '§6.4 failed: index reports_one_open_per_target_idx is missing.';
  end if;

  if not (select i.indisunique from pg_index i where i.indexrelid = 'public.reports_one_open_per_target_idx'::regclass) then
    raise exception '§6.4 failed: reports_one_open_per_target_idx must be UNIQUE.';
  end if;

  select pg_get_expr(i.indpred, i.indrelid),
         (select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
    into v_where, v_cols
  from pg_index i
  where i.indexrelid = 'public.reports_one_open_per_target_idx'::regclass;

  if v_cols <> array['reporter_id', 'target_type', 'target_id'] then
    raise exception '§6.4 failed: reports_one_open_per_target_idx must cover exactly (reporter_id, target_type, target_id), found %.', v_cols;
  end if;

  -- PostgreSQL renders the partial-index predicate with implicit casts and may
  -- render status IN (...) in any of these equivalent shapes:
  --   (status = ANY (ARRAY['pending'::text, 'reviewing'::text]))
  --   (status = ANY ('{pending,reviewing}'::text[]))
  --   ((status = 'pending'::text) OR (status = 'reviewing'::text))
  -- The casts, parentheses, whitespace, quotes and punctuation are normalized
  -- away so the predicate is compared on its tokens alone. Only the equivalent
  -- normalized forms below are accepted, so a single-status predicate, an extra
  -- condition, or a resolved/rejected status still fails.
  v_pred := lower(coalesce(v_where, ''));
  v_pred := regexp_replace(v_pred, '::\s*[a-z_][a-z0-9_]*', '', 'g');
  v_pred := regexp_replace(v_pred, '[^a-z0-9]', '', 'g');

  if v_pred not in (
       'statusanyarraypendingreviewing',
       'statusanypendingreviewing',
       'statuspendingstatusreviewing'
     ) then
    raise exception '§6.4 failed: reports_one_open_per_target_idx must be partial on status in (pending, reviewing), found %.', coalesce(v_where, 'NULL');
  end if;
end;
$$;

-- §6.5  triggers: updated_at present; the identity trigger present, enabled,
--       SECURITY DEFINER, postgres-owned, empty search_path
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reports'::regclass
      and tgname = 'reports_set_updated_at'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§6.5 failed: the reports updated_at trigger is missing or disabled.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reports'::regclass
      and tgname = 'nextech_set_report_identity'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§6.5 failed: the reports identity trigger is missing or disabled.';
  end if;

  select p.prosecdef,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.nextech_set_report_identity()'::regprocedure;

  v_owner := v_rec.owner;

  if v_owner is null or v_owner <> 'postgres' then
    raise exception '§6.5 failed: the identity trigger function must be owned by postgres, found %.', coalesce(v_owner, 'NULL');
  end if;
  if not v_rec.prosecdef then
    raise exception '§6.5 failed: the identity trigger function must be SECURITY DEFINER.';
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§6.5 failed: the identity trigger function must set an empty search_path.';
  end if;
end;
$$;

-- §6.6  the identity trigger body enforces the eligibility rules (static proof)
do $$
declare
  v_def  text;
  v_norm text;
begin
  select p.prosrc into v_def
  from pg_proc p
  where p.oid = 'public.nextech_set_report_identity()'::regprocedure;

  if v_def is null then
    raise exception '§6.6 failed: could not read the identity trigger body.';
  end if;

  v_norm := pg_temp.norm_sql(v_def);

  if v_norm ~* '\mcurrent_user\M' then
    raise exception '§6.6 failed: the identity trigger branches on current_user (always the SECURITY DEFINER owner).';
  end if;

  if v_norm not like '%auth.role()%' then
    raise exception '§6.6 failed: the identity trigger does not check the verified JWT role.';
  end if;

  if v_norm not like '%auth.uid()%' then
    raise exception '§6.6 failed: the identity trigger does not derive identity from auth.uid().';
  end if;

  if v_norm not like '%from public.services%' then
    raise exception '§6.6 failed: the identity trigger does not resolve a reported service from public.services.';
  end if;

  if v_norm not like '%from public.orders%' then
    raise exception '§6.6 failed: the identity trigger does not resolve a reported order from public.orders.';
  end if;

  if v_norm not like '%client_id%' then
    raise exception '§6.6 failed: the identity trigger does not check order ownership (client_id).';
  end if;

  if v_norm not like '%errcode = ''42501''%' then
    raise exception '§6.6 failed: the identity trigger must reject unauthorized callers with SQLSTATE 42501.';
  end if;

  if v_norm not like '%is_active%' then
    raise exception '§6.6 failed: the identity trigger must restrict service reports to active services (is_active).';
  end if;

  if v_norm not like '%''pending''%' then
    raise exception '§6.6 failed: the identity trigger must force a new report to pending.';
  end if;
end;
$$;

-- §6.7  policies: exactly the three reviewed ones, on authenticated only, with the
--       intended commands and predicates; no write-other-than-insert policy
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
      ('Reporters read their own reports', 'SELECT', '(select auth.uid()) = reporter_id'),
      ('Owners read all reports',          'SELECT', '(select public.is_owner())'),
      ('Reporters create their own open report', 'INSERT', null)
    ) as t(pol, cmd, expected_qual)
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'reports' and p.policyname = v_exp.pol;

    if not found then
      raise exception '§6.7 failed: policy "%" on public.reports is missing.', v_exp.pol;
    end if;

    if v_cmd <> v_exp.cmd then
      raise exception '§6.7 failed: policy "%" must be FOR %, found %.', v_exp.pol, v_exp.cmd, v_cmd;
    end if;

    if v_roles <> array['authenticated'] then
      raise exception '§6.7 failed: policy "%" must apply to authenticated, found %.', v_exp.pol, v_roles;
    end if;

    if v_exp.cmd = 'SELECT' then
      if v_check is not null then
        raise exception '§6.7 failed: policy "%" must not have a WITH CHECK clause.', v_exp.pol;
      end if;
      if pg_temp.norm_expr(v_qual) <> pg_temp.norm_expr(v_exp.expected_qual) then
        raise exception E'§6.7 failed: policy "%" predicate is not the reviewed expression.\n  expected: %\n  actual  : %',
          v_exp.pol, pg_temp.norm_expr(v_exp.expected_qual), pg_temp.norm_expr(v_qual);
      end if;
    else
      if v_qual is not null then
        raise exception '§6.7 failed: policy "%" must not have a USING clause.', v_exp.pol;
      end if;
      if v_check is null then
        raise exception '§6.7 failed: policy "%" must define a WITH CHECK clause.', v_exp.pol;
      end if;
    end if;
  end loop;

  -- the INSERT policy's WITH CHECK must pin identity + an OPEN state (pending or
  -- reviewing) + being decision-free. The status IN (...) list may render as a
  -- ScalarArrayOp or an OR chain with implicit casts, so the cast is stripped and
  -- the predicate is then tokenized to letters/digits; both exact normalized forms
  -- are accepted, and any other status set (or an extra condition) fails.
  select regexp_replace(
           regexp_replace(lower(p.with_check), '::\s*[a-z_][a-z0-9_]*', '', 'g'),
           '[^a-z0-9]', '', 'g')
    into v_check
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'reports'
    and p.policyname = 'Reporters create their own open report';

  if v_check not like '%authuid%'
     or v_check not like '%reporterid%'
     or (v_check not like '%statusanyarraypendingreviewing%'
         and v_check not like '%statusanypendingreviewing%'
         and v_check not like '%statuspendingstatusreviewing%')
     or v_check not like '%resolvedbyisnull%'
     or v_check not like '%resolvedatisnull%'
     or v_check not like '%resolutionnoteisnull%' then
    raise exception E'§6.7 failed: the reporter INSERT policy does not pin identity and the pending/reviewing open state.\n  actual: %', v_check;
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'reports') <> 3 then
    raise exception '§6.7 failed: expected exactly 3 policies on public.reports, found %.',
      (select count(*) from pg_policies where schemaname = 'public' and tablename = 'reports');
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reports'
      and cmd not in ('SELECT', 'INSERT')
  ) then
    raise exception '§6.7 failed: public.reports must not have an UPDATE/DELETE/ALL policy.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reports'
      and roles::text[] && array['anon', 'public']::text[]
  ) then
    raise exception '§6.7 failed: a public.reports policy is exposed to anon/public.';
  end if;
end;
$$;

-- §6.8  grants: read+insert for authenticated, nothing for anon, full DML for
--       service_role; the identity function is authenticated+service_role, the
--       updated_at function is service_role only
do $$
declare
  v_priv text;
begin
  if not has_table_privilege('authenticated', 'public.reports', 'SELECT')
     or not has_table_privilege('authenticated', 'public.reports', 'INSERT') then
    raise exception '§6.8 failed: authenticated must be able to SELECT and INSERT public.reports.';
  end if;

  foreach v_priv in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.reports', v_priv) then
      raise exception '§6.8 failed: authenticated must not hold % on public.reports.', v_priv;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.reports', 'SELECT')
     or has_table_privilege('anon', 'public.reports', 'INSERT')
     or has_table_privilege('anon', 'public.reports', 'UPDATE')
     or has_table_privilege('anon', 'public.reports', 'DELETE') then
    raise exception '§6.8 failed: the anon role must have no privileges on public.reports.';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.reports', v_priv) then
      raise exception '§6.8 failed: service_role must hold % on public.reports.', v_priv;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.nextech_set_report_identity()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.nextech_set_report_identity()', 'EXECUTE') then
    raise exception '§6.8 failed: the identity trigger function must be executable by authenticated and service_role.';
  end if;

  if has_function_privilege('anon', 'public.nextech_set_report_identity()', 'EXECUTE') then
    raise exception '§6.8 failed: the identity trigger function must not be executable by anon/PUBLIC.';
  end if;

  if not has_function_privilege('service_role', 'public.update_reports_updated_at()', 'EXECUTE') then
    raise exception '§6.8 failed: the updated_at trigger function must be executable by service_role.';
  end if;

  if has_function_privilege('authenticated', 'public.update_reports_updated_at()', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_reports_updated_at()', 'EXECUTE') then
    raise exception '§6.8 failed: the updated_at trigger function must not be executable by authenticated or anon/PUBLIC.';
  end if;
end;
$$;

-- §6.9  preservation: profile role protection untouched; owner_accounts still
--       policy-free; existing policies and their table counts unchanged
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
    raise exception '§6.9 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;

  if coalesce(
       (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.nextech_protect_profile_role()')),
       true
     ) then
    raise exception '§6.9 failed: profile role protection must remain SECURITY INVOKER.';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') then
    raise exception '§6.9 failed: public.owner_accounts must not have gained any RLS policy.';
  end if;

  for v_pair in
    select * from (values
      ('profiles',         'Users can read their own profile',                          'SELECT'),
      ('profiles',         'Users can insert their own profile',                        'INSERT'),
      ('profiles',         'Users can update their own profile',                        'UPDATE'),
      ('orders',           'Clients can read their own orders',                         'SELECT'),
      ('services',         'Authenticated users can view active services',              'SELECT'),
      ('service_packages', 'Authenticated users can view packages for active services', 'SELECT'),
      ('orders',           'Owners can read all orders',                                'SELECT'),
      ('profiles',         'Owners can read all profiles',                              'SELECT'),
      ('services',         'Owners can read all services',                              'SELECT'),
      ('service_packages', 'Owners can read all service packages',                      'SELECT'),
      ('conversations',    'Customers read their own conversation',                     'SELECT'),
      ('conversations',    'Owners read all conversations',                             'SELECT'),
      ('messages',         'Customers read their own messages',                         'SELECT'),
      ('messages',         'Owners read all messages',                                  'SELECT'),
      ('reviews',          'Reviewers read their own reviews',                          'SELECT'),
      ('reviews',          'Owners read all reviews',                                   'SELECT')
    ) as t(tbl, pol, cmd)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = v_pair.tbl and p.policyname = v_pair.pol
    ) then
      raise exception '§6.9 failed: existing policy "%" on public.% is missing.', v_pair.pol, v_pair.tbl;
    end if;

    if (select p.cmd from pg_policies p
        where p.schemaname = 'public' and p.tablename = v_pair.tbl and p.policyname = v_pair.pol) <> v_pair.cmd then
      raise exception '§6.9 failed: existing policy "%" on public.% changed command.', v_pair.pol, v_pair.tbl;
    end if;
  end loop;

  -- absolute policy counts for the already-reviewed tables must be unchanged
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 2 then
    raise exception '§6.9 failed: the number of policies on public.orders changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 4 then
    raise exception '§6.9 failed: the number of policies on public.profiles changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'services') <> 2 then
    raise exception '§6.9 failed: the number of policies on public.services changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'service_packages') <> 2 then
    raise exception '§6.9 failed: the number of policies on public.service_packages changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'conversations') <> 2 then
    raise exception '§6.9 failed: the number of policies on public.conversations changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'messages') <> 2 then
    raise exception '§6.9 failed: the number of policies on public.messages changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_applications') <> 3 then
    raise exception '§6.9 failed: the number of policies on public.admin_applications changed.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_accounts') <> 2 then
    raise exception '§6.9 failed: the number of policies on public.admin_accounts changed.';
  end if;
end;
$$;

-- §6.10  account-deletion safety: deleting a reporter's or a resolver's auth
--        account must ANONYMISE the report, never fail and never destroy the row
do $$
declare
  v_reporter_nullable text;
  v_resolver_nullable text;
  v_reporter_action   text;
  v_resolver_action   text;
  v_rule              text;
begin
  select c.is_nullable into v_reporter_nullable
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'reports' and c.column_name = 'reporter_id';

  select c.is_nullable into v_resolver_nullable
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'reports' and c.column_name = 'resolved_by';

  if v_reporter_nullable <> 'YES' or v_resolver_nullable <> 'YES' then
    raise exception '§6.10 failed: reporter_id and resolved_by must both be nullable so ON DELETE SET NULL can succeed.';
  end if;

  select con.confdeltype into v_reporter_action
  from pg_constraint con
  where con.conrelid = 'public.reports'::regclass and con.conname = 'reports_reporter_id_fkey' and con.contype = 'f';

  if v_reporter_action <> 'n' then
    raise exception '§6.10 failed: reports_reporter_id_fkey must be ON DELETE SET NULL.';
  end if;

  select con.confdeltype into v_resolver_action
  from pg_constraint con
  where con.conrelid = 'public.reports'::regclass and con.conname = 'reports_resolved_by_fkey' and con.contype = 'f';

  if v_resolver_action <> 'n' then
    raise exception '§6.10 failed: reports_resolved_by_fkey must be ON DELETE SET NULL.';
  end if;

  select pg_get_constraintdef(con.oid) into v_rule
  from pg_constraint con
  where con.conrelid = 'public.reports'::regclass and con.conname = 'reports_resolution_consistent';

  if v_rule like '%resolved_by%' then
    raise exception '§6.10 failed: the resolution rule must not depend on resolved_by, or deleting a resolver would fail.';
  end if;
end;
$$;

commit;
