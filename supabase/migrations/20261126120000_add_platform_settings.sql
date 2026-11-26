-- ============================================================================
-- NexTech — Persistent Platform Settings (owner-only)
--   20261126120000_add_platform_settings.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261122120000_add_owner_access.sql (public.is_owner(), owner_accounts)
--             20261124120000_add_admin_access.sql (public.has_admin_access())
--
-- WHY THIS EXISTS
--   Platform Configuration is currently a browser-only preview. This migration
--   makes the four fields (website name, description, contact email, support
--   email) persistent and readable/writable ONLY by the verified owner.
--
--   The single settings row is stored in public.site_settings. The table has RLS
--   enabled with NO policies, so no client role (anon, authenticated) can read or
--   write it directly. Every read and write goes through SECURITY DEFINER
--   functions owned by postgres:
--     * public.get_platform_settings()                     — owner only (42501)
--     * public.update_platform_settings(...)               — owner only (42501)
--     * public.public_site_settings()                      — OPTIONAL (§5): a
--       curated, non-sensitive projection for the public website. It exposes only
--       the four displayed values, never the table. If requirement 5 ("only the
--       owner may read") is taken to forbid even this, §5 is simply deleted and
--       the public site keeps its built-in defaults.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * it never touches public.owner_accounts, public.admin_accounts or
--     public.admin_applications (no row, no policy, no grant)
--   * it never touches public.profiles.role or its protection trigger
--   * it never touches any existing customer/owner policy
--   * it never grants the authenticated or anon role ANY privilege on the table
--   * it never puts a service-role key anywhere near the browser
--
-- HOW TO RUN (manual, later)
--   Run the ENTIRE file as ONE batch, as the postgres role.
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

-- §1.2  public.owner_accounts: present, locked down, and holding the owner
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

  if v_rec.owner <> 'postgres' then
    raise exception '§1.2 failed: public.owner_accounts must be owned by postgres, found %.', v_rec.owner;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_accounts'
  ) then
    raise exception '§1.2 failed: public.owner_accounts must not have any RLS policies.';
  end if;

  if (select count(*) from public.owner_accounts) = 0 then
    raise exception '§1.2 failed: public.owner_accounts is empty. Register the NexTech owner before enabling platform settings.';
  end if;
end;
$$;

-- §1.3  this migration's own objects must NOT already exist — it only creates
--       them; it never adopts or overwrites an object of unknown shape
do $$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.get_platform_settings()',
    'public.update_platform_settings(text,text,text,text)',
    'public.public_site_settings()'
  ];
begin
  if to_regclass('public.site_settings') is not null then
    raise exception '§1.3 failed: public.site_settings already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is not null then
      raise exception '§1.3 failed: % already exists. Inspect it before applying this migration; it will not be replaced.', v_sig;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §2  public.site_settings — a single, owner-managed row
-- ============================================================================
-- id is a boolean that must be true, so the table can only ever hold one row.
create table public.site_settings (
  id                  boolean primary key default true,
  website_name        text not null default 'NexTech',
  website_description text not null default '',
  contact_email       text not null default '',
  support_email       text not null default '',
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint site_settings_single_row check (id),
  constraint site_settings_name_length        check (char_length(btrim(website_name)) between 1 and 120),
  constraint site_settings_description_length check (char_length(website_description) <= 300),
  constraint site_settings_contact_length     check (char_length(contact_email) <= 320),
  constraint site_settings_support_length     check (char_length(support_email) <= 320)
);

-- Seed the single row with the current defaults. Safe to run once.
insert into public.site_settings (id) values (true);

-- The SECURITY DEFINER functions run as the table owner, so the owner MUST be a
-- role that bypasses RLS (postgres) once RLS is enabled with no policies. Pin it
-- explicitly, and fail loudly if it cannot be pinned.
do $$
declare
  v_owner name;
begin
  select r.rolname
    into v_owner
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where c.oid = 'public.site_settings'::regclass;

  if v_owner is null then
    raise exception '§2 failed: could not resolve the owner of public.site_settings.';
  end if;

  if v_owner <> 'postgres' then
    begin
      execute 'alter table public.site_settings owner to postgres';
    exception
      when insufficient_privilege then
        raise exception 'Could not transfer ownership of public.site_settings from % to postgres. Run this migration as the postgres role.', v_owner;
    end;
  end if;
end;
$$;

alter table public.site_settings enable row level security;
-- Deliberately NO policies: with RLS on and no policies, every client role reads 0
-- rows and can write nothing. All access is via the SECURITY DEFINER functions.
revoke all on public.site_settings from public, anon, authenticated;
grant all  on public.site_settings to service_role;

-- ============================================================================
-- §3  public.get_platform_settings() — owner-only read
-- ============================================================================
create or replace function public.get_platform_settings()
returns public.site_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.site_settings;
begin
  -- The owner check is the existing server-side gate. It fails closed: a caller
  -- who is not the registered owner gets 42501, never data.
  if not public.is_owner() then
    raise exception 'Only the NexTech owner can read platform settings.' using errcode = '42501';
  end if;

  select * into v_row from public.site_settings where id;
  return v_row;
end;
$$;

-- ============================================================================
-- §4  public.update_platform_settings(...) — owner-only, validated write
-- ============================================================================
create or replace function public.update_platform_settings(
  p_website_name        text,
  p_website_description text,
  p_contact_email       text,
  p_support_email       text
)
returns public.site_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text := btrim(coalesce(p_website_name, ''));
  v_desc    text := btrim(coalesce(p_website_description, ''));
  v_contact text := lower(btrim(coalesce(p_contact_email, '')));
  v_support text := lower(btrim(coalesce(p_support_email, '')));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_row     public.site_settings;
begin
  if not public.is_owner() then
    raise exception 'Only the NexTech owner can update platform settings.' using errcode = '42501';
  end if;

  -- Server-side validation and sanitization (defence in depth alongside the
  -- client). Values are trimmed; emails are lower-cased and format-checked.
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'The website name must be between 1 and 120 characters.' using errcode = '22023';
  end if;

  if char_length(v_desc) > 300 then
    raise exception 'The website description must be 300 characters or fewer.' using errcode = '22023';
  end if;

  if char_length(v_contact) > 320 then
    raise exception 'The contact email must be 320 characters or fewer.' using errcode = '22023';
  end if;
  if v_contact <> '' and v_contact !~ v_email_re then
    raise exception 'Enter a valid contact email address.' using errcode = '22023';
  end if;

  if char_length(v_support) > 320 then
    raise exception 'The support email must be 320 characters or fewer.' using errcode = '22023';
  end if;
  if v_support <> '' and v_support !~ v_email_re then
    raise exception 'Enter a valid support email address.' using errcode = '22023';
  end if;

  update public.site_settings
     set website_name        = v_name,
         website_description = v_desc,
         contact_email       = v_contact,
         support_email       = v_support,
         updated_at          = clock_timestamp(),
         updated_by          = (select auth.uid())
   where id
   returning * into v_row;

  return v_row;
end;
$$;

-- ============================================================================
-- §5  public.public_site_settings() — OPTIONAL curated public projection
-- ============================================================================
-- Delete this section if requirement 5 is read strictly (no non-owner may read
-- any settings value). It exposes ONLY the four values the public website shows,
-- never the table and never any management field, so an anonymous visitor or a
-- customer can render the site without gaining any settings access.
create or replace function public.public_site_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'website_name',        s.website_name,
    'website_description', s.website_description,
    'contact_email',       s.contact_email,
    'support_email',       s.support_email
  )
  from public.site_settings s
  where s.id;
$$;

-- ============================================================================
-- §6  Pin function ownership to postgres (same role as the table)
-- ============================================================================
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.get_platform_settings()',
    'public.update_platform_settings(text,text,text,text)',
    'public.public_site_settings()'
  ];
  v_owner name;
begin
  foreach v_sig in array v_sigs loop
    select r.rolname
      into v_owner
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = v_sig::regprocedure;

    if v_owner is null then
      raise exception '§6 failed: could not resolve the owner role of %.', v_sig;
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

-- ============================================================================
-- §7  Grants — management is authenticated-only; the public projection is public
-- ============================================================================
revoke all on function public.get_platform_settings() from public, anon;
grant execute on function public.get_platform_settings() to authenticated, service_role;

revoke all on function public.update_platform_settings(text, text, text, text) from public, anon;
grant execute on function public.update_platform_settings(text, text, text, text) to authenticated, service_role;

revoke all on function public.public_site_settings() from public;
grant execute on function public.public_site_settings() to anon, authenticated, service_role;

-- ============================================================================
-- §8  Postconditions — prove the end state, or roll everything back
-- ============================================================================

-- §8.1  the table: ordinary table, RLS on, not forced, owned by postgres, 1 row
do $$
declare
  v_rec record;
begin
  if to_regclass('public.site_settings') is null then
    raise exception '§8.1 failed: public.site_settings does not exist.';
  end if;

  select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.site_settings'::regclass;

  if v_rec.relkind <> 'r' then
    raise exception '§8.1 failed: public.site_settings must be an ordinary table.';
  end if;
  if not v_rec.relrowsecurity then
    raise exception '§8.1 failed: row level security is not enabled on public.site_settings.';
  end if;
  if v_rec.relforcerowsecurity then
    raise exception '§8.1 failed: FORCE ROW LEVEL SECURITY must not be set on public.site_settings.';
  end if;
  if v_rec.owner <> 'postgres' then
    raise exception '§8.1 failed: public.site_settings must be owned by postgres, found %.', v_rec.owner;
  end if;
  if (select count(*) from public.site_settings) <> 1 then
    raise exception '§8.1 failed: public.site_settings must hold exactly one row.';
  end if;
end;
$$;

-- §8.2  no policy, and no client-role privileges on the table
do $$
declare
  v_priv text;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_settings'
  ) then
    raise exception '§8.2 failed: public.site_settings must not have any RLS policy.';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.site_settings', v_priv) then
      raise exception '§8.2 failed: the anon role must have no % on public.site_settings.', v_priv;
    end if;
    if has_table_privilege('authenticated', 'public.site_settings', v_priv) then
      raise exception '§8.2 failed: the authenticated role must have no % on public.site_settings.', v_priv;
    end if;
    if not has_table_privilege('service_role', 'public.site_settings', v_priv) then
      raise exception '§8.2 failed: service_role must hold % on public.site_settings.', v_priv;
    end if;
  end loop;
end;
$$;

-- §8.3  functions: SECURITY DEFINER, owned by postgres, empty search_path
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.get_platform_settings()',
    'public.update_platform_settings(text,text,text,text)',
    'public.public_site_settings()'
  ];
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception '§8.3 failed: % does not exist.', v_sig;
    end if;

    select p.prosecdef, p.proconfig,
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

-- §8.4  the owner gate is present in the management functions (fail closed)
do $$
declare
  v_def text;
begin
  v_def := lower(pg_get_functiondef('public.get_platform_settings()'::regprocedure));
  if v_def !~ 'if\s+not\s+public\.is_owner\(\)\s+then' then
    raise exception '§8.4 failed: get_platform_settings() does not gate on public.is_owner().';
  end if;

  v_def := lower(pg_get_functiondef('public.update_platform_settings(text,text,text,text)'::regprocedure));
  if v_def !~ 'if\s+not\s+public\.is_owner\(\)\s+then' then
    raise exception '§8.4 failed: update_platform_settings(...) does not gate on public.is_owner().';
  end if;
end;
$$;

-- §8.5  grants: anon cannot execute the management functions; authenticated can;
--       the public projection is executable by anon, authenticated, service_role
do $$
begin
  if has_function_privilege('anon', 'public.get_platform_settings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_platform_settings(text,text,text,text)', 'EXECUTE') then
    raise exception '§8.5 failed: the anon role must not be able to EXECUTE the platform settings management functions.';
  end if;

  if not has_function_privilege('authenticated', 'public.get_platform_settings()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_platform_settings(text,text,text,text)', 'EXECUTE') then
    raise exception '§8.5 failed: the authenticated role must be able to EXECUTE the management functions (the owner gate still applies).';
  end if;

  if not has_function_privilege('anon', 'public.public_site_settings()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.public_site_settings()', 'EXECUTE') then
    raise exception '§8.5 failed: public_site_settings() must be executable by anon and authenticated.';
  end if;
end;
$$;

-- §8.6  behavioral probe: a non-owner authenticated caller is refused, and the
--       public projection still returns the four values
do $$
declare
  v_uid        uuid := gen_random_uuid();
  v_failed     boolean := false;
  v_stored_name text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_uid::text)::text, true);

  begin
    perform * from public.get_platform_settings();
  exception
    when insufficient_privilege then v_failed := true;
  end;

  if not v_failed then
    raise exception '§8.6 failed: get_platform_settings() allowed a non-owner caller.';
  end if;

  v_failed := false;
  begin
    perform * from public.update_platform_settings('Hacked', '', '', '');
  exception
    when insufficient_privilege then v_failed := true;
  end;

  if not v_failed then
    raise exception '§8.6 failed: update_platform_settings() allowed a non-owner caller.';
  end if;

  -- The stored name must be untouched by the refused update.
  select s.website_name into v_stored_name from public.site_settings s where s.id;
  if v_stored_name = 'Hacked' then
    raise exception '§8.6 failed: a refused update changed the stored settings.';
  end if;

  -- The public projection returns exactly the four safe keys.
  if (select count(*) from jsonb_object_keys(public.public_site_settings())) <> 4 then
    raise exception '§8.6 failed: public_site_settings() must expose exactly four keys.';
  end if;

  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- §8.7  preservation: the owner/admin layer is untouched
do $$
declare
  v_pair record;
begin
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

  if coalesce(
       (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.nextech_protect_profile_role()')),
       true
     ) then
    raise exception '§8.7 failed: profile role protection must remain SECURITY INVOKER.';
  end if;

  for v_pair in
    select * from (values
      ('admin_applications', 'Applicants read their own admin applications'),
      ('admin_applications', 'Owners read all admin applications'),
      ('admin_applications', 'Applicants create their own pending admin application'),
      ('admin_accounts',     'Admins read their own admin account'),
      ('admin_accounts',     'Owners read all admin accounts'),
      ('conversations',      'Owners read all conversations'),
      ('messages',           'Owners read all messages')
    ) as t(tbl, pol)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = v_pair.tbl
        and p.policyname = v_pair.pol
    ) then
      raise exception '§8.7 failed: existing policy "%" on public.% is missing.', v_pair.pol, v_pair.tbl;
    end if;
  end loop;
end;
$$;

commit;

-- ============================================================================
-- AFTER this migration commits:
--   * public.site_settings holds exactly one row (the defaults).
--   * Only the owner can read/update it, through the two management functions.
--   * If §5 was kept, the public website can read the four values via
--     public.public_site_settings().
-- ============================================================================
