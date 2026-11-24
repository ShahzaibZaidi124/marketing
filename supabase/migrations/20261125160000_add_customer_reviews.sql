-- ============================================================================
-- NexTech — Customer order reviews (schema + read/write-safe policies)
--   20261125160000_add_customer_reviews.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261122120000_add_owner_access.sql  (public.is_owner(), and the
--             orders status check that includes 'completed') — already applied,
--             and re-verified by §1 below.
--             20261115185300_create_client_orders.sql (public.orders) — already
--             applied.
--
-- PHASE 1 of the approved Reports & Reviews plan: database schema ONLY.
--   * creates public.reviews
--   * a customer may review a COMPLETED order they own, exactly once
--   * ratings 1–5, optional written feedback
--   * duplicate reviews per order are impossible (unique constraint)
--   * moderation is a later phase; every new review starts 'pending'
--   * reviews are PRIVATE for now: only the reviewer and the owner can read them.
--     They are deliberately NOT publicly visible (approved decision #1).
--   * reviewer_id is NULLABLE ON DELETE SET NULL, and the moderation decision is
--     keyed on the moderated_at TIMESTAMP rather than on the moderator identity,
--     so deleting a customer or a moderator anonymises the row without
--     invalidating it and without blocking the account deletion (R6 / correction 1)
--
-- What this migration does:
--   §1  fail-closed prerequisite guards: the live owner layer, the orders table
--       (and its 'completed' status), and the profile role-protection trigger must
--       be intact; and public.reviews must NOT already exist
--   §2  public.reviews + its indexes and named constraints
--   §3  the updated_at trigger, and the BEFORE INSERT identity/eligibility trigger
--   §4  grants + RLS: a client may SELECT its own reviews and INSERT its own
--       pending review; there is NO update/delete policy, so moderation cannot be
--       written from a browser
--   §5  pg_temp helpers used only by the §6 postconditions
--   §6  postconditions: any failure rolls the whole transaction back
--
-- What this migration deliberately DOES NOT do:
--   * it never touches public.profiles.role or its protection trigger
--   * it never drops, recreates or alters any existing table, policy or function
--   * it creates no UPDATE / DELETE policy, so authenticated users have no way to
--     change a review's status or content once written
--   * it publishes nothing publicly: there is no policy that lets an arbitrary
--     authenticated user read reviews
--   * it creates no moderation function and no admin directory RPC (later phases)
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
    raise exception '§1.2 failed: public.owner_accounts is empty. Register the NexTech owner account before enabling reviews.';
  end if;
end;
$$;

-- §1.3  public.orders exists with the columns reviews depends on, and its status
--       check still admits 'completed'
do $$
declare
  v_missing text;
  v_def     text;
  v_valid   boolean;
begin
  if to_regclass('public.orders') is null then
    raise exception '§1.3 failed: public.orders is missing. Apply 20261115185300_create_client_orders.sql first.';
  end if;

  select string_agg(col, ', ')
    into v_missing
  from (values ('id'), ('client_id'), ('status'), ('service_id')) as t(col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'orders' and c.column_name = t.col
  );

  if v_missing is not null then
    raise exception '§1.3 failed: public.orders is missing required column(s): %.', v_missing;
  end if;

  select pg_get_constraintdef(con.oid), con.convalidated
    into v_def, v_valid
  from pg_constraint con
  where con.conrelid = 'public.orders'::regclass
    and con.conname  = 'orders_status_check'
    and con.contype  = 'c';

  if v_def is null then
    raise exception '§1.3 failed: constraint orders_status_check is missing on public.orders. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  if v_def <> 'CHECK ((status = ANY (ARRAY[''pending''::text, ''active''::text, ''completed''::text, ''rejected''::text])))' then
    raise exception E'§1.3 failed: orders_status_check has changed.\n  actual: %', v_def;
  end if;

  if not v_valid then
    raise exception '§1.3 failed: orders_status_check is not validated.';
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
--       overwrites a pre-existing reviews table or function of unknown shape
do $$
declare
  v_sig  text;
  v_sigs text[] := array[
    'public.update_reviews_updated_at()',
    'public.nextech_set_review_identity()'
  ];
begin
  if to_regclass('public.reviews') is not null then
    raise exception '§1.5 failed: public.reviews already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is not null then
      raise exception '§1.5 failed: % already exists. Inspect it before applying this migration; it will not be replaced.', v_sig;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §2  public.reviews
-- ============================================================================
-- One review per order, enforced by a unique constraint rather than convention,
-- so a second review for the same order is impossible at the schema level (a
-- browser sees the Postgres 23505 duplicate-key error).
create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  -- Set by the §3 BEFORE INSERT trigger from the verified JWT, never by a client.
  -- Nullable with ON DELETE SET NULL so deleting the customer's auth account
  -- anonymises the review instead of destroying it (approved decision R6). The
  -- trigger still guarantees a non-null identity on every new row.
  reviewer_id     uuid references auth.users (id) on delete set null,
  -- Snapshot of the reviewed order's service id (public.orders.service_id is a
  -- nullable text column); also set by the trigger.
  service_id      text,
  rating          smallint not null,
  body            text not null default '',
  status          text not null default 'pending',
  moderated_by    uuid references auth.users (id) on delete set null,
  moderated_at    timestamptz,
  moderation_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint reviews_order_id_key unique (order_id),
  constraint reviews_rating_check  check (rating between 1 and 5),
  constraint reviews_body_length_check check (char_length(body) <= 4000),
  constraint reviews_status_check
    check (status in ('pending', 'published', 'rejected')),
  constraint reviews_moderation_note_length_check
    check (moderation_note is null or char_length(moderation_note) <= 2000),
  -- A decision is recorded by its TIMESTAMP, not by the moderator's identity:
  -- moderated_by is ON DELETE SET NULL, so keying this rule on the identity would
  -- make deleting a moderator fail. moderated_at is never nulled, so the audit
  -- trail survives while the moderator identity may be anonymised (correction 1).
  constraint reviews_moderation_consistent check (
    (status = 'pending' and moderated_at is null)
    or
    (status <> 'pending' and moderated_at is not null)
  )
);

create index reviews_status_created_idx
  on public.reviews (status, created_at desc);

create index reviews_reviewer_created_idx
  on public.reviews (reviewer_id, created_at desc);

-- ============================================================================
-- §3  Triggers
-- ============================================================================

-- §3a  updated_at (same convention as orders / the service catalog)
create function public.update_reviews_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.update_reviews_updated_at() from public, anon, authenticated;
grant execute on function public.update_reviews_updated_at() to service_role;

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row
  execute function public.update_reviews_updated_at();

-- §3b  Identity + eligibility authoring
--
-- A browser may send only order_id, rating and body. This BEFORE INSERT trigger
-- derives reviewer_id / service_id / status / moderation fields from the verified
-- session and the referenced order, so a forged payload can never review somebody
-- else's order, review an order that is not completed, or pre-mark itself
-- moderated.
--
-- It is SECURITY DEFINER (owned by postgres) so it can read public.orders
-- regardless of RLS; auth.uid() still resolves to the CALLING user, because
-- auth.uid() reads the verified request JWT, not the executing role.
--
-- The trusted-writer check must NOT use current_user: inside a SECURITY DEFINER
-- function current_user is always the owner (postgres), so a current_user test
-- would silently skip the derivation below. auth.role() reads the *verified* JWT
-- role claim that a browser cannot forge; only a genuine service-role writer may
-- set these columns itself. A missing identity fails closed.
create function public.nextech_set_review_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_role  text := coalesce((select auth.role()), '');
  v_order record;
begin
  -- Verified service-role writers (later moderation/server paths) set the columns.
  if v_role = 'service_role' then
    return new;
  end if;

  if v_uid is null then
    raise exception 'An authenticated customer is required to review an order.'
      using errcode = '42501';
  end if;

  select o.client_id, o.service_id, o.status
    into v_order
  from public.orders o
  where o.id = new.order_id;

  if not found then
    raise exception 'The order being reviewed does not exist.' using errcode = '22023';
  end if;

  if v_order.client_id <> v_uid then
    raise exception 'You can only review your own orders.' using errcode = '42501';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Only completed orders can be reviewed.' using errcode = '22023';
  end if;

  new.reviewer_id     := v_uid;
  new.service_id      := v_order.service_id;
  new.status          := 'pending';
  new.moderated_by    := null;
  new.moderated_at    := null;
  new.moderation_note := null;
  new.updated_at      := clock_timestamp();

  return new;
end;
$$;

alter function public.nextech_set_review_identity() owner to postgres;
revoke all on function public.nextech_set_review_identity() from public, anon;
grant execute on function public.nextech_set_review_identity() to authenticated, service_role;

create trigger nextech_set_review_identity
  before insert on public.reviews
  for each row
  execute function public.nextech_set_review_identity();

-- ============================================================================
-- §4  Grants + RLS — read/write-your-own review, moderation is service-role only
-- ============================================================================
alter table public.reviews enable row level security;

revoke all on public.reviews from public, anon, authenticated;
grant select, insert on public.reviews to authenticated;
grant all            on public.reviews to service_role;

-- A reviewer reads its own reviews; the owner reads every review.
create policy "Reviewers read their own reviews"
  on public.reviews for select
  to authenticated
  using ((select auth.uid()) = reviewer_id);

create policy "Owners read all reviews"
  on public.reviews for select
  to authenticated
  using ((select public.is_owner()));

-- A reviewer may create only its own, still-pending review. There is deliberately
-- NO update or delete policy, so once written a review cannot be changed from a
-- browser; moderation is a later, service-role-only phase.
create policy "Reviewers create their own pending review"
  on public.reviews for insert
  to authenticated
  with check (
    (select auth.uid()) = reviewer_id
    and status = 'pending'
    and moderated_by is null
    and moderated_at is null
    and moderation_note is null
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

-- §6.1  the reviews table: ordinary table, RLS on, not forced, owned by postgres
do $$
declare
  v_rec record;
begin
  if to_regclass('public.reviews') is null then
    raise exception '§6.1 failed: public.reviews does not exist.';
  end if;

  select c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.reviews'::regclass;

  if v_rec.relkind <> 'r' then
    raise exception '§6.1 failed: public.reviews must be an ordinary table.';
  end if;
  if not v_rec.relrowsecurity then
    raise exception '§6.1 failed: row level security is not enabled on public.reviews.';
  end if;
  if v_rec.relforcerowsecurity then
    raise exception '§6.1 failed: FORCE ROW LEVEL SECURITY must not be set on public.reviews.';
  end if;
  if v_rec.owner <> 'postgres' then
    raise exception '§6.1 failed: public.reviews must be owned by postgres, found %.', v_rec.owner;
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
    select * from unnest(array['id','order_id','reviewer_id','service_id','rating','body','status','moderated_by','moderated_at','moderation_note','created_at','updated_at'])
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'reviews' and c.column_name = v_col
    ) then
      raise exception '§6.2 failed: public.reviews is missing column %.', v_col;
    end if;
  end loop;

  -- the eligibility columns must be NOT NULL (reviewer_id is intentionally
  -- excluded: it is nullable ON DELETE SET NULL so an account deletion anonymises
  -- the review instead of failing)
  for v_col in select * from unnest(array['order_id','rating','body','status','created_at','updated_at']) loop
    select c.is_nullable into v_null
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'reviews' and c.column_name = v_col;

    if v_null <> 'NO' then
      raise exception '§6.2 failed: public.reviews.% must be NOT NULL.', v_col;
    end if;
  end loop;

  -- the anonymisable identities must be NULLABLE so ON DELETE SET NULL can succeed
  for v_col in select * from unnest(array['reviewer_id','moderated_by']) loop
    select c.is_nullable into v_null
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'reviews' and c.column_name = v_col;

    if v_null <> 'YES' then
      raise exception '§6.2 failed: public.reviews.% must be nullable (ON DELETE SET NULL).', v_col;
    end if;
  end loop;
end;
$$;

-- §6.3  constraints: exactly one review per order, valid rating/status/body, FK
--       cascade for the order, FK SET NULL for the reviewer, and the moderation
--       consistency rule keyed on the timestamp (not the moderator identity)
do $$
declare
  v_rec record;
  v_def text;
begin
  -- one review per order
  select con.contype, con.convalidated,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_order_id_key';

  if not found then
    raise exception '§6.3 failed: constraint reviews_order_id_key is missing on public.reviews.';
  end if;
  if v_rec.contype <> 'u' then
    raise exception '§6.3 failed: reviews_order_id_key must be a UNIQUE constraint.';
  end if;
  if not v_rec.convalidated then
    raise exception '§6.3 failed: reviews_order_id_key is not validated.';
  end if;
  if v_rec.cols <> array['order_id'] then
    raise exception '§6.3 failed: reviews_order_id_key must cover exactly (order_id), found %.', v_rec.cols;
  end if;

  -- order foreign key, cascade
  select con.contype, con.confrelid, con.confdeltype
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_order_id_fkey';

  if not found then
    raise exception '§6.3 failed: constraint reviews_order_id_fkey is missing on public.reviews.';
  end if;
  if v_rec.contype <> 'f' then
    raise exception '§6.3 failed: reviews_order_id_fkey must be a FOREIGN KEY.';
  end if;
  if v_rec.confrelid <> 'public.orders'::regclass then
    raise exception '§6.3 failed: reviews_order_id_fkey must reference public.orders.';
  end if;
  if v_rec.confdeltype <> 'c' then
    raise exception '§6.3 failed: reviews_order_id_fkey must be ON DELETE CASCADE.';
  end if;

  -- reviewer foreign key, SET NULL (deleting the account anonymises the review
  -- instead of blocking the deletion)
  select con.contype, con.confrelid, con.confdeltype
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_reviewer_id_fkey';

  if not found then
    raise exception '§6.3 failed: constraint reviews_reviewer_id_fkey is missing on public.reviews.';
  end if;
  if v_rec.contype <> 'f' then
    raise exception '§6.3 failed: reviews_reviewer_id_fkey must be a FOREIGN KEY.';
  end if;
  if v_rec.confrelid <> 'auth.users'::regclass then
    raise exception '§6.3 failed: reviews_reviewer_id_fkey must reference auth.users.';
  end if;
  if v_rec.confdeltype <> 'n' then
    raise exception '§6.3 failed: reviews_reviewer_id_fkey must be ON DELETE SET NULL.';
  end if;

  -- check constraints present and validated
  for v_rec in
    select * from unnest(array[
      'reviews_rating_check',
      'reviews_body_length_check',
      'reviews_status_check',
      'reviews_moderation_note_length_check',
      'reviews_moderation_consistent'
    ]) as t(name)
  loop
    if not exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.reviews'::regclass and con.conname = v_rec.name and con.contype = 'c'
    ) then
      raise exception '§6.3 failed: CHECK constraint % is missing on public.reviews.', v_rec.name;
    end if;

    if not (select con.convalidated from pg_constraint con
            where con.conrelid = 'public.reviews'::regclass and con.conname = v_rec.name) then
      raise exception '§6.3 failed: CHECK constraint % is not validated.', v_rec.name;
    end if;
  end loop;

  -- the moderation rule must key the decision on the moderated_at timestamp and
  -- must never reference moderated_by (which is ON DELETE SET NULL), otherwise
  -- deleting a moderator would violate it (correction 1)
  select pg_temp.norm_sql(pg_get_constraintdef(con.oid))
    into v_def
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_moderation_consistent';

  if v_def is null then
    raise exception '§6.3 failed: could not read reviews_moderation_consistent.';
  end if;

  if v_def like '%moderated_by%' then
    raise exception '§6.3 failed: reviews_moderation_consistent must not reference moderated_by.';
  end if;

  if v_def not like '%moderated_at%' then
    raise exception '§6.3 failed: reviews_moderation_consistent must key the decision on moderated_at.';
  end if;
end;
$$;

-- §6.4  the two indexes exist
do $$
begin
  if to_regclass('public.reviews_status_created_idx') is null then
    raise exception '§6.4 failed: index reviews_status_created_idx is missing.';
  end if;
  if to_regclass('public.reviews_reviewer_created_idx') is null then
    raise exception '§6.4 failed: index reviews_reviewer_created_idx is missing.';
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
    where tgrelid = 'public.reviews'::regclass
      and tgname = 'reviews_set_updated_at'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§6.5 failed: the reviews updated_at trigger is missing or disabled.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reviews'::regclass
      and tgname = 'nextech_set_review_identity'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§6.5 failed: the reviews identity trigger is missing or disabled.';
  end if;

  select p.prosecdef,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.nextech_set_review_identity()'::regprocedure;

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
  where p.oid = 'public.nextech_set_review_identity()'::regprocedure;

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

  if v_norm not like '%from public.orders%' then
    raise exception '§6.6 failed: the identity trigger does not read the reviewed order from public.orders.';
  end if;

  if v_norm not like '%client_id%' then
    raise exception '§6.6 failed: the identity trigger does not check order ownership (client_id).';
  end if;

  if v_norm not like '%completed%' then
    raise exception '§6.6 failed: the identity trigger does not require a completed order.';
  end if;

  if v_norm not like '%errcode = ''42501''%' then
    raise exception '§6.6 failed: the identity trigger must reject unauthorized callers with SQLSTATE 42501.';
  end if;

  if v_norm not like '%''pending''%' then
    raise exception '§6.6 failed: the identity trigger must force the review to pending.';
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
      ('Reviewers read their own reviews',   'SELECT', '(select auth.uid()) = reviewer_id'),
      ('Owners read all reviews',            'SELECT', '(select public.is_owner())'),
      ('Reviewers create their own pending review', 'INSERT', null)
    ) as t(pol, cmd, expected_qual)
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'reviews' and p.policyname = v_exp.pol;

    if not found then
      raise exception '§6.7 failed: policy "%" on public.reviews is missing.', v_exp.pol;
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

  -- the INSERT policy's WITH CHECK must pin identity + pending + decision-free
  select regexp_replace(lower(p.with_check), '\s', '', 'g')
    into v_check
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'reviews'
    and p.policyname = 'Reviewers create their own pending review';

  if v_check not like '%auth.uid()%'
     or v_check not like '%=reviewer_id%'
     or v_check not like '%status=''pending''%'
     or v_check not like '%moderated_byisnull%'
     or v_check not like '%moderated_atisnull%'
     or v_check not like '%moderation_noteisnull%' then
    raise exception E'§6.7 failed: the reviewer INSERT policy does not pin identity and pending state.\n  actual: %', v_check;
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'reviews') <> 3 then
    raise exception '§6.7 failed: expected exactly 3 policies on public.reviews, found %.',
      (select count(*) from pg_policies where schemaname = 'public' and tablename = 'reviews');
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reviews'
      and cmd not in ('SELECT', 'INSERT')
  ) then
    raise exception '§6.7 failed: public.reviews must not have an UPDATE/DELETE/ALL policy.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reviews'
      and roles::text[] && array['anon', 'public']::text[]
  ) then
    raise exception '§6.7 failed: a public.reviews policy is exposed to anon/public.';
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
  if not has_table_privilege('authenticated', 'public.reviews', 'SELECT')
     or not has_table_privilege('authenticated', 'public.reviews', 'INSERT') then
    raise exception '§6.8 failed: authenticated must be able to SELECT and INSERT public.reviews.';
  end if;

  foreach v_priv in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.reviews', v_priv) then
      raise exception '§6.8 failed: authenticated must not hold % on public.reviews.', v_priv;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.reviews', 'SELECT')
     or has_table_privilege('anon', 'public.reviews', 'INSERT')
     or has_table_privilege('anon', 'public.reviews', 'UPDATE')
     or has_table_privilege('anon', 'public.reviews', 'DELETE') then
    raise exception '§6.8 failed: the anon role must have no privileges on public.reviews.';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.reviews', v_priv) then
      raise exception '§6.8 failed: service_role must hold % on public.reviews.', v_priv;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.nextech_set_review_identity()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.nextech_set_review_identity()', 'EXECUTE') then
    raise exception '§6.8 failed: the identity trigger function must be executable by authenticated and service_role.';
  end if;

  if has_function_privilege('anon', 'public.nextech_set_review_identity()', 'EXECUTE') then
    raise exception '§6.8 failed: the identity trigger function must not be executable by anon/PUBLIC.';
  end if;

  if not has_function_privilege('service_role', 'public.update_reviews_updated_at()', 'EXECUTE') then
    raise exception '§6.8 failed: the updated_at trigger function must be executable by service_role.';
  end if;

  if has_function_privilege('authenticated', 'public.update_reviews_updated_at()', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_reviews_updated_at()', 'EXECUTE') then
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
      ('messages',         'Owners read all messages',                                  'SELECT')
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

-- §6.10  account-deletion safety (correction 1 / R6): deleting a customer's or a
--        moderator's auth account must ANONYMISE the review, never fail and never
--        destroy the row. Proves the three invariants together.
do $$
declare
  v_reviewer_nullable  text;
  v_moderator_nullable text;
  v_reviewer_action    text;
  v_moderator_action   text;
  v_rule               text;
begin
  select c.is_nullable into v_reviewer_nullable
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'reviews' and c.column_name = 'reviewer_id';

  select c.is_nullable into v_moderator_nullable
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'reviews' and c.column_name = 'moderated_by';

  if v_reviewer_nullable <> 'YES' or v_moderator_nullable <> 'YES' then
    raise exception '§6.10 failed: reviewer_id and moderated_by must both be nullable so ON DELETE SET NULL can succeed.';
  end if;

  select con.confdeltype into v_reviewer_action
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_reviewer_id_fkey' and con.contype = 'f';

  if v_reviewer_action <> 'n' then
    raise exception '§6.10 failed: reviews_reviewer_id_fkey must be ON DELETE SET NULL.';
  end if;

  select con.confdeltype into v_moderator_action
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_moderated_by_fkey' and con.contype = 'f';

  if v_moderator_action <> 'n' then
    raise exception '§6.10 failed: reviews_moderated_by_fkey must be ON DELETE SET NULL.';
  end if;

  select pg_get_constraintdef(con.oid) into v_rule
  from pg_constraint con
  where con.conrelid = 'public.reviews'::regclass and con.conname = 'reviews_moderation_consistent';

  if v_rule like '%moderated_by%' then
    raise exception '§6.10 failed: the moderation rule must not depend on moderated_by, or deleting a moderator would fail.';
  end if;
end;
$$;

commit;
