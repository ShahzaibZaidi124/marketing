-- ============================================================================
-- NexTech — Admin category management RPCs
--   20261125210000_add_admin_category_management.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261124120000_add_admin_access.sql        (already applied),
--             20261125200000_add_service_categories.sql (must be applied first).
--
-- WHY THIS EXISTS
--   Approved admins hold NO direct write access to public.categories (the table
--   grants authenticated SELECT only, and there is no INSERT/UPDATE/DELETE
--   policy). Every category change therefore happens on the server, through five
--   SECURITY DEFINER functions owned by postgres with an empty search_path, each
--   gated by public.has_admin_access() (owner OR approved admin) and raising
--   SQLSTATE 42501 for anyone else:
--
--     public.admin_service_categories()          -- read all, incl. inactive
--     public.create_service_category()           -- add (id is derived server-side)
--     public.update_service_category()           -- edit name/description/icon/active
--     public.delete_service_category()           -- delete, only when unused
--     public.reassign_service_category()         -- move dependent services first
--
--   The delete path re-counts the dependent services and refuses with SQLSTATE
--   23503; the ON DELETE RESTRICT foreign key from the companion migration is the
--   database-level backstop behind it.
--
--   The browser never sends an id when creating: the slug is derived from the name
--   on the server, so a caller can never choose or overwrite a row id. A second
--   category with the same name (ignoring case and surrounding spaces) is refused
--   with SQLSTATE 23505; the slug is not given a numeric suffix to sneak a
--   duplicate name in. Different names that happen to share a slug still get a
--   distinct id.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * it never touches public.profiles, public.orders, public.service_packages,
--     public.owner_accounts or public.admin_accounts
--   * it creates, drops or alters NO RLS policy and NO table
--   * it grants NO direct DML on public.categories to authenticated — only the
--     five RPCs above
--   * it never grants EXECUTE to anon or public
--   * it implements NO bulk import and NO destructive "delete anyway" override
--
-- HOW TO RUN (manual, later)
--   Run the ENTIRE file as ONE batch, as the postgres role.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guard — fail closed
-- ============================================================================
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.has_admin_access()') is null then
    raise exception '§1 failed: public.has_admin_access() is missing. Apply 20261124120000_add_admin_access.sql first.';
  end if;

  select p.prosecdef, p.pronargs, p.prorettype, p.proconfig,
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

  select exists (select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""')
    into v_ok;
  if not coalesce(v_ok, false) then
    raise exception '§1 failed: public.has_admin_access() must set an empty search_path.';
  end if;

  if to_regclass('public.categories') is null then
    raise exception '§1 failed: public.categories is missing. Apply 20261125200000_add_service_categories.sql first.';
  end if;

  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.services'::regclass
      and a.attname  = 'category_id'
      and a.attnum   > 0
      and not a.attisdropped
  ) then
    raise exception '§1 failed: public.services.category_id is missing. Apply 20261125200000_add_service_categories.sql first.';
  end if;
end;
$$;

-- ============================================================================
-- §1b  Session-scoped normalizer (lives only inside pg_temp; never persisted)
-- ============================================================================
-- Used by the §8 postconditions to compare a function's source text regardless
-- of formatting: it lower-cases the input, removes SQL comments, and collapses
-- runs of whitespace to a single space.
--
-- It does NOT strip comment markers that live inside a string. It scans the text
-- and copies the three PostgreSQL quoting forms verbatim — single-quoted
-- literals ('' inside '' is an escaped quote), double-quoted identifiers ("" is
-- an escaped quote) and dollar-quoted bodies ($tag$ ... $tag$, or $$ ... $$) —
-- so a literal like 'a -- b' or '/* c */' survives untouched. Only comments in
-- real code position are removed: /* ... */ block comments (with PostgreSQL's
-- nesting rule) and -- line comments through the end of the line.
--
-- Escaping note: with standard_conforming_strings = on (the default) a backslash
-- in a literal is just a backslash. The only regular expressions here use POSIX
-- character classes ([a-z_0-9], [[:space:]]) with no backslash escapes, and the
-- newline used to end a line comment is written as chr(10), so there is no
-- backslash escape that could be misread.
create or replace function pg_temp.norm_sql(input text)
returns text
language plpgsql
immutable
as $norm$
declare
  v_src   text := lower(coalesce(input, ''));
  v_len   int  := char_length(lower(coalesce(input, '')));
  v_i     int  := 1;
  v_j     int;
  v_out   text := '';
  v_ch    text;
  v_tag   text;
  v_depth int;
begin
  while v_i <= v_len loop
    v_ch  := substr(v_src, v_i, 1);
    v_tag := null;

    -- Detect a dollar-quote opener ($tag$ or $$) at the current position.
    if v_ch = '$' then
      v_j := v_i + 1;
      while v_j <= v_len and substr(v_src, v_j, 1) ~ '^[A-Za-z_0-9]' loop
        v_j := v_j + 1;
      end loop;
      if substr(v_src, v_j, 1) = '$' then
        if v_j = v_i + 1 then
          v_tag := '$$';
        elsif substr(v_src, v_i + 1, 1) !~ '^[0-9]' then
          v_tag := substr(v_src, v_i, v_j - v_i + 1);
        end if;
      end if;
    end if;

    if v_ch = '''' then
      -- single-quoted string literal: copy through the closing quote
      v_out := v_out || v_ch;
      v_i := v_i + 1;
      while v_i <= v_len loop
        v_ch := substr(v_src, v_i, 1);
        v_out := v_out || v_ch;
        if v_ch = '''' then
          if substr(v_src, v_i + 1, 1) = '''' then
            v_out := v_out || '''';
            v_i := v_i + 2;
          else
            v_i := v_i + 1;
            exit;
          end if;
        else
          v_i := v_i + 1;
        end if;
      end loop;

    elsif v_ch = '"' then
      -- double-quoted identifier: copy through the closing quote
      v_out := v_out || v_ch;
      v_i := v_i + 1;
      while v_i <= v_len loop
        v_ch := substr(v_src, v_i, 1);
        v_out := v_out || v_ch;
        if v_ch = '"' then
          if substr(v_src, v_i + 1, 1) = '"' then
            v_out := v_out || '"';
            v_i := v_i + 2;
          else
            v_i := v_i + 1;
            exit;
          end if;
        else
          v_i := v_i + 1;
        end if;
      end loop;

    elsif v_tag is not null then
      -- dollar-quoted string: copy through the matching closing tag
      v_out := v_out || v_tag;
      v_i := v_i + char_length(v_tag);
      while v_i <= v_len loop
        if substr(v_src, v_i, char_length(v_tag)) = v_tag then
          v_out := v_out || v_tag;
          v_i := v_i + char_length(v_tag);
          exit;
        end if;
        v_out := v_out || substr(v_src, v_i, 1);
        v_i := v_i + 1;
      end loop;

    elsif v_ch = '-' and substr(v_src, v_i + 1, 1) = '-' then
      -- line comment: drop everything up to the line break
      while v_i <= v_len and substr(v_src, v_i, 1) <> chr(10) loop
        v_i := v_i + 1;
      end loop;
      v_out := v_out || ' ';

    elsif v_ch = '/' and substr(v_src, v_i + 1, 1) = '*' then
      -- block comment: drop it, honouring PostgreSQL's nested comments
      v_i := v_i + 2;
      v_depth := 1;
      while v_i <= v_len and v_depth > 0 loop
        if substr(v_src, v_i, 2) = '/*' then
          v_depth := v_depth + 1;
          v_i := v_i + 2;
        elsif substr(v_src, v_i, 2) = '*/' then
          v_depth := v_depth - 1;
          v_i := v_i + 2;
        else
          v_i := v_i + 1;
        end if;
      end loop;
      v_out := v_out || ' ';

    else
      v_out := v_out || v_ch;
      v_i := v_i + 1;
    end if;
  end loop;

  return btrim(regexp_replace(v_out, '[[:space:]]+', ' ', 'g'));
end;
$norm$;

-- ============================================================================
-- §2  Read: every category, including inactive, for the owner + approved admins
-- ============================================================================
create or replace function public.admin_service_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_categories jsonb;
begin
  if not public.has_admin_access() then
    raise exception 'The category directory is available to the owner and approved admins only.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(cat)), '[]'::jsonb)
    into v_categories
  from (
    select c.id,
           c.name,
           c.description,
           c.icon_name,
           c.is_active,
           c.created_at,
           (select count(*) from public.services s where s.category_id = c.id) as service_count
    from public.categories c
    order by c.name asc, c.id asc
  ) as cat;

  return v_categories;
end;
$$;

-- ============================================================================
-- §3  Create: the id is derived on the server, the browser never picks it
-- ============================================================================
create or replace function public.create_service_category(
  p_name        text,
  p_description text,
  p_icon_name   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_desc   text := btrim(coalesce(p_description, ''));
  v_icon   text := btrim(coalesce(p_icon_name, ''));
  v_base   text;
  v_id     text;
  v_suffix int := 1;
begin
  if not public.has_admin_access() then
    raise exception 'Only the NexTech owner and approved admins can manage categories.'
      using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'A category name is required.' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Category names must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(v_desc) > 500 then
    raise exception 'Category descriptions must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(v_icon) > 120 then
    raise exception 'Icon names must be 120 characters or fewer.' using errcode = '22023';
  end if;

  -- Reject the duplicate before deriving an id. A matching slug is not a reason
  -- to store the same name twice; the unique index is the race backstop.
  if exists (
    select 1
    from public.categories c
    where lower(btrim(c.name)) = lower(v_name)
  ) then
    raise exception 'A category with that name already exists.' using errcode = '23505';
  end if;

  -- Server-derived slug: lowercase, non-alphanumerics collapsed to single
  -- hyphens, no leading/trailing hyphen. The caller cannot choose the id.
  v_base := btrim(regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'));

  if v_base = '' then
    raise exception 'A category name must contain at least one letter or number.' using errcode = '22023';
  end if;

  v_base := left(v_base, 100);
  v_id   := v_base;

  while exists (select 1 from public.categories c where c.id = v_id) loop
    v_suffix := v_suffix + 1;
    v_id     := v_base || '-' || v_suffix::text;
  end loop;

  insert into public.categories (id, name, description, icon_name, is_active)
  values (v_id, v_name, v_desc, v_icon, true);

  return jsonb_build_object(
    'id',            v_id,
    'name',          v_name,
    'description',   v_desc,
    'icon_name',     v_icon,
    'is_active',     true,
    'service_count', 0
  );
end;
$$;

-- ============================================================================
-- §4  Update: name / description / icon name / active flag
-- ============================================================================
create or replace function public.update_service_category(
  p_id          text,
  p_name        text,
  p_description text,
  p_icon_name   text,
  p_is_active   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_desc   text := btrim(coalesce(p_description, ''));
  v_icon   text := btrim(coalesce(p_icon_name, ''));
  v_active boolean := coalesce(p_is_active, true);
  v_count  int;
begin
  if not public.has_admin_access() then
    raise exception 'Only the NexTech owner and approved admins can manage categories.'
      using errcode = '42501';
  end if;

  if p_id is null or btrim(p_id) = '' then
    raise exception 'A category id is required.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'A category name is required.' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Category names must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(v_desc) > 500 then
    raise exception 'Category descriptions must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(v_icon) > 120 then
    raise exception 'Icon names must be 120 characters or fewer.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.categories c where c.id = p_id) then
    raise exception 'Category % does not exist.', p_id using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.categories c
    where c.id <> p_id
      and lower(btrim(c.name)) = lower(v_name)
  ) then
    raise exception 'A category with that name already exists.' using errcode = '23505';
  end if;

  update public.categories
     set name        = v_name,
         description = v_desc,
         icon_name   = v_icon,
         is_active   = v_active
   where id = p_id;

  select count(*) into v_count from public.services s where s.category_id = p_id;

  return jsonb_build_object(
    'id',            p_id,
    'name',          v_name,
    'description',   v_desc,
    'icon_name',     v_icon,
    'is_active',     v_active,
    'service_count', v_count
  );
end;
$$;

-- ============================================================================
-- §5  Delete: refused while any service still depends on the category
-- ============================================================================
create or replace function public.delete_service_category(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_count int;
begin
  if not public.has_admin_access() then
    raise exception 'Only the NexTech owner and approved admins can manage categories.'
      using errcode = '42501';
  end if;

  if p_id is null or btrim(p_id) = '' then
    raise exception 'A category id is required.' using errcode = '22023';
  end if;

  select c.name into v_name from public.categories c where c.id = p_id;
  if not found then
    raise exception 'Category % does not exist.', p_id using errcode = 'P0002';
  end if;

  select count(*) into v_count from public.services s where s.category_id = p_id;
  if v_count > 0 then
    raise exception 'This category still has % service(s). Move them to another category before deleting it.', v_count
      using errcode = '23503';
  end if;

  delete from public.categories where id = p_id;

  return jsonb_build_object('deleted_id', p_id, 'name', v_name);
end;
$$;

-- ============================================================================
-- §6  Reassign: move every dependent service to another category first
-- ============================================================================
create or replace function public.reassign_service_category(
  p_from_id text,
  p_to_id   text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved int;
begin
  if not public.has_admin_access() then
    raise exception 'Only the NexTech owner and approved admins can manage categories.'
      using errcode = '42501';
  end if;

  if p_from_id is null or btrim(p_from_id) = '' or p_to_id is null or btrim(p_to_id) = '' then
    raise exception 'Both the current and the target category are required.' using errcode = '22023';
  end if;

  if p_from_id = p_to_id then
    raise exception 'Choose a different category to move the services to.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.categories c where c.id = p_from_id) then
    raise exception 'Category % does not exist.', p_from_id using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.categories c where c.id = p_to_id) then
    raise exception 'Category % does not exist.', p_to_id using errcode = 'P0002';
  end if;

  update public.services
     set category_id = p_to_id
   where category_id = p_from_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- ============================================================================
-- §7  Ownership pinning + grants
-- ============================================================================
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.admin_service_categories()',
    'public.create_service_category(text,text,text)',
    'public.update_service_category(text,text,text,text,boolean)',
    'public.delete_service_category(text)',
    'public.reassign_service_category(text,text)'
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
      raise exception '§7 failed: could not resolve the owner role of %.', v_sig;
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

revoke all on function public.admin_service_categories() from public, anon;
revoke all on function public.create_service_category(text, text, text) from public, anon;
revoke all on function public.update_service_category(text, text, text, text, boolean) from public, anon;
revoke all on function public.delete_service_category(text) from public, anon;
revoke all on function public.reassign_service_category(text, text) from public, anon;

grant execute on function public.admin_service_categories() to authenticated;
grant execute on function public.create_service_category(text, text, text) to authenticated;
grant execute on function public.update_service_category(text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_service_category(text) to authenticated;
grant execute on function public.reassign_service_category(text, text) to authenticated;

-- ============================================================================
-- §8  Postconditions — prove the end state, or roll the whole transaction back
-- ============================================================================
do $$
declare
  v_row    record;
  v_live   record;
  v_ok     boolean;
  v_norm   text;
begin
  for v_row in
    select * from (values
      ('public.admin_service_categories()',                           'jsonb',   's'),
      ('public.create_service_category(text,text,text)',              'jsonb',   'v'),
      ('public.update_service_category(text,text,text,text,boolean)', 'jsonb',   'v'),
      ('public.delete_service_category(text)',                        'jsonb',   'v'),
      ('public.reassign_service_category(text,text)',                 'integer', 'v')
    ) as t(sig, ret, vol)
  loop
    if to_regprocedure(v_row.sig) is null then
      raise exception '§8 failed: % does not exist.', v_row.sig;
    end if;

    select p.prosecdef,
           p.provolatile,
           format_type(p.prorettype, null) as rettype,
           p.proconfig,
           p.prosrc,
           (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
      into v_live
    from pg_proc p
    where p.oid = v_row.sig::regprocedure;

    if v_live.owner is null or v_live.owner <> 'postgres' then
      raise exception '§8 failed: % must be owned by postgres, found %.', v_row.sig, coalesce(v_live.owner, 'NULL');
    end if;
    if not v_live.prosecdef then
      raise exception '§8 failed: % must be SECURITY DEFINER.', v_row.sig;
    end if;

    if v_live.rettype <> v_row.ret then
      raise exception '§8 failed: % must return %, found %.', v_row.sig, v_row.ret, v_live.rettype;
    end if;

    if v_live.provolatile::text <> v_row.vol then
      raise exception '§8 failed: % must be % (found volatility %).',
        v_row.sig, case v_row.vol when 's' then 'STABLE' else 'VOLATILE' end, v_live.provolatile;
    end if;

    select exists (select 1 from unnest(v_live.proconfig) as cfg where cfg = 'search_path=""')
      into v_ok;
    if not coalesce(v_ok, false) then
      raise exception '§8 failed: % must set an empty search_path. Actual proconfig: %.',
        v_row.sig, coalesce(v_live.proconfig::text, 'NULL');
    end if;

    v_norm := pg_temp.norm_sql(v_live.prosrc);
    if v_norm is null then
      raise exception '§8 failed: could not read the body of %.', v_row.sig;
    end if;
    if v_norm not like '%public.has_admin_access()%' then
      raise exception '§8 failed: % must authorize with public.has_admin_access().', v_row.sig;
    end if;
    if v_norm not like '%errcode = ''42501''%' then
      raise exception '§8 failed: % must raise SQLSTATE 42501 for unauthorized callers.', v_row.sig;
    end if;

    -- The gate has to appear before any write. A later editor cannot move the
    -- mutation above has_admin_access() and still pass this postcondition.
    if (
         position('insert into' in v_norm) > 0
         and position('public.has_admin_access()' in v_norm) > position('insert into' in v_norm)
       )
       or (
         position('update public.' in v_norm) > 0
         and position('public.has_admin_access()' in v_norm) > position('update public.' in v_norm)
       )
       or (
         position('delete from' in v_norm) > 0
         and position('public.has_admin_access()' in v_norm) > position('delete from' in v_norm)
       ) then
      raise exception '§8 failed: % must check public.has_admin_access() before it writes.', v_row.sig;
    end if;

    if v_row.sig like 'public.create_service_category%'
       or v_row.sig like 'public.update_service_category%' then
      if v_norm not like '%a category with that name already exists.%' then
        raise exception '§8 failed: % must reject a duplicate category name.', v_row.sig;
      end if;
      if v_norm not like '%errcode = ''23505''%' then
        raise exception '§8 failed: % must raise SQLSTATE 23505 for a duplicate name.', v_row.sig;
      end if;
    end if;

    if v_row.sig like 'public.delete_service_category%' then
      if v_norm not like '%from public.services%'
         or v_norm not like '%errcode = ''23503''%' then
        raise exception '§8 failed: % must refuse to delete a category that still has services (SQLSTATE 23503).', v_row.sig;
      end if;
    end if;

    -- must not reach into any other sensitive table or the auth schema
    if v_norm like '%public.profiles%'
       or v_norm like '%public.orders%'
       or v_norm like '%public.owner_accounts%'
       or v_norm like '%public.admin_accounts%'
       or v_norm like '%public.admin_applications%'
       or v_norm like '%public.service_packages%'
       or v_norm like '%auth.%' then
      raise exception '§8 failed: % must not reference personal information or other tables.', v_row.sig;
    end if;
  end loop;
end;
$$;

-- §8.1  the read function reads public.categories and is strictly read-only
do $$
declare
  v_norm   text;
  v_padded text;
begin
  select pg_temp.norm_sql(p.prosrc) into v_norm
  from pg_proc p
  where p.oid = 'public.admin_service_categories()'::regprocedure;

  if v_norm not like '%from public.categories%' then
    raise exception '§8.1 failed: the category directory must be read from public.categories.';
  end if;

  v_padded := ' ' || v_norm || ' ';
  if v_padded like '% insert %'
     or v_padded like '% update %'
     or v_padded like '% delete %'
     or v_padded like '% truncate %'
     or v_padded like '% alter %'
     or v_padded like '% drop %'
     or v_padded like '% grant %'
     or v_padded like '% create %' then
    raise exception '§8.1 failed: public.admin_service_categories() must be strictly read-only.';
  end if;
end;
$$;

-- §8.2  the write functions touch only the intended tables
do $$
declare
  v_norm text;
begin
  select pg_temp.norm_sql(p.prosrc) into v_norm
  from pg_proc p where p.oid = 'public.create_service_category(text,text,text)'::regprocedure;
  if v_norm not like '%insert into public.categories%' then
    raise exception '§8.2 failed: create_service_category must insert into public.categories.';
  end if;

  select pg_temp.norm_sql(p.prosrc) into v_norm
  from pg_proc p where p.oid = 'public.update_service_category(text,text,text,text,boolean)'::regprocedure;
  if v_norm not like '%update public.categories set%' then
    raise exception '§8.2 failed: update_service_category must update public.categories.';
  end if;

  select pg_temp.norm_sql(p.prosrc) into v_norm
  from pg_proc p where p.oid = 'public.delete_service_category(text)'::regprocedure;
  if v_norm not like '%delete from public.categories%' then
    raise exception '§8.2 failed: delete_service_category must delete from public.categories.';
  end if;

  select pg_temp.norm_sql(p.prosrc) into v_norm
  from pg_proc p where p.oid = 'public.reassign_service_category(text,text)'::regprocedure;
  if v_norm not like '%update public.services set%' then
    raise exception '§8.2 failed: reassign_service_category must update public.services.';
  end if;
end;
$$;

-- §8.3  execute is granted to authenticated only, never to anon/PUBLIC
do $$
declare
  v_sig  text;
  v_sigs text[] := array[
    'public.admin_service_categories()',
    'public.create_service_category(text,text,text)',
    'public.update_service_category(text,text,text,text,boolean)',
    'public.delete_service_category(text)',
    'public.reassign_service_category(text,text)'
  ];
begin
  foreach v_sig in array v_sigs loop
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception '§8.3 failed: authenticated must be able to execute %.', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception '§8.3 failed: the anon role must not be able to execute %.', v_sig;
    end if;
  end loop;
end;
$$;

-- §8.4  nothing else changed: no new table, and every policy count is unchanged
do $$
begin
  if to_regclass('public.admin_service_categories') is not null then
    raise exception '§8.4 failed: this migration must not create a table named public.admin_service_categories.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'categories') <> 2 then
    raise exception '§8.4 failed: the number of policies on public.categories changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'services') <> 2 then
    raise exception '§8.4 failed: the number of policies on public.services changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'service_packages') <> 2 then
    raise exception '§8.4 failed: the number of policies on public.service_packages changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 4 then
    raise exception '§8.4 failed: the number of policies on public.profiles changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orders') <> 2 then
    raise exception '§8.4 failed: the number of policies on public.orders changed.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') <> 0 then
    raise exception '§8.4 failed: public.owner_accounts must remain policy-free.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_accounts') <> 2 then
    raise exception '§8.4 failed: the number of policies on public.admin_accounts changed.';
  end if;
end;
$$;

commit;
