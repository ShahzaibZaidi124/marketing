-- ============================================================================
-- NexTech — Persistent Admin Activity Log
--   20261126130000_add_activity_log.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261122120000_add_owner_access.sql        (public.owner_accounts)
--             20261124120000_add_admin_access.sql        (public.has_admin_access(),
--                                                        public.review_admin_application)
--             20261125210000_add_admin_category_management.sql (the category RPCs)
--             20261126120000_add_platform_settings.sql   (public.update_platform_settings)
--   All four are already applied.
--
-- WHY THIS EXISTS
--   "Admin → Activity Log" is currently a browser-memory preview: the dashboard
--   pushes a description into React state and it disappears on refresh. This
--   migration makes administrative actions persist in the database, written by
--   the server as part of the same transaction that performs the action, so a
--   record can never be forged from a browser and can never disagree with the
--   action it describes.
--
--   The log lives in public.activity_log. RLS is enabled with NO policies, so no
--   client role (anon, authenticated) can read or write it directly. Every write
--   happens inside the SECURITY DEFINER action functions; every read goes through
--   one SECURITY DEFINER RPC:
--     * public.record_activity(...)     — the ONLY writer. NOT executable by the
--                                         authenticated/anon roles, so a client
--                                         can never create an entry. It is called
--                                         from the postgres-owned action functions
--                                         below (the owner always keeps EXECUTE).
--     * public.admin_activity_log(...)  — READ for the owner + approved admins,
--                                         gated by public.has_admin_access() and
--                                         raising 42501 for anyone else.
--
--   RECORDED ACTIONS (the six existing write paths):
--     admin application approved / rejected   (public.review_admin_application)
--     category created / updated / deleted    (public.create/update/delete_service_category)
--     category services reassigned            (public.reassign_service_category)
--     platform settings updated               (public.update_platform_settings)
--
--   PRIVACY BY CONSTRUCTION
--     * The actor is stored as actor_id (auth.uid(), or the reviewer id the Edge
--       Function derived from the verified JWT) and is NEVER returned: the read
--       RPC exposes only the derived role word "Owner"/"Admin", matching the
--       dashboard's rule that actor names, emails and ids are not shown.
--     * A summary is a short, server-built sentence. It NEVER contains a settings
--       value, a message body, an email address or any customer field. For an
--       admin application it uses only the application's opaque id, not the
--       applicant's name.
--     * No password, token or service-role key is stored or referenced.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * it creates or alters NO policy on any existing table
--   * it never grants ANY role (anon, authenticated or service_role) a direct
--     table privilege on public.activity_log — least privilege leaves the writes
--     to the postgres-owned SECURITY DEFINER functions
--   * it never grants EXECUTE on record_activity to authenticated or anon
--   * it does not touch public.owner_accounts / admin_accounts / admin_applications
--     rows, public.profiles, public.orders or any customer data
--   * it puts no service-role key anywhere near the browser
--   * it does not (and cannot) recover historical actions that were never recorded
--
--   The six action functions are re-created with create or replace: their
--   authorization, validation and return values are byte-for-byte the reviewed
--   versions, with exactly ONE added step — a perform public.record_activity(...)
--   after the mutation succeeds and before the function returns.
--
-- HOW TO RUN (manual, later)
--   Run the ENTIRE file as ONE batch, as the postgres role.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guard — fail closed
-- ============================================================================
-- §1.1  public.has_admin_access(): the reviewed shape the read RPC gates on.
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.has_admin_access()') is null then
    raise exception '§1.1 failed: public.has_admin_access() is missing. Apply 20261124120000_add_admin_access.sql first.';
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
    raise exception '§1.1 failed: public.has_admin_access() must be a zero-argument boolean function.';
  end if;

  if not v_rec.prosecdef then
    raise exception '§1.1 failed: public.has_admin_access() must be SECURITY DEFINER.';
  end if;

  v_owner := v_rec.owner;
  if v_owner is null or v_owner <> 'postgres' then
    raise exception '§1.1 failed: public.has_admin_access() must be owned by postgres, found %.', coalesce(v_owner, 'NULL');
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§1.1 failed: public.has_admin_access() must set an empty search_path. Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;
end;
$$;

-- §1.2  public.owner_accounts and public.admin_accounts: present (record_activity
--       derives the actor role from these membership records).
do $$
begin
  if to_regclass('public.owner_accounts') is null then
    raise exception '§1.2 failed: public.owner_accounts is missing. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  if to_regclass('public.admin_accounts') is null then
    raise exception '§1.2 failed: public.admin_accounts is missing. Apply 20261124120000_add_admin_access.sql first.';
  end if;
end;
$$;

-- §1.3  the six action functions this migration re-creates must already exist, so
--       a missing prerequisite fails here instead of silently creating a schema
--       that forgets to log an action.
do $$
declare
  v_sig  text;
  v_sigs text[] := array[
    'public.create_service_category(text,text,text)',
    'public.update_service_category(text,text,text,text,boolean)',
    'public.delete_service_category(text)',
    'public.reassign_service_category(text,text)',
    'public.update_platform_settings(text,text,text,text)',
    'public.review_admin_application(uuid,text,uuid,text)'
  ];
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception '§1.3 failed: % is missing. Apply its migration before this one.', v_sig;
    end if;
  end loop;

  if to_regclass('public.activity_log') is not null then
    raise exception '§1.3 failed: public.activity_log already exists; this migration has been run.';
  end if;
end;
$$;

-- ============================================================================
-- §2  public.activity_log — append-only, unreadable/unwritable by clients
-- ============================================================================
create table public.activity_log (
  id          bigint generated always as identity primary key,
  -- The actor is required and recorded for audit, but it is never projected by
  -- any read RPC. ON DELETE SET NULL keeps the audit row if the account is
  -- removed, without cascading.
  actor_id    uuid references auth.users(id) on delete set null,
  actor_role  text not null check (actor_role in ('owner', 'admin')),
  action      text not null check (action in (
                'admin_application.approved',
                'admin_application.rejected',
                'category.created',
                'category.updated',
                'category.deleted',
                'category.reassigned',
                'settings.updated'
              )),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id   text check (target_id   is null or char_length(target_id)   <= 200),
  summary     text not null check (char_length(summary) between 1 and 300),
  created_at  timestamptz not null default clock_timestamp()
);

-- Newest-first reads are the only access pattern; id breaks ties and stabilises
-- pagination when two rows share a timestamp.
create index activity_log_created_at_idx
  on public.activity_log (created_at desc, id desc);

-- The SECURITY DEFINER functions run as the table owner, so the owner MUST be a
-- role that bypasses this policy-less RLS. Pin it to postgres, like every other
-- object in this schema.
alter table public.activity_log owner to postgres;

alter table public.activity_log enable row level security;

-- No policies at all: RLS on with zero policies denies every client role. All
-- access is via the SECURITY DEFINER functions below, which run as the postgres
-- table owner and therefore need no explicit table privilege. No role — not even
-- service_role — gets a direct grant: least privilege keeps the only writer the
-- SECURITY DEFINER functions.
revoke all on public.activity_log from public, anon, authenticated, service_role;

-- ============================================================================
-- §3  public.record_activity(...) — the only writer, not callable by clients
-- ============================================================================
-- Derives the actor from auth.uid() by default (the caller). The service-role
-- path (review_admin_application, called by an Edge Function) passes the
-- reviewer id explicitly, because auth.uid() is null when the service-role key
-- is used; that value is re-validated against owner_accounts by that function
-- before it ever reaches here. The role is NEVER taken from the caller, and an
-- actor who is neither the owner nor an APPROVED admin is refused. There is NO
-- grant to authenticated or anon, so a browser cannot create an entry.
create or replace function public.record_activity(
  p_actor       uuid,
  p_action      text,
  p_target_type text,
  p_target_id   text,
  p_summary     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := coalesce(p_actor, (select auth.uid()));
  v_summary text := btrim(coalesce(p_summary, ''));
  v_role    text;
begin
  if v_actor is null then
    raise exception 'An activity actor is required.' using errcode = '22023';
  end if;
  if coalesce(p_action, '') = '' then
    raise exception 'An activity action is required.' using errcode = '22023';
  end if;
  if v_summary = '' then
    raise exception 'An activity summary is required.' using errcode = '22023';
  end if;
  if char_length(v_summary) > 300 then
    raise exception 'Activity summaries must be 300 characters or fewer.' using errcode = '22023';
  end if;

  -- The role is derived ONLY from the membership records, never from anything the
  -- caller supplies. An owner is 'owner'; anyone else must hold a matching
  -- approved admin_accounts record to be 'admin'. Someone who is neither is
  -- refused outright, so a forged actor can never be logged.
  if exists (select 1 from public.owner_accounts o where o.user_id = v_actor) then
    v_role := 'owner';
  elsif exists (select 1 from public.admin_accounts a where a.user_id = v_actor) then
    v_role := 'admin';
  else
    raise exception 'Only the NexTech owner and approved admins can record activity.'
      using errcode = '42501';
  end if;

  insert into public.activity_log (actor_id, actor_role, action, target_type, target_id, summary)
  values (
    v_actor,
    v_role,
    p_action,
    nullif(btrim(coalesce(p_target_type, '')), ''),
    nullif(btrim(coalesce(p_target_id, '')), ''),
    v_summary
  );
end;
$$;

alter function public.record_activity(uuid, text, text, text, text) owner to postgres;
-- Deliberately no grant to authenticated/anon: clients cannot forge entries.
revoke all on function public.record_activity(uuid, text, text, text, text) from public, anon, authenticated;

-- ============================================================================
-- §4  public.admin_activity_log(...) — read for the owner + approved admins
-- ============================================================================
-- Returns ONLY the fields the dashboard renders. actor_id is never selected, so
-- actor identities cannot leak. Newest-first, paginated, filterable by action and
-- by actor role.
create or replace function public.admin_activity_log(
  p_limit      int  default 50,
  p_offset     int  default 0,
  p_action     text default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  int  := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset int  := greatest(0, coalesce(p_offset, 0));
  v_action text := nullif(btrim(coalesce(p_action, '')), '');
  v_role   text := nullif(btrim(coalesce(p_actor_role, '')), '');
  v_entries jsonb;
begin
  -- The only authorization decision: derived server-side (owner OR approved admin).
  if not public.has_admin_access() then
    raise exception 'The activity log is available to the owner and approved admins only.'
      using errcode = '42501';
  end if;

  -- An unrecognised role filter is ignored rather than erroring; action is matched
  -- exactly and an unknown value simply yields no rows.
  if v_role is not null and v_role not in ('owner', 'admin') then
    v_role := null;
  end if;

  select coalesce(jsonb_agg(row_to_json(entry)), '[]'::jsonb)
    into v_entries
  from (
    select l.id,
           l.action,
           l.actor_role,
           l.target_type,
           l.target_id,
           l.summary,
           l.created_at
    from public.activity_log l
    where (v_action is null or l.action = v_action)
      and (v_role   is null or l.actor_role = v_role)
    order by l.created_at desc, l.id desc
    limit v_limit
    offset v_offset
  ) as entry;

  return v_entries;
end;
$$;

alter function public.admin_activity_log(int, int, text, text) owner to postgres;
revoke all on function public.admin_activity_log(int, int, text, text) from public, anon;
grant execute on function public.admin_activity_log(int, int, text, text) to authenticated, service_role;

-- ============================================================================
-- §5  Instrument the six action functions (create or replace, logic unchanged)
-- ============================================================================

-- §5.1  category create — logs category.created
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

  if exists (
    select 1
    from public.categories c
    where lower(btrim(c.name)) = lower(v_name)
  ) then
    raise exception 'A category with that name already exists.' using errcode = '23505';
  end if;

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

  -- Activity is committed with the action (same transaction): if this fails, the
  -- category insert rolls back too, so a successful response always has a record.
  perform public.record_activity(
    (select auth.uid()),
    'category.created',
    'category',
    v_id,
    format('Created category "%s".', v_name)
  );

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

-- §5.2  category update — logs category.updated
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

  perform public.record_activity(
    (select auth.uid()),
    'category.updated',
    'category',
    p_id,
    format('Updated category "%s".', v_name)
  );

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

-- §5.3  category delete — logs category.deleted
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

  perform public.record_activity(
    (select auth.uid()),
    'category.deleted',
    'category',
    p_id,
    format('Deleted category "%s".', v_name)
  );

  return jsonb_build_object('deleted_id', p_id, 'name', v_name);
end;
$$;

-- §5.4  category reassign — logs category.reassigned
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
  v_from_name text;
  v_to_name   text;
  v_moved     int;
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

  select c.name into v_from_name from public.categories c where c.id = p_from_id;
  if not found then
    raise exception 'Category % does not exist.', p_from_id using errcode = 'P0002';
  end if;

  select c.name into v_to_name from public.categories c where c.id = p_to_id;
  if not found then
    raise exception 'Category % does not exist.', p_to_id using errcode = 'P0002';
  end if;

  update public.services
     set category_id = p_to_id
   where category_id = p_from_id;

  get diagnostics v_moved = row_count;

  perform public.record_activity(
    (select auth.uid()),
    'category.reassigned',
    'category',
    p_from_id,
    format('Moved %s service(s) from category "%s" to "%s".', v_moved, v_from_name, v_to_name)
  );

  return v_moved;
end;
$$;

-- §5.5  platform settings update — logs settings.updated (NO values in the summary)
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

  -- The summary deliberately carries NO setting value, so an approved admin who
  -- can see this entry learns only that the settings changed, never their content.
  perform public.record_activity(
    (select auth.uid()),
    'settings.updated',
    'settings',
    'site',
    'Updated platform settings.'
  );

  return v_row;
end;
$$;

-- §5.6  admin application decision — logs approved / rejected
--       The actor is the reviewer id the Edge Function derived from the verified
--       JWT; record_activity maps it to the 'owner' role via owner_accounts.
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

  if not exists (select 1 from public.owner_accounts where user_id = p_reviewer_id) then
    raise exception 'Only the NexTech owner can review admin applications.' using errcode = '42501';
  end if;

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

  -- Only the opaque application id is used — never the applicant's name or email.
  perform public.record_activity(
    p_reviewer_id,
    case when p_decision = 'approved'
         then 'admin_application.approved'
         else 'admin_application.rejected'
    end,
    'admin_application',
    v_app.id::text,
    format('%s admin application %s.',
           case when p_decision = 'approved' then 'Approved' else 'Rejected' end,
           left(v_app.id::text, 8))
  );

  return v_app;
end;
$$;

-- ============================================================================
-- §6  Ownership pinning + grants for the re-created action functions
-- ============================================================================
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.create_service_category(text,text,text)',
    'public.update_service_category(text,text,text,text,boolean)',
    'public.delete_service_category(text)',
    'public.reassign_service_category(text,text)',
    'public.update_platform_settings(text,text,text,text)',
    'public.review_admin_application(uuid,text,uuid,text)'
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

-- create or replace preserves existing grants; re-assert them anyway so the
-- privilege state is explicit and reviewable (review_admin_application stays
-- service_role-only; the category RPCs stay authenticated).
revoke all on function public.create_service_category(text, text, text) from public, anon;
revoke all on function public.update_service_category(text, text, text, text, boolean) from public, anon;
revoke all on function public.delete_service_category(text) from public, anon;
revoke all on function public.reassign_service_category(text, text) from public, anon;
revoke all on function public.update_platform_settings(text, text, text, text) from public, anon;
revoke all on function public.review_admin_application(uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.create_service_category(text, text, text) to authenticated;
grant execute on function public.update_service_category(text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_service_category(text) to authenticated;
grant execute on function public.reassign_service_category(text, text) to authenticated;
grant execute on function public.update_platform_settings(text, text, text, text) to authenticated, service_role;
grant execute on function public.review_admin_application(uuid, text, uuid, text) to service_role;

-- ============================================================================
-- §7  Postconditions — prove the end state, or roll everything back
-- ============================================================================

-- §7.1  the table: ordinary table, RLS on, not forced, owned by postgres
do $$
declare
  v_rec record;
begin
  if to_regclass('public.activity_log') is null then
    raise exception '§7.1 failed: public.activity_log does not exist.';
  end if;

  select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.activity_log'::regclass;

  if v_rec.relkind <> 'r' then
    raise exception '§7.1 failed: public.activity_log must be an ordinary table.';
  end if;
  if not v_rec.relrowsecurity then
    raise exception '§7.1 failed: row level security is not enabled on public.activity_log.';
  end if;
  if v_rec.relforcerowsecurity then
    raise exception '§7.1 failed: FORCE ROW LEVEL SECURITY must not be set on public.activity_log.';
  end if;
  if v_rec.owner <> 'postgres' then
    raise exception '§7.1 failed: public.activity_log must be owned by postgres, found %.', v_rec.owner;
  end if;
end;
$$;

-- §7.2  no policy, and NO role holds any table privilege on the table
--       (least privilege: the only writer is the postgres-owned SECURITY DEFINER
--       functions, which act as the table owner and need no explicit grant, so
--       not even service_role gets a direct privilege)
do $$
declare
  v_priv text;
  v_role text;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_log'
  ) then
    raise exception '§7.2 failed: public.activity_log must not have any RLS policy.';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(v_role, 'public.activity_log', v_priv) then
        raise exception '§7.2 failed: no role may hold % on public.activity_log, but % does.', v_priv, v_role;
      end if;
    end loop;
  end loop;
end;
$$;

-- §7.3  functions: SECURITY DEFINER, owned by postgres, empty search_path
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.record_activity(uuid,text,text,text,text)',
    'public.admin_activity_log(int,int,text,text)'
  ];
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception '§7.3 failed: % does not exist.', v_sig;
    end if;

    select p.prosecdef, p.proconfig,
           (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
      into v_rec
    from pg_proc p
    where p.oid = v_sig::regprocedure;

    v_owner := v_rec.owner;
    if v_owner is null or v_owner <> 'postgres' then
      raise exception '§7.3 failed: % must be owned by postgres, found %.', v_sig, coalesce(v_owner, 'NULL');
    end if;
    if not v_rec.prosecdef then
      raise exception '§7.3 failed: % must be SECURITY DEFINER.', v_sig;
    end if;

    select exists (
      select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
    ) into v_ok;

    if not coalesce(v_ok, false) then
      raise exception '§7.3 failed: % must set an empty search_path. Actual proconfig: %.',
        v_sig, coalesce(v_rec.proconfig::text, 'NULL');
    end if;
  end loop;
end;
$$;

-- §7.4  grants: clients cannot FORGE entries; the owner + admins can READ
do $$
begin
  -- record_activity must NOT be executable by any client role.
  if has_function_privilege('anon', 'public.record_activity(uuid,text,text,text,text)', 'EXECUTE') then
    raise exception '§7.4 failed: the anon role must not be able to EXECUTE record_activity().';
  end if;
  if has_function_privilege('authenticated', 'public.record_activity(uuid,text,text,text,text)', 'EXECUTE') then
    raise exception '§7.4 failed: the authenticated role must not be able to EXECUTE record_activity().';
  end if;

  -- the reader is reachable by authenticated (gate still applies), not by anon.
  if has_function_privilege('anon', 'public.admin_activity_log(int,int,text,text)', 'EXECUTE') then
    raise exception '§7.4 failed: the anon role must not be able to EXECUTE admin_activity_log().';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_activity_log(int,int,text,text)', 'EXECUTE') then
    raise exception '§7.4 failed: the authenticated role must be able to EXECUTE admin_activity_log().';
  end if;
end;
$$;

-- §7.5  the reader gates on has_admin_access(); every action function logs
do $$
declare
  v_def   text;
  v_sig   text;
  v_sigs  text[] := array[
    'public.create_service_category(text,text,text)',
    'public.update_service_category(text,text,text,text,boolean)',
    'public.delete_service_category(text)',
    'public.reassign_service_category(text,text)',
    'public.update_platform_settings(text,text,text,text)',
    'public.review_admin_application(uuid,text,uuid,text)'
  ];
begin
  v_def := lower(pg_get_functiondef('public.admin_activity_log(int,int,text,text)'::regprocedure));
  if v_def !~ 'if\s+not\s+public\.has_admin_access\(\)\s+then' then
    raise exception '§7.5 failed: admin_activity_log() does not gate on public.has_admin_access().';
  end if;

  foreach v_sig in array v_sigs loop
    v_def := lower(pg_get_functiondef(v_sig::regprocedure));
    if v_def !~ 'public\.record_activity\(' then
      raise exception '§7.5 failed: % does not call public.record_activity().', v_sig;
    end if;
  end loop;
end;
$$;

-- §7.6  behavioral probe: a non-admin authenticated caller is refused, and the
--       refused call writes nothing
do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_failed  boolean := false;
  v_before  bigint;
  v_after   bigint;
begin
  select count(*) into v_before from public.activity_log;

  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_uid::text)::text, true);

  begin
    perform public.admin_activity_log();
  exception
    when insufficient_privilege then v_failed := true;
  end;

  if not v_failed then
    raise exception '§7.6 failed: admin_activity_log() allowed a non-admin caller.';
  end if;

  select count(*) into v_after from public.activity_log;
  if v_after <> v_before then
    raise exception '§7.6 failed: a refused read changed the activity log.';
  end if;

  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- §7.7  preservation: the owner/admin layer and its policies are untouched
do $$
declare
  v_pair record;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_accounts'
  ) then
    raise exception '§7.7 failed: public.owner_accounts must not have gained any RLS policy.';
  end if;

  if has_table_privilege('authenticated', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'DELETE') then
    raise exception '§7.7 failed: the authenticated role must still have no privileges on public.owner_accounts.';
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
      raise exception '§7.7 failed: existing policy "%" on public.% is missing.', v_pair.pol, v_pair.tbl;
    end if;
  end loop;
end;
$$;

commit;

-- ============================================================================
-- AFTER this migration commits:
--   * public.activity_log exists: append-only, RLS on with NO policies, NO direct
--     table privilege for any role, writable only by the SECURITY DEFINER action
--     functions (which run as the postgres table owner).
--   * record_activity() is NOT executable by authenticated/anon — clients cannot
--     forge an entry.
--   * admin_activity_log() lets the owner and approved admins read a newest-first,
--     paginated, filterable feed that shows only action + role + summary + time.
--   * The six write paths now persist an activity record in the same transaction
--     as the action, so a successful response always corresponds to a record.
--   * Historical browser-preview entries are NOT recovered; the feed starts empty.
-- ============================================================================
