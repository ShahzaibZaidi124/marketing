-- ============================================================================
-- NexTech — Read-only Admin Orders Directory RPC
--   20261125150000_add_admin_orders_directory.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261124120000_add_admin_access.sql (already applied),
--             20261125140000_add_admin_services_directory.sql (already applied).
--
-- WHY THIS EXISTS
--   The Admin "Orders" section must list the real rows from public.orders. The
--   only SELECT policies on public.orders are "Clients can read their own orders"
--   (USING ((select auth.uid()) = client_id)) and "Owners can read all orders"
--   (USING ((select public.is_owner()))). An approved admin is neither the owning
--   client nor the owner, so through RLS an approved admin can read ZERO orders.
--   The read must therefore happen on the server.
--
--   This migration adds ONE read-only RPC, public.admin_orders_directory():
--     * it is SECURITY DEFINER, owned by postgres, with an empty search_path, so
--       it reads the real rows the way the owner would — WITHOUT granting an
--       admin any new table access and WITHOUT the service-role key ever
--       reaching the browser;
--     * it authorizes the caller with public.has_admin_access() (owner OR
--       approved admin) and raises SQLSTATE 42501 for anyone else;
--     * it returns ONLY the order display fields the dashboard needs:
--       id, project_name, service_name, status, price, currency and created_at.
--
--   SCHEMA NOTE: public.orders columns are: id, client_id, service_id,
--   service_name, order_description, project_name, package_name, status, price,
--   currency, created_at, updated_at, requirements. The client identity
--   (client_id) and the client-written free text (order_description,
--   requirements) are private and are NOT returned. status is one of
--   'pending' | 'active' | 'completed' | 'rejected'.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * it never touches public.owner_accounts or public.admin_accounts
--   * it never touches public.profiles, public.services or public.service_packages
--   * it creates, drops or alters NO RLS policy, NO table and NO other function
--   * it performs no INSERT / UPDATE / DELETE anywhere  => read-only, no data loss
--   * it implements NO approve / reject / delete / edit action
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

  if to_regclass('public.orders') is null then
    raise exception '§1 failed: public.orders must exist.';
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
-- §2  public.admin_orders_directory() — read-only, has_admin_access()-gated
-- ============================================================================
-- SECURITY DEFINER is required so an approved admin can read rows that RLS
-- otherwise exposes only to the owning client and the owner. Being owned by
-- postgres (the table owner) is what makes those reads possible — a non-owner
-- definer would silently read zero rows — so ownership is pinned and verified
-- below.
create or replace function public.admin_orders_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_orders jsonb;
begin
  -- The only authorization decision. Derived server-side from owner_accounts and
  -- admin_accounts; nothing the caller sends can influence it.
  if not public.has_admin_access() then
    raise exception 'The orders directory is available to the owner and approved admins only.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(order_row)), '[]'::jsonb)
  into v_orders
  from (
    select id,
           project_name,
           service_name,
           status,
           price,
           currency,
           created_at
    from public.orders
    order by created_at desc
  ) as order_row;

  return v_orders;
end;
$$;

-- The SECURITY DEFINER function MUST be owned by postgres (the same role that
-- owns the tables and its own policy-free RLS), otherwise every read would be
-- silently filtered to zero rows.
do $$
declare
  v_owner name;
begin
  select r.rolname
    into v_owner
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.admin_orders_directory()'::regprocedure;

  if v_owner is null then
    raise exception '§2 failed: could not resolve the owner role of public.admin_orders_directory().';
  end if;

  if v_owner <> 'postgres' then
    begin
      execute 'alter function public.admin_orders_directory() owner to postgres';
    exception
      when insufficient_privilege then
        raise exception 'Could not transfer ownership of public.admin_orders_directory() from % to postgres. Run this migration as the postgres role.', v_owner;
    end;
  end if;
end;
$$;

-- authenticated only; the body re-checks has_admin_access() on every call. The
-- default EXECUTE grant to PUBLIC is revoked explicitly.
revoke all on function public.admin_orders_directory() from public, anon;
grant execute on function public.admin_orders_directory() to authenticated;

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
  if to_regprocedure('public.admin_orders_directory()') is null then
    raise exception '§3.1 failed: public.admin_orders_directory() does not exist.';
  end if;

  select p.prosecdef,
         p.provolatile,
         p.pronargs,
         p.prorettype,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.admin_orders_directory()'::regprocedure;

  v_owner := v_rec.owner;

  if v_owner is null or v_owner <> 'postgres' then
    raise exception '§3.1 failed: public.admin_orders_directory() must be owned by postgres, found %.', coalesce(v_owner, 'NULL');
  end if;

  if not v_rec.prosecdef then
    raise exception '§3.1 failed: public.admin_orders_directory() must be SECURITY DEFINER.';
  end if;

  if v_rec.provolatile <> 's' then
    raise exception '§3.1 failed: public.admin_orders_directory() must be STABLE (read-only); found volatility %.', v_rec.provolatile;
  end if;

  if v_rec.pronargs <> 0 then
    raise exception '§3.1 failed: public.admin_orders_directory() must take no arguments, found %.', v_rec.pronargs;
  end if;

  if v_rec.prorettype <> 'jsonb'::regtype then
    raise exception '§3.1 failed: public.admin_orders_directory() must return jsonb.';
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§3.1 failed: public.admin_orders_directory() must set an empty search_path. Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;
end;
$$;

-- §3.2  authorization + body: gates on has_admin_access()/42501, reads only
--       public.orders, references NO client identity or client free text and no
--       other table, and contains no write or DDL statement
do $$
declare
  v_prosrc text;
  v_norm   text;
  v_padded text;
begin
  select p.prosrc
    into v_prosrc
  from pg_proc p
  where p.oid = 'public.admin_orders_directory()'::regprocedure;

  if v_prosrc is null then
    raise exception '§3.2 failed: could not read the body of public.admin_orders_directory().';
  end if;

  v_norm   := pg_temp.norm_sql(v_prosrc);
  v_padded := ' ' || v_norm || ' ';

  -- Gate: has_admin_access(), raising 42501 for everyone else.
  if v_norm not like '%public.has_admin_access()%' then
    raise exception '§3.2 failed: public.admin_orders_directory() must authorize with public.has_admin_access().';
  end if;

  if v_norm not like '%errcode = ''42501''%' then
    raise exception '§3.2 failed: public.admin_orders_directory() must raise SQLSTATE 42501 for unauthorized callers.';
  end if;

  -- Approved read source only.
  if v_norm not like '%from public.orders%' then
    raise exception '§3.2 failed: the orders directory must be read from public.orders.';
  end if;

  if v_norm not like '%order by created_at desc%' then
    raise exception '§3.2 failed: the orders directory must be ordered by created_at descending.';
  end if;

  -- No client identity, no client free text and no other table may be touched.
  if v_norm like '%client_id%'
     or v_norm like '%order_description%'
     or v_norm like '%requirements%'
     or v_norm like '%package_name%'
     or v_norm like '%updated_at%'
     or v_norm like '%seller_details%'
     or v_norm like '%full_name%'
     or v_norm like '%username%'
     or v_norm like '%email%'
     or v_norm like '%encrypted_password%'
     or v_norm like '%public.profiles%'
     or v_norm like '%public.services%'
     or v_norm like '%public.service_packages%'
     or v_norm like '%public.owner_accounts%'
     or v_norm like '%public.admin_accounts%'
     or v_norm like '%auth.%' then
    raise exception '§3.2 failed: public.admin_orders_directory() must not reference client identity, client free text or other tables.';
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
    raise exception '§3.2 failed: public.admin_orders_directory() must be strictly read-only.';
  end if;
end;
$$;

-- §3.3  execute is granted to authenticated only, never to anon (and therefore
--       not to PUBLIC, which anon would inherit)
do $$
begin
  if not has_function_privilege('authenticated', 'public.admin_orders_directory()', 'EXECUTE') then
    raise exception '§3.3 failed: authenticated must be able to execute public.admin_orders_directory().';
  end if;

  if has_function_privilege('anon', 'public.admin_orders_directory()', 'EXECUTE') then
    raise exception '§3.3 failed: the anon role must not be able to execute public.admin_orders_directory().';
  end if;
end;
$$;

-- §3.4  nothing else changed: no new table, and every existing policy count is
--       exactly what the owner-access / admin-access migrations established
do $$
begin
  if to_regclass('public.admin_orders_directory') is not null then
    raise exception '§3.4 failed: this migration must not create a table named public.admin_orders_directory.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 2 then
    raise exception '§3.4 failed: the number of policies on public.orders changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'services') <> 2 then
    raise exception '§3.4 failed: the number of policies on public.services changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'service_packages') <> 2 then
    raise exception '§3.4 failed: the number of policies on public.service_packages changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 4 then
    raise exception '§3.4 failed: the number of policies on public.profiles changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') <> 0 then
    raise exception '§3.4 failed: public.owner_accounts must remain policy-free.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_applications') <> 3 then
    raise exception '§3.4 failed: the number of policies on public.admin_applications changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_accounts') <> 2 then
    raise exception '§3.4 failed: the number of policies on public.admin_accounts changed.';
  end if;
end;
$$;

commit;
