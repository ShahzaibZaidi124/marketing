-- ============================================================================
-- NexTech — Real service categories + services.category_id foreign key
--   20261125200000_add_service_categories.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261115192000_create_service_catalog.sql (already applied),
--             20261122120000_add_owner_access.sql        (already applied),
--             20261124120000_add_admin_access.sql        (already applied).
--
-- WHY THIS EXISTS
--   The Admin "Categories" section was a browser-memory preview: categories
--   existed only as the hardcoded serviceCategories array in src/data/services.js,
--   and public.services had NO category column at all. That means:
--     * "edit a category" could never change the customer-facing service editor;
--     * "prevent deletion when services depend on a category" could not be
--       enforced against real data, because there was no real relationship.
--
--   This migration makes categories a first-class table and gives every service a
--   real category reference, so a category with dependent services can NEVER be
--   deleted:
--     §2  public.categories (name, description, icon_name, is_active, timestamps)
--         names are unique case-insensitively, so "Web Design" and "web design"
--         cannot both exist
--     §2.3  services.category_id -> public.categories (id)  ON DELETE RESTRICT
--     §2.4  a conservative backfill of the existing rows
--     §2.5  RLS: authenticated may read ACTIVE categories; the owner reads all
--     §3  postconditions: any failure rolls the whole transaction back
--
-- BACKFILL POLICY (the important part)
--   The only pre-existing category values are the eight ids hardcoded in
--   src/data/services.js. They are registered here verbatim. A service row is
--   linked ONLY when its own id already equals a registered category id — an
--   exact, unambiguous match (§2.4). Nothing is guessed from a name or a keyword,
--   and every service that does not match keeps category_id = NULL (with a
--   NOTICE reporting how many). Those rows keep working and can be assigned on
--   purpose from the Admin Categories screen. No service row is ever modified
--   except to add this one new column's value, and no row is created, deleted or
--   renamed.
--
--   One additional service is mapped explicitly (§2.4b), because its id
--   intentionally differs from its category id and the mapping was verified
--   against the live data: 'landing-page' -> 'landing-pages'. The mapping is
--   guarded (it only applies while category_id is still NULL and the target
--   category exists) and is never derived from a name or a keyword.
--   'website-development' has no confirmed category and is deliberately left
--   unassigned.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * it never touches public.profiles, public.orders, public.service_packages,
--     public.owner_accounts or public.admin_accounts
--   * it creates, drops or alters NO policy on any existing table
--   * it performs no DELETE and no UPDATE of any existing column
--   * it grants no direct INSERT / UPDATE / DELETE to authenticated — writes go
--     through the has_admin_access()-gated RPCs in the companion migration
--   * it never grants anything to anon
--
-- HOW TO RUN (manual, later)
--   Run the ENTIRE file as ONE batch, as the postgres role.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guard — fail closed
-- ============================================================================
do $$
begin
  if to_regclass('public.services') is null then
    raise exception '§1 failed: public.services is missing. Apply 20261115192000_create_service_catalog.sql first.';
  end if;

  if to_regprocedure('public.is_owner()') is null then
    raise exception '§1 failed: public.is_owner() is missing. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  if to_regprocedure('public.update_catalog_updated_at()') is null then
    raise exception '§1 failed: public.update_catalog_updated_at() is missing. Apply 20261115192000_create_service_catalog.sql first.';
  end if;

  -- This migration only ever CREATES its objects; it never adopts or overwrites
  -- something of unknown shape.
  if to_regclass('public.categories') is not null then
    raise exception '§1 failed: public.categories already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  if exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.services'::regclass
      and a.attname  = 'category_id'
      and a.attnum   > 0
      and not a.attisdropped
  ) then
    raise exception '§1 failed: public.services.category_id already exists. Inspect it before applying this migration.';
  end if;
end;
$$;

-- ============================================================================
-- §2  public.categories
-- ============================================================================
create table public.categories (
  id          text primary key check (id ~ '^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$'),
  name        text not null check (btrim(name) <> '' and char_length(name) <= 120),
  description text not null default '' check (char_length(description) <= 500),
  icon_name   text not null default '' check (char_length(icon_name) <= 120),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Reuse the catalog timestamp trigger: categories.updated_at tracks edits the
-- same way services.updated_at does.
create trigger categories_set_updated_at
  before update on public.categories
  for each row
  execute function public.update_catalog_updated_at();

-- Case-insensitive name uniqueness. The id stays a server-derived slug and is
-- never reused as a way to store a second category with the same name.
create unique index categories_name_lower_key
  on public.categories (lower(btrim(name)));

-- The table owner must be the same postgres role that owns the RLS-bypassing
-- SECURITY DEFINER functions, or those functions would silently read 0 rows.
do $$
declare
  v_owner name;
begin
  select r.rolname
    into v_owner
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where c.oid = 'public.categories'::regclass;

  if v_owner is null then
    raise exception '§2 failed: could not resolve the owner of public.categories.';
  end if;

  if v_owner <> 'postgres' then
    begin
      execute 'alter table public.categories owner to postgres';
    exception
      when insufficient_privilege then
        raise exception 'Could not transfer ownership of public.categories from % to postgres. Run this migration as the postgres role.', v_owner;
    end;
  end if;
end;
$$;

-- ============================================================================
-- §2.2  Seed the eight existing categories (idempotent)
-- ============================================================================
-- Transcribed verbatim from src/data/services.js so the ids the app already uses
-- keep working. ON CONFLICT DO NOTHING: a later admin edit is never reverted by
-- re-running this file.
insert into public.categories (id, name, description, icon_name, is_active)
values
  ('business-websites',      'Business Websites',      '', '', true),
  ('ecommerce-websites',     'E-commerce Websites',    '', '', true),
  ('portfolio-websites',     'Portfolio Websites',     '', '', true),
  ('restaurant-websites',    'Restaurant Websites',    '', '', true),
  ('landing-pages',          'Landing Pages',          '', '', true),
  ('wordpress-development',  'WordPress Development',  '', '', true),
  ('blog-websites',          'Blog Websites',          '', '', true),
  ('custom-react-websites',  'Custom React Websites',  '', '', true)
on conflict (id) do nothing;

-- ============================================================================
-- §2.3  services.category_id -> public.categories (id)  ON DELETE RESTRICT
-- ============================================================================
-- Nullable so every existing service row stays valid; RESTRICT is the
-- database-level guarantee that a category with dependent services cannot be
-- deleted, no matter what the application layer does.
alter table public.services
  add column category_id text references public.categories (id) on delete restrict;

create index services_category_id_idx on public.services (category_id);

-- ============================================================================
-- §2.4  Conservative backfill — exact-id matches only, never a guess
-- ============================================================================
-- The final unmatched count is reported once, after BOTH backfill steps, in §2.4c.
update public.services s
   set category_id = c.id
  from public.categories c
 where s.category_id is null
   and s.id = c.id;

-- ============================================================================
-- §2.4b  Explicit, reviewed mapping — the one service whose id intentionally
--        differs from its category id
-- ============================================================================
-- 'landing-page' is the single case verified against the live data: its id does
-- not equal its category id ('landing-pages'), so the exact-id backfill above can
-- never link it. The mapping is applied only when the row is still unassigned
-- (category_id IS NULL) and the target category actually exists; otherwise it is
-- a no-op and the row stays NULL. It is never derived from a name or a keyword.
update public.services s
   set category_id = 'landing-pages'
 where s.id = 'landing-page'
   and s.category_id is null
   and exists (select 1 from public.categories c where c.id = 'landing-pages');

do $$
declare
  v_category_id text;
begin
  select s.category_id into v_category_id from public.services s where s.id = 'landing-page';
  if found then
    raise notice '§2.4b: landing-page -> % (explicit, reviewed mapping).', coalesce(v_category_id, 'still unassigned (target category missing)');
  end if;

  -- 'website-development' has no confirmed category. It is deliberately left
  -- unassigned; this is a report only, never a write.
  select s.category_id into v_category_id from public.services s where s.id = 'website-development';
  if found then
    raise notice '§2.4b: website-development stays unassigned on purpose (category_id = %).', coalesce(v_category_id, 'NULL');
  end if;
end;
$$;

-- ============================================================================
-- §2.4c  Final unmatched-service report — runs AFTER both backfill steps
-- ============================================================================
-- Reports the true, final number of services still without a category, after
-- BOTH the exact-id backfill (§2.4) and the explicit mapping (§2.4b) have run.
-- This is a report only: nothing here writes.
do $$
declare
  v_total     int;
  v_linked    int;
  v_unmatched int;
begin
  select count(*) into v_total     from public.services;
  select count(*) into v_linked    from public.services where category_id is not null;
  v_unmatched := v_total - v_linked;

  if v_unmatched > 0 then
    raise notice '§2.4c: % of % service row(s) still have no category after both backfill steps and keep category_id = NULL. Assign them from the Admin Categories screen; they are left untouched on purpose.', v_unmatched, v_total;
  end if;
end;
$$;

-- ============================================================================
-- §2.5  RLS — customers read ACTIVE categories; the owner reads all
-- ============================================================================
alter table public.categories enable row level security;

-- No direct INSERT / UPDATE / DELETE grant at all: every write is a
-- has_admin_access()-gated SECURITY DEFINER RPC (companion migration).
revoke all on public.categories from public, anon, authenticated;
grant select on public.categories to authenticated;
grant all   on public.categories to service_role;

create policy "Authenticated users can view active categories"
  on public.categories for select
  to authenticated
  using (is_active);

create policy "Owners can read all categories"
  on public.categories for select
  to authenticated
  using ((select public.is_owner()));

-- ============================================================================
-- §3  Postconditions — prove the end state, or roll the whole transaction back
-- ============================================================================

-- §3.1  the table: ordinary table, RLS on, no FORCE RLS, owned by postgres
do $$
declare
  v_rec record;
begin
  if to_regclass('public.categories') is null then
    raise exception '§3.1 failed: public.categories does not exist.';
  end if;

  select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.categories'::regclass;

  if v_rec.relkind <> 'r' then
    raise exception '§3.1 failed: public.categories must be an ordinary table.';
  end if;
  if not v_rec.relrowsecurity then
    raise exception '§3.1 failed: row level security is not enabled on public.categories.';
  end if;
  if v_rec.relforcerowsecurity then
    raise exception '§3.1 failed: FORCE ROW LEVEL SECURITY must not be set on public.categories.';
  end if;
  if v_rec.owner <> 'postgres' then
    raise exception '§3.1 failed: public.categories must be owned by postgres, found %.', v_rec.owner;
  end if;
end;
$$;

-- §3.2  the columns exist with the reviewed types / nullability
do $$
declare
  v_pair record;
  v_type text;
  v_notnull boolean;
begin
  for v_pair in
    select * from (values
      ('id',          'text'),
      ('name',        'text'),
      ('description', 'text'),
      ('icon_name',   'text'),
      ('is_active',   'boolean'),
      ('created_at',  'timestamp with time zone'),
      ('updated_at',  'timestamp with time zone')
    ) as t(col, typ)
  loop
    select format_type(a.atttypid, a.atttypmod), a.attnotnull
      into v_type, v_notnull
    from pg_attribute a
    where a.attrelid = 'public.categories'::regclass
      and a.attname  = v_pair.col
      and a.attnum   > 0
      and not a.attisdropped;

    if v_type is null then
      raise exception '§3.2 failed: public.categories.% is missing.', v_pair.col;
    end if;
    if v_type <> v_pair.typ then
      raise exception '§3.2 failed: public.categories.% has type %, expected %.', v_pair.col, v_type, v_pair.typ;
    end if;
    if not v_notnull then
      raise exception '§3.2 failed: public.categories.% must be NOT NULL.', v_pair.col;
    end if;
  end loop;
end;
$$;

-- §3.2b  category names are unique regardless of case or surrounding spaces
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where i.indrelid = 'public.categories'::regclass
      and c.relname = 'categories_name_lower_key'
      and i.indisunique
  ) then
    raise exception '§3.2b failed: public.categories is missing the unique name index categories_name_lower_key.';
  end if;
end;
$$;

-- §3.3  the updated_at trigger is present and enabled
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.categories'::regclass
      and tgname = 'categories_set_updated_at'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§3.3 failed: the categories updated_at trigger is missing or disabled.';
  end if;
end;
$$;

-- §3.4  the foreign key exists, points at public.categories and is ON DELETE
--       RESTRICT (this is what makes an in-use category undeletable)
do $$
declare
  v_attnum smallint;
  v_rec record;
begin
  select a.attnum
    into v_attnum
  from pg_attribute a
  where a.attrelid = 'public.services'::regclass
    and a.attname  = 'category_id'
    and a.attnum   > 0
    and not a.attisdropped;

  if v_attnum is null then
    raise exception '§3.4 failed: public.services.category_id is missing.';
  end if;

  select con.confdeltype, con.confrelid
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.services'::regclass
    and con.contype  = 'f'
    and con.conkey   = array[v_attnum];

  if not found then
    raise exception '§3.4 failed: public.services.category_id has no foreign key.';
  end if;

  if v_rec.confrelid <> 'public.categories'::regclass then
    raise exception '§3.4 failed: the services.category_id foreign key must reference public.categories.';
  end if;

  if v_rec.confdeltype <> 'r' then
    raise exception '§3.4 failed: the services → categories foreign key must be ON DELETE RESTRICT, found action %.', v_rec.confdeltype;
  end if;
end;
$$;

-- §3.4b  the mapping is exactly the reviewed one, and nothing extra.
--        This deliberately does NOT assume every service has a category:
--        services with category_id = NULL are expected and allowed.
do $$
declare
  v_linked text;
begin
  -- Nothing may point at a category that does not exist (belt-and-braces over
  -- the foreign key; also catches any stray manual value).
  if exists (
    select 1
    from public.services s
    where s.category_id is not null
      and not exists (select 1 from public.categories c where c.id = s.category_id)
  ) then
    raise exception '§3.4b failed: a service is linked to a category that does not exist.';
  end if;

  -- landing-page must be mapped to landing-pages, but only when both rows exist.
  if exists (select 1 from public.services s where s.id = 'landing-page')
     and exists (select 1 from public.categories c where c.id = 'landing-pages') then
    select s.category_id into v_linked from public.services s where s.id = 'landing-page';
    if v_linked is distinct from 'landing-pages' then
      raise exception '§3.4b failed: landing-page must be mapped to landing-pages, found %.', coalesce(v_linked, 'NULL');
    end if;
  end if;

  -- website-development must stay unassigned.
  if exists (select 1 from public.services s where s.id = 'website-development') then
    select s.category_id into v_linked from public.services s where s.id = 'website-development';
    if v_linked is not null then
      raise exception '§3.4b failed: website-development must remain unassigned, found %.', v_linked;
    end if;
  end if;
end;
$$;

-- §3.5  the eight existing categories are present, active and unrenamed
do $$
declare
  v_expected text[] := array[
    'business-websites', 'ecommerce-websites', 'portfolio-websites', 'restaurant-websites',
    'landing-pages', 'wordpress-development', 'blog-websites', 'custom-react-websites'
  ];
  v_missing text;
begin
  select string_agg(e, ', ')
    into v_missing
  from unnest(v_expected) as e
  where not exists (
    select 1 from public.categories c where c.id = e and c.is_active
  );

  if v_missing is not null then
    raise exception '§3.5 failed: these existing categories are missing or inactive: %', v_missing;
  end if;

  if (select count(*) from public.categories) < 8 then
    raise exception '§3.5 failed: expected at least 8 categories, found %.',
      (select count(*) from public.categories);
  end if;
end;
$$;

-- §3.6  policies: exactly the two reviewed ones on public.categories
do $$
declare
  v_exp record;
  v_cmd text;
  v_roles text[];
  v_qual text;
  v_check text;
begin
  for v_exp in
    select * from (values
      ('Authenticated users can view active categories'),
      ('Owners can read all categories')
    ) as t(pol)
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = 'categories'
      and p.policyname = v_exp.pol;

    if not found then
      raise exception '§3.6 failed: policy "%" on public.categories is missing.', v_exp.pol;
    end if;
    if v_cmd <> 'SELECT' then
      raise exception '§3.6 failed: policy "%" must be FOR SELECT, found %.', v_exp.pol, v_cmd;
    end if;
    if v_roles <> array['authenticated'] then
      raise exception '§3.6 failed: policy "%" must apply to authenticated, found %.', v_exp.pol, v_roles;
    end if;
    if v_qual is null then
      raise exception '§3.6 failed: policy "%" must define a USING expression.', v_exp.pol;
    end if;
    if v_check is not null then
      raise exception '§3.6 failed: policy "%" must not have a WITH CHECK clause.', v_exp.pol;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'categories') <> 2 then
    raise exception '§3.6 failed: expected exactly 2 policies on public.categories.';
  end if;

  -- nothing became readable by anon/public
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'categories'
      and roles::text[] && array['anon', 'public']::text[]
  ) then
    raise exception '§3.6 failed: a public.categories policy is exposed to anon/public.';
  end if;
end;
$$;

-- §3.7  grants: authenticated reads categories only; nothing for anon;
--       service_role keeps full DML
do $$
declare
  v_priv text;
begin
  if not has_table_privilege('authenticated', 'public.categories', 'SELECT') then
    raise exception '§3.7 failed: authenticated must be able to SELECT public.categories.';
  end if;

  foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.categories', v_priv) then
      raise exception '§3.7 failed: authenticated must not hold % on public.categories.', v_priv;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.categories', 'SELECT')
     or has_table_privilege('anon', 'public.categories', 'INSERT')
     or has_table_privilege('anon', 'public.categories', 'UPDATE')
     or has_table_privilege('anon', 'public.categories', 'DELETE') then
    raise exception '§3.7 failed: the anon role must have no privileges on public.categories.';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.categories', v_priv) then
      raise exception '§3.7 failed: service_role must hold % on public.categories.', v_priv;
    end if;
  end loop;
end;
$$;

-- §3.8  nothing else changed: the existing policy counts are untouched
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'services') <> 2 then
    raise exception '§3.8 failed: the number of policies on public.services changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'service_packages') <> 2 then
    raise exception '§3.8 failed: the number of policies on public.service_packages changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 4 then
    raise exception '§3.8 failed: the number of policies on public.profiles changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 2 then
    raise exception '§3.8 failed: the number of policies on public.orders changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') <> 0 then
    raise exception '§3.8 failed: public.owner_accounts must remain policy-free.';
  end if;
end;
$$;

commit;
