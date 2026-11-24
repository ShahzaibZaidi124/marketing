-- ============================================================================
-- NexTech — Read-only Admin Overview RPC
--   20261125120000_add_admin_overview.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261124120000_add_admin_access.sql (already applied).
--
-- WHY THIS EXISTS
--   The Admin Overview must show real counts (customers, published services,
--   pending orders, total orders) and the most recent orders. An approved admin
--   has NO row level security read access to public.profiles or public.orders —
--   only the owner does. So the read has to happen on the server.
--
--   This migration therefore adds ONE read-only RPC, public.admin_overview():
--     * it is SECURITY DEFINER, owned by postgres, with an empty search_path, so
--       it reads the real rows the way the owner would — WITHOUT granting an
--       admin any new table access and WITHOUT the service-role key ever
--       reaching the browser;
--     * it authorizes the caller with public.has_admin_access() (owner OR
--       approved admin) and raises SQLSTATE 42501 for anyone else;
--     * it returns ONLY the approved aggregates and up to five recent orders,
--       with NO customer personal information.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * it never touches public.owner_accounts or public.admin_accounts
--   * it never touches public.profiles.role or its protection trigger
--   * it creates, drops or alters NO RLS policy, NO table and NO other function
--   * it performs no INSERT / UPDATE / DELETE anywhere  => read-only, no data loss
--   * it never grants EXECUTE to anon or public
--
-- HOW TO RUN (manual, later)
--   Run the ENTIRE file as ONE batch, as the postgres role.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guard — fail closed
-- ============================================================================
-- The gate function must already exist and must be the reviewed shape. If the
-- admin access layer is missing, abort rather than create an unguarded reader.
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.has_admin_access()') is null then
    raise exception '§1 failed: public.has_admin_access() is missing. Apply 20261124120000_add_admin_access.sql first.';
  end if;

  select p.prosecdef,
         p.pronargs,
         p.prorettype,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.has_admin_access()'::regprocedure;

  if v_rec.pronargs <> 0 or v_rec.prorettype <> 'boolean'::regtype then
    raise exception '§1 failed: public.has_admin_access() must be a zero-argument boolean function.';
  end if;

  if not v_rec.prosecdef then
    raise exception '§1 failed: public.has_admin_access() must be SECURITY DEFINER.';
  end if;

  v_owner := v_rec.owner;
  if v_owner is null or v_owner <> 'postgres' then
    raise exception '§1 failed: public.has_admin_access() must be owned by postgres, found %.', coalesce(v_owner, 'NULL');
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§1 failed: public.has_admin_access() must set an empty search_path. Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;

  if to_regclass('public.profiles') is null
     or to_regclass('public.services') is null
     or to_regclass('public.orders') is null then
    raise exception '§1 failed: public.profiles, public.services and public.orders must all exist.';
  end if;
end;
$$;

-- ============================================================================
-- §1b  Session-scoped normalizer (lives only inside pg_temp; never persisted)
-- ============================================================================
-- Lowercases, strips comments, and collapses whitespace so a body assertion can
-- look for whole tokens regardless of how the SQL was formatted.
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

-- ============================================================================
-- §2  public.admin_overview() — read-only, has_admin_access()-gated
-- ============================================================================
-- SECURITY DEFINER is required so an approved admin can read rows that RLS
-- otherwise exposes only to the owner. Being owned by postgres (the table owner)
-- is what makes those reads possible — a non-owner definer would silently read
-- zero rows — so ownership is pinned and verified below.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_overview jsonb;
begin
  -- The only authorization decision. Derived server-side from owner_accounts and
  -- admin_accounts; nothing the caller sends can influence it.
  if not public.has_admin_access() then
    raise exception 'Admin overview is available to the owner and approved admins only.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_customers',    (select count(*) from public.profiles where role = 'customer'),
    'published_services', (select count(*) from public.services where is_active),
    'pending_orders',     (select count(*) from public.orders where status = 'pending'),
    'total_orders',       (select count(*) from public.orders),
    'recent_orders',      coalesce((
                            select jsonb_agg(row_to_json(recent))
                            from (
                              select service_name,
                                     project_name,
                                     status,
                                     price,
                                     currency,
                                     created_at
                              from public.orders
                              order by created_at desc
                              limit 5
                            ) as recent
                          ), '[]'::jsonb)
  )
  into v_overview;

  return v_overview;
end;
$$;

-- The SECURITY DEFINER function MUST be owned by postgres (the same role that
-- owns the tables and its own policy-free RLS), otherwise every count would be
-- silently filtered to 0.
do $$
declare
  v_owner name;
begin
  select r.rolname
    into v_owner
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.admin_overview()'::regprocedure;

  if v_owner is null then
    raise exception '§2 failed: could not resolve the owner role of public.admin_overview().';
  end if;

  if v_owner <> 'postgres' then
    begin
      execute 'alter function public.admin_overview() owner to postgres';
    exception
      when insufficient_privilege then
        raise exception 'Could not transfer ownership of public.admin_overview() from % to postgres. Run this migration as the postgres role.', v_owner;
    end;
  end if;
end;
$$;

-- authenticated only; the body re-checks has_admin_access() on every call. The
-- default EXECUTE grant to PUBLIC is revoked explicitly.
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ============================================================================
-- §3  Postconditions — prove the end state, or roll the whole transaction back
-- ============================================================================

-- §3.1  shape: exists, zero args, returns jsonb, STABLE, SECURITY DEFINER,
--       owned by postgres, empty search_path
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.admin_overview()') is null then
    raise exception '§3.1 failed: public.admin_overview() does not exist.';
  end if;

  select p.prosecdef,
         p.provolatile,
         p.pronargs,
         p.prorettype,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.admin_overview()'::regprocedure;

  v_owner := v_rec.owner;

  if v_owner is null or v_owner <> 'postgres' then
    raise exception '§3.1 failed: public.admin_overview() must be owned by postgres, found %.', coalesce(v_owner, 'NULL');
  end if;

  if not v_rec.prosecdef then
    raise exception '§3.1 failed: public.admin_overview() must be SECURITY DEFINER.';
  end if;

  if v_rec.provolatile <> 's' then
    raise exception '§3.1 failed: public.admin_overview() must be STABLE (read-only); found volatility %.', v_rec.provolatile;
  end if;

  if v_rec.pronargs <> 0 then
    raise exception '§3.1 failed: public.admin_overview() must take no arguments, found %.', v_rec.pronargs;
  end if;

  if v_rec.prorettype <> 'jsonb'::regtype then
    raise exception '§3.1 failed: public.admin_overview() must return jsonb.';
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§3.1 failed: public.admin_overview() must set an empty search_path. Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;
end;
$$;

-- §3.2  authorization + body: gates on has_admin_access()/42501, reads only the
--       approved sources, references NO customer personal information, and
--       contains no write or DDL statement
do $$
declare
  v_prosrc text;
  v_norm   text;
  v_padded text;
begin
  select p.prosrc
    into v_prosrc
  from pg_proc p
  where p.oid = 'public.admin_overview()'::regprocedure;

  if v_prosrc is null then
    raise exception '§3.2 failed: could not read the body of public.admin_overview().';
  end if;

  v_norm   := pg_temp.norm_sql(v_prosrc);
  v_padded := ' ' || v_norm || ' ';

  -- Gate: has_admin_access(), raising 42501 for everyone else.
  if v_norm not like '%public.has_admin_access()%' then
    raise exception '§3.2 failed: public.admin_overview() must authorize with public.has_admin_access().';
  end if;

  if v_norm not like '%errcode = ''42501''%' then
    raise exception '§3.2 failed: public.admin_overview() must raise SQLSTATE 42501 for unauthorized callers.';
  end if;

  -- Approved read sources only.
  if v_norm not like '%from public.profiles where role = ''customer''%' then
    raise exception '§3.2 failed: customers must be counted from public.profiles where role = customer.';
  end if;

  if v_norm not like '%from public.services where is_active%' then
    raise exception '§3.2 failed: published services must be counted from public.services where is_active.';
  end if;

  if v_norm not like '%from public.orders where status = ''pending''%' then
    raise exception '§3.2 failed: pending orders must be counted from public.orders where status = pending.';
  end if;

  if v_norm not like '%from public.orders order by created_at desc limit 5%' then
    raise exception '§3.2 failed: recent orders must come from public.orders, newest first, limited to 5.';
  end if;

  -- No customer personal information may be read or returned.
  if v_norm like '%client_id%'
     or v_norm like '%applicant_id%'
     or v_norm like '%email%'
     or v_norm like '%full_name%'
     or v_norm like '%username%'
     or v_norm like '%seller_details%'
     or v_norm like '%order_description%'
     or v_norm like '%requirements%' then
    raise exception '§3.2 failed: public.admin_overview() must not reference customer personal information.';
  end if;

  -- Strictly read-only: no write or DDL keyword anywhere in the body.
  if v_padded like '% insert %'
     or v_padded like '% update %'
     or v_padded like '% delete %'
     or v_padded like '% truncate %'
     or v_padded like '% alter %'
     or v_padded like '% drop %'
     or v_padded like '% grant %'
     or v_padded like '% create %' then
    raise exception '§3.2 failed: public.admin_overview() must be strictly read-only.';
  end if;
end;
$$;

-- §3.3  execute is granted to authenticated only, never to anon (and therefore
--       not to PUBLIC, which anon would inherit)
do $$
begin
  if not has_function_privilege('authenticated', 'public.admin_overview()', 'EXECUTE') then
    raise exception '§3.3 failed: authenticated must be able to execute public.admin_overview().';
  end if;

  if has_function_privilege('anon', 'public.admin_overview()', 'EXECUTE') then
    raise exception '§3.3 failed: the anon role must not be able to execute public.admin_overview().';
  end if;
end;
$$;

-- §3.4  nothing else changed: no new table, and every existing policy count is
--       exactly what the owner-access migration established
do $$
begin
  if to_regclass('public.admin_overview') is not null then
    raise exception '§3.4 failed: this migration must not create a table named public.admin_overview.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 4 then
    raise exception '§3.4 failed: the number of policies on public.profiles changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 2 then
    raise exception '§3.4 failed: the number of policies on public.orders changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'services') <> 2 then
    raise exception '§3.4 failed: the number of policies on public.services changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') <> 0 then
    raise exception '§3.4 failed: public.owner_accounts must remain policy-free.';
  end if;
end;
$$;

commit;
