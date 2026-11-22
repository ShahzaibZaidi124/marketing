-- ============================================================================
-- NexTech — Secure Owner/Admin access
--   20261122120000_add_owner_access.sql
--
-- REVIEW ARTIFACT — created on disk, NOT executed.
--
-- What this migration does:
--   * §3  adds public.owner_accounts (RLS enabled, NO policies, no client grants)
--   * §4  adds public.is_owner()  (SECURITY DEFINER, owned by postgres, search_path = '')
--   * §5  widens the public.orders.status CHECK constraint to allow 'rejected'
--   * §6  adds four read-only "owner" SELECT policies (permissive, to authenticated)
--
-- What this migration deliberately DOES NOT do:
--   * it never touches public.profiles.role or its protection trigger
--   * it never drops, recreates or alters any existing customer policy
--   * it performs no INSERT / UPDATE / DELETE on any existing table  => no data loss
--   * it does not insert the owner row (that is a separate, explicit step)
--
-- HOW TO RUN (manual, later):
--   1. Run the ENTIRE file as ONE batch (do not paste fragments one IF at a time).
--   2. Run it as the `postgres` role — the Supabase SQL Editor default.
--   3. Afterwards, and only afterwards, insert the owner row separately (see the
--      commented snippet at the very bottom of this file).
-- ============================================================================

begin;

-- ============================================================================
-- §1  Guard A — prerequisites
-- ============================================================================
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception '§1 failed: public.profiles is missing. Apply the NexTech profiles migration first.';
  end if;

  if to_regclass('public.orders') is null then
    raise exception '§1 failed: public.orders is missing. Apply the NexTech client orders migration first.';
  end if;

  if to_regclass('public.services') is null then
    raise exception '§1 failed: public.services is missing. Apply the NexTech service catalog migration first.';
  end if;

  if to_regclass('public.service_packages') is null then
    raise exception '§1 failed: public.service_packages is missing. Apply the NexTech service catalog migration first.';
  end if;

  if to_regprocedure('public.nextech_protect_profile_role()') is null then
    raise exception '§1 failed: public.nextech_protect_profile_role() is missing. Apply the NexTech profile role protection migration first.';
  end if;
end;
$$;

-- ============================================================================
-- §1b  Session-scoped helpers (live only inside pg_temp; never persisted)
-- ============================================================================

drop table if exists pg_temp.expected_customer_policies;

create temporary table pg_temp.expected_customer_policies (
  policy_name text primary key,
  table_name  text not null,
  cmd         text not null,
  roles       text[] not null,
  using_expr  text,
  check_expr  text
) on commit drop;

-- Ground truth, transcribed from the existing NexTech migration files.
--   profiles        -> 20261114214500_profiles.sql            (3 policies)
--   orders          -> 20261115185300_create_client_orders.sql (1 policy)
--   services        -> 20261115192000_create_service_catalog.sql (1 policy)
--   service_packages-> 20261115192000_create_service_catalog.sql (1 policy)
--
-- The expected expressions are written in the form that, after
-- pg_temp.norm_policy_expr(), equals PostgreSQL's deparsed pg_policies text.
-- Policy 6 is stored in its canonical deparsed shape because a sub-SELECT cannot
-- round-trip through the conservative normalizer.
insert into pg_temp.expected_customer_policies
  (policy_name, table_name, cmd, roles, using_expr, check_expr)
values
  ('Users can read their own profile',
   'profiles', 'SELECT', array['authenticated'], 'auth.uid() = id', null),

  ('Users can insert their own profile',
   'profiles', 'INSERT', array['authenticated'], null, 'auth.uid() = id'),

  ('Users can update their own profile',
   'profiles', 'UPDATE', array['authenticated'], 'auth.uid() = id', 'auth.uid() = id'),

  ('Clients can read their own orders',
   'orders', 'SELECT', array['authenticated'], '(select auth.uid()) = client_id', null),

  ('Authenticated users can view active services',
   'services', 'SELECT', array['authenticated'], 'is_active', null),

  ('Authenticated users can view packages for active services',
   'service_packages', 'SELECT', array['authenticated'],
   'is_active AND (EXISTS (SELECT 1 FROM services WHERE ((services.id = service_packages.service_id) AND services.is_active)))',
   null);

-- ----------------------------------------------------------------------------
-- Conservative expression normalizer.
--   * lowercases
--   * strips comments and collapses whitespace
--   * removes ONLY the known `public.` schema prefix
--   * removes ONLY PostgreSQL's generated sub-select aliases (AS uid / AS is_owner)
--   * strips ONLY parentheses that wrap the ENTIRE expression (depth-scanned)
--   * never removes inner parentheses, so logical grouping can never be collapsed
-- ----------------------------------------------------------------------------
create or replace function pg_temp.norm_policy_expr(input text)
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
  v := regexp_replace(v, '/\*([^*]|\*[^/])*\*/', ' ', 'g');   -- block comments
  v := regexp_replace(v, '--[^\n]*', ' ', 'g');               -- line comments
  v := regexp_replace(v, '\s+', ' ', 'g');                    -- collapse whitespace
  v := regexp_replace(v, '\mpublic\.', '', 'g');              -- known schema prefix
  v := regexp_replace(v, 'auth\.uid\(\) as uid', 'auth.uid()', 'g');
  v := regexp_replace(v, 'is_owner\(\) as is_owner', 'is_owner()', 'g');
  v := regexp_replace(v, '\s*\.\s*', '.', 'g');
  v := regexp_replace(v, '\s*,\s*', ',', 'g');
  v := regexp_replace(v, '\(\s+', '(', 'g');
  v := regexp_replace(v, '\s+\)', ')', 'g');
  v := btrim(v);

  -- Strip only parentheses that wrap the whole expression.
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

-- ----------------------------------------------------------------------------
-- Function-body normalizer (whitespace / comments / one trailing semicolon).
-- ----------------------------------------------------------------------------
create or replace function pg_temp.norm_function_body(input text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(input, ''));
begin
  v := regexp_replace(v, '/\*([^*]|\*[^/])*\*/', ' ', 'g');
  v := regexp_replace(v, '--[^\n]*', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := regexp_replace(v, '\(\s+', '(', 'g');
  v := regexp_replace(v, '\s+\)', ')', 'g');
  v := regexp_replace(v, '\s*\.\s*', '.', 'g');
  v := regexp_replace(v, '\s*,\s*', ',', 'g');
  v := btrim(v);

  if right(v, 1) = ';' then
    v := btrim(left(v, char_length(v) - 1));
  end if;

  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- Asserts that all six existing customer policies still exist with byte-for-byte
-- identical semantics. Called by Guard B (§2) and again by §7.7.
-- ----------------------------------------------------------------------------
create or replace function pg_temp.assert_customer_policies()
returns void
language plpgsql
as $$
declare
  v_exp        record;
  v_cmd        text;
  v_roles      text[];
  v_live_using text;
  v_live_check text;
begin
  for v_exp in
    select * from pg_temp.expected_customer_policies
    order by table_name, policy_name
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_live_using, v_live_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = v_exp.table_name
      and p.policyname = v_exp.policy_name;

    if not found then
      raise exception 'Customer policy "%" on public.% is missing.',
        v_exp.policy_name, v_exp.table_name;
    end if;

    if v_cmd <> v_exp.cmd then
      raise exception 'Customer policy "%" changed command: expected %, found %.',
        v_exp.policy_name, v_exp.cmd, v_cmd;
    end if;

    if v_roles <> v_exp.roles then
      raise exception 'Customer policy "%" changed target role: expected %, found %.',
        v_exp.policy_name, v_exp.roles, v_roles;
    end if;

    if pg_temp.norm_policy_expr(v_live_using) is distinct from pg_temp.norm_policy_expr(v_exp.using_expr) then
      raise exception E'Customer policy "%" USING expression changed.\n  expected: %\n  actual  : %',
        v_exp.policy_name,
        pg_temp.norm_policy_expr(v_exp.using_expr),
        pg_temp.norm_policy_expr(v_live_using);
    end if;

    if pg_temp.norm_policy_expr(v_live_check) is distinct from pg_temp.norm_policy_expr(v_exp.check_expr) then
      raise exception E'Customer policy "%" WITH CHECK expression changed.\n  expected: %\n  actual  : %',
        v_exp.policy_name,
        pg_temp.norm_policy_expr(v_exp.check_expr),
        pg_temp.norm_policy_expr(v_live_check);
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §2  Guard B — existing protections must already be in place and unchanged
-- ============================================================================
do $$
declare
  v_tbl text;
begin
  foreach v_tbl in array array[
    'public.profiles',
    'public.orders',
    'public.services',
    'public.service_packages'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      where c.oid = v_tbl::regclass
        and c.relrowsecurity
    ) then
      raise exception '§2 failed: row level security is not enabled on %.', v_tbl;
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§2 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;
end;
$$;

do $$
begin
  perform pg_temp.assert_customer_policies();
end;
$$;

-- ============================================================================
-- §3  public.owner_accounts — the single source of truth for "who is the owner"
-- ============================================================================
create table if not exists public.owner_accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- The SECURITY DEFINER reader (public.is_owner()) runs as the table owner, so the
-- table owner MUST be a role that bypasses RLS (i.e. postgres) once RLS is enabled
-- with no policies. Pin it explicitly, and fail loudly if it cannot be pinned.
do $$
declare
  v_owner name;
begin
  select r.rolname
    into v_owner
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where c.oid = 'public.owner_accounts'::regclass;

  if v_owner is null then
    raise exception '§3 failed: could not resolve the owner of public.owner_accounts.';
  end if;

  if v_owner <> 'postgres' then
    begin
      execute 'alter table public.owner_accounts owner to postgres';
    exception
      when insufficient_privilege then
        raise exception 'Could not transfer ownership of public.owner_accounts from % to postgres. Run this migration as the postgres role; refusing to continue with a table owner that differs from the SECURITY DEFINER function owner.', v_owner;
    end;
  end if;
end;
$$;

alter table public.owner_accounts enable row level security;
-- Deliberately NO policies: with RLS on and no policies, every client role reads 0 rows.
revoke all on public.owner_accounts from public, anon, authenticated;
grant all  on public.owner_accounts to service_role;

-- ============================================================================
-- §4  public.is_owner() — SECURITY DEFINER owner check
-- ============================================================================
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_accounts
    where user_id = (select auth.uid())
  );
$$;

-- The function must be owned by postgres (same role that owns the table), so that
-- SECURITY DEFINER + table ownership both bypass the table's policy-less RLS.
do $$
declare
  v_owner name;
begin
  select r.rolname
    into v_owner
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.is_owner()'::regprocedure;

  if v_owner is null then
    raise exception '§4 failed: could not resolve the owner role of public.is_owner().';
  end if;

  if v_owner <> 'postgres' then
    begin
      execute 'alter function public.is_owner() owner to postgres';
    exception
      when insufficient_privilege then
        raise exception 'Could not transfer ownership of public.is_owner() from % to postgres. Run this migration as the postgres role.', v_owner;
    end;
  end if;
end;
$$;

revoke all on function public.is_owner() from public, anon, authenticated;
grant execute on function public.is_owner() to authenticated, service_role;

-- ============================================================================
-- §5  public.orders.status — allow 'rejected' (superset of the legacy values)
-- ============================================================================
do $$
declare
  v_status_attnum smallint;
  v_count         int := 0;
  v_name          text;
  v_def           text;
  v_validated     boolean;
  v_rec           record;
  v_expected      text := 'CHECK ((status = ANY (ARRAY[''pending''::text, ''active''::text, ''completed''::text])))';
begin
  -- Locate the physical status column, then find CHECK constraints whose conkey
  -- is exactly that column. No name or keyword guessing.
  select a.attnum
    into v_status_attnum
  from pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname  = 'status'
    and a.attnum   > 0
    and not a.attisdropped;

  if v_status_attnum is null then
    raise exception '§5 failed: public.orders.status does not exist. Refusing to guess; aborting.';
  end if;

  for v_rec in
    select con.conname,
           pg_get_constraintdef(con.oid) as condef,
           con.convalidated
    from pg_constraint con
    where con.conrelid = 'public.orders'::regclass
      and con.contype  = 'c'
      and con.conkey   = array[v_status_attnum]
  loop
    v_count     := v_count + 1;
    v_name      := v_rec.conname;
    v_def       := v_rec.condef;
    v_validated := v_rec.convalidated;
  end loop;

  if v_count = 0 then
    raise exception '§5 failed: no CHECK constraint found on public.orders.status. Aborting.';
  end if;

  if v_count > 1 then
    raise exception '§5 failed: % CHECK constraints found on public.orders.status; expected exactly one. Aborting.', v_count;
  end if;

  if v_def <> v_expected then
    raise exception E'§5 failed: public.orders.status CHECK constraint definition has changed.\n  expected: %\n  actual  : %',
      v_expected, v_def;
  end if;

  if not v_validated then
    raise exception '§5 failed: public.orders.status CHECK constraint is not validated. Aborting.';
  end if;

  execute format('alter table public.orders drop constraint %I', v_name);
end;
$$;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'active', 'completed', 'rejected'));

-- ============================================================================
-- §6  Owner read policies (permissive, OR-combined with the customer policies)
-- ============================================================================
-- SELECT records are the only thing the owner gains here. Status changes still go
-- through the service-role Edge Functions, never through the client.
drop policy if exists "Owners can read all orders" on public.orders;
create policy "Owners can read all orders"
  on public.orders for select
  to authenticated
  using ((select public.is_owner()));

drop policy if exists "Owners can read all profiles" on public.profiles;
create policy "Owners can read all profiles"
  on public.profiles for select
  to authenticated
  using ((select public.is_owner()));

drop policy if exists "Owners can read all services" on public.services;
create policy "Owners can read all services"
  on public.services for select
  to authenticated
  using ((select public.is_owner()));

drop policy if exists "Owners can read all service packages" on public.service_packages;
create policy "Owners can read all service packages"
  on public.service_packages for select
  to authenticated
  using ((select public.is_owner()));

-- ============================================================================
-- §7  Postconditions — prove the end state, or roll everything back
-- ============================================================================

-- §7.1  public.is_owner(): exists, SECURITY DEFINER, owned by postgres, empty search_path
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception '§7.1 failed: public.is_owner() does not exist.';
  end if;

  select p.prosecdef,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.is_owner()'::regprocedure;

  v_owner := v_rec.owner;

  if v_owner is null then
    raise exception '§7.1 failed: could not resolve the owner role of public.is_owner() (owner does not map to a role).';
  end if;

  if v_owner <> 'postgres' then
    raise exception '§7.1 failed: public.is_owner() must be owned by postgres, found %.', v_owner;
  end if;

  if not v_rec.prosecdef then
    raise exception '§7.1 failed: public.is_owner() must be SECURITY DEFINER.';
  end if;

  select exists (
    select 1
    from unnest(v_rec.proconfig) as cfg
    where cfg = 'search_path=""'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§7.1 failed: public.is_owner() must set an empty search_path (proconfig element search_path=""). Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;
end;
$$;

-- §7.1b  public.is_owner(): complete normalized-body equality (no alternate auth paths)
do $$
declare
  v_prosrc   text;
  v_norm     text;
  v_expected text := 'select exists (select 1 from public.owner_accounts where user_id = (select auth.uid()))';
begin
  select p.prosrc
    into v_prosrc
  from pg_proc p
  where p.oid = 'public.is_owner()'::regprocedure;

  if v_prosrc is null then
    raise exception '§7.1b failed: could not read the body of public.is_owner().';
  end if;

  v_norm := pg_temp.norm_function_body(v_prosrc);

  if v_norm <> v_expected then
    raise exception E'§7.1b failed: public.is_owner() body does not match the expected definition.\n  expected (normalized): %\n  actual   (normalized): %\n  prosrc: %',
      v_expected, v_norm, v_prosrc;
  end if;
end;
$$;

-- §7.2  public.owner_accounts: locked down and owned by the same role as is_owner()
do $$
declare
  v_rec record;
begin
  if to_regclass('public.owner_accounts') is null then
    raise exception '§7.2 failed: public.owner_accounts does not exist.';
  end if;

  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.owner_accounts'::regclass
      and a.attname  = 'user_id'
      and a.attnum   > 0
      and not a.attisdropped
  ) then
    raise exception '§7.2 failed: public.owner_accounts.user_id is missing.';
  end if;

  select c.relrowsecurity,
         c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.owner_accounts'::regclass;

  if not v_rec.relrowsecurity then
    raise exception '§7.2 failed: row level security is not enabled on public.owner_accounts.';
  end if;

  if v_rec.relforcerowsecurity then
    raise exception '§7.2 failed: FORCE ROW LEVEL SECURITY must NOT be set on public.owner_accounts (it would make is_owner() return false for everyone).';
  end if;

  if v_rec.owner <> 'postgres' then
    raise exception '§7.2 failed: public.owner_accounts must be owned by postgres, found %.', v_rec.owner;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_accounts'
  ) then
    raise exception '§7.2 failed: public.owner_accounts must not have any RLS policies.';
  end if;

  if has_table_privilege('anon', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('anon', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('anon', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('anon', 'public.owner_accounts', 'DELETE') then
    raise exception '§7.2 failed: the anon role must not have any privileges on public.owner_accounts.';
  end if;

  if has_table_privilege('authenticated', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'DELETE') then
    raise exception '§7.2 failed: the authenticated role must not have any privileges on public.owner_accounts.';
  end if;

  if (select c.relowner from pg_class c where c.oid = 'public.owner_accounts'::regclass)
     is distinct from
     (select p.proowner from pg_proc p where p.oid = 'public.is_owner()'::regprocedure) then
    raise exception '§7.2 failed: public.owner_accounts and public.is_owner() must be owned by the same role.';
  end if;
end;
$$;

-- §7.3  profile role-protection trigger intact and enabled
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§7.3 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;
end;
$$;

-- §7.4  the four owner policies exist with exactly (select public.is_owner())
do $$
declare
  v_expected text := '(select public.is_owner())';
  v_pair     record;
  v_cmd      text;
  v_roles    text[];
  v_qual     text;
  v_check    text;
begin
  for v_pair in
    select * from (values
      ('orders',           'Owners can read all orders'),
      ('profiles',         'Owners can read all profiles'),
      ('services',         'Owners can read all services'),
      ('service_packages', 'Owners can read all service packages')
    ) as t(tbl, pol)
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = v_pair.tbl
      and p.policyname = v_pair.pol;

    if not found then
      raise exception '§7.4 failed: owner policy "%" on public.% is missing.', v_pair.pol, v_pair.tbl;
    end if;

    if v_cmd <> 'SELECT' then
      raise exception '§7.4 failed: owner policy "%" must be FOR SELECT, found %.', v_pair.pol, v_cmd;
    end if;

    if v_roles <> array['authenticated'] then
      raise exception '§7.4 failed: owner policy "%" must apply to authenticated, found %.', v_pair.pol, v_roles;
    end if;

    if v_check is not null then
      raise exception '§7.4 failed: owner policy "%" must not have a WITH CHECK clause.', v_pair.pol;
    end if;

    if pg_temp.norm_policy_expr(v_qual) <> pg_temp.norm_policy_expr(v_expected) then
      raise exception E'§7.4 failed: owner policy "%" predicate is not exactly (select public.is_owner()).\n  expected: %\n  actual  : %',
        v_pair.pol,
        pg_temp.norm_policy_expr(v_expected),
        pg_temp.norm_policy_expr(v_qual);
    end if;
  end loop;
end;
$$;

-- §7.5  profile role-protection function must remain SECURITY INVOKER (null-safe)
do $$
begin
  if coalesce(
       (select p.prosecdef
        from pg_proc p
        where p.oid = to_regprocedure('public.nextech_protect_profile_role()')),
       true
     ) then
    raise exception '§7.5 failed: profile role protection must remain SECURITY INVOKER (or the function is missing).';
  end if;
end;
$$;

-- §7.6  orders.status constraint now allows exactly pending/active/completed/rejected
do $$
declare
  v_def       text;
  v_validated boolean;
begin
  select pg_get_constraintdef(con.oid), con.convalidated
    into v_def, v_validated
  from pg_constraint con
  where con.conrelid = 'public.orders'::regclass
    and con.conname  = 'orders_status_check'
    and con.contype  = 'c';

  if v_def is null then
    raise exception '§7.6 failed: constraint orders_status_check is missing on public.orders.';
  end if;

  if v_def <> 'CHECK ((status = ANY (ARRAY[''pending''::text, ''active''::text, ''completed''::text, ''rejected''::text])))' then
    raise exception E'§7.6 failed: orders_status_check does not allow exactly pending/active/completed/rejected.\n  actual: %',
      v_def;
  end if;

  if not v_validated then
    raise exception '§7.6 failed: orders_status_check is not validated.';
  end if;
end;
$$;

-- §7.7  the six existing customer policies are still present and unchanged
do $$
begin
  perform pg_temp.assert_customer_policies();
end;
$$;

-- §7.8  service_role keeps full privileges on public.owner_accounts
do $$
begin
  if not has_table_privilege('service_role', 'public.owner_accounts', 'SELECT')
     or not has_table_privilege('service_role', 'public.owner_accounts', 'INSERT')
     or not has_table_privilege('service_role', 'public.owner_accounts', 'UPDATE')
     or not has_table_privilege('service_role', 'public.owner_accounts', 'DELETE') then
    raise exception '§7.8 failed: service_role must retain full privileges on public.owner_accounts.';
  end if;
end;
$$;

-- §7.9  customer access is unchanged / nothing became publicly readable
do $$
declare
  v_bad text;
begin
  -- no policy on the four tables may target anon or public
  select string_agg(p.tablename || '.' || p.policyname, ', ')
    into v_bad
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('profiles', 'orders', 'services', 'service_packages')
    and p.roles::text[] && array['anon', 'public']::text[];

  if v_bad is not null then
    raise exception '§7.9 failed: unexpected policies exposed to anon/public: %', v_bad;
  end if;

  -- orders must not be readable by anon
  if has_table_privilege('anon', 'public.orders', 'SELECT') then
    raise exception '§7.9 failed: the anon role must not be able to select from public.orders.';
  end if;

  -- exact policy counts: customer policies + exactly one new owner policy each
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 2 then
    raise exception '§7.9 failed: expected exactly 2 policies on public.orders.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 4 then
    raise exception '§7.9 failed: expected exactly 4 policies on public.profiles.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'services') <> 2 then
    raise exception '§7.9 failed: expected exactly 2 policies on public.services.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'service_packages') <> 2 then
    raise exception '§7.9 failed: expected exactly 2 policies on public.service_packages.';
  end if;
end;
$$;

commit;

-- ============================================================================
-- STEP 2 — run SEPARATELY, only AFTER this migration has committed, and only
-- with the owner's real Supabase user UUID. This is intentionally not part of
-- the migration so that no account identifier ever lands in version control.
--
--   insert into public.owner_accounts (user_id, note)
--   values ('<OWNER_USER_UUID>', 'NexTech owner')
--   on conflict (user_id) do nothing;
--
-- Verify afterwards (should return exactly 1):
--   select count(*) from public.owner_accounts;
-- ============================================================================
