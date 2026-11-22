-- ============================================================================
-- NexTech — Customer <-> Owner messaging
--   20261123120000_add_messaging.sql
--
-- REVIEW ARTIFACT — written to disk, NOT executed.
--
-- DEPENDS ON: 20261122120000_add_owner_access.sql (already applied).
--             §1 re-verifies that live owner layer and aborts if it is missing
--             or has been changed.
--
-- What this migration does:
--   §1  fail-closed prerequisite guard: the live owner layer must be intact, and
--       none of this migration's own objects (the two tables and the two write
--       functions) may already exist — it creates them, it never overwrites them
--   §2  creates public.conversations + public.messages (exactly one conversation
--       per customer; a message can never be attached to another customer's thread)
--   §3  grants + RLS: clients can only SELECT; every write is service-role only
--   §4  the two SECURITY DEFINER write functions (service_role EXECUTE only)
--   §5  pg_temp expression helper used only by the §6 postconditions
--   §6  postconditions: any failure rolls the whole transaction back
--
-- What this migration deliberately DOES NOT do:
--   * it never touches public.profiles.role or its protection trigger
--   * it never drops, recreates or alters any existing customer or owner policy
--   * it creates no INSERT / UPDATE / DELETE policy, so authenticated users have
--     no write path at all — every mutation goes through the two §4 functions
--   * it enables no Realtime publication and stores no attachments
--
-- HOW TO RUN (manual, later):
--   1. Run the ENTIRE file as ONE batch, as the postgres role.
--   2. Then deploy the send-message and mark-read Edge Functions.
-- ============================================================================

begin;

-- ============================================================================
-- §1  Prerequisite guard — the owner layer must already be live and unchanged
-- ============================================================================

-- §1.1  public.is_owner(): zero-arg boolean, SECURITY DEFINER, owned by postgres,
--       empty search_path
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

  if v_rec.pronargs <> 0 then
    raise exception '§1.1 failed: public.is_owner() must take no arguments.';
  end if;

  if v_rec.prorettype <> 'boolean'::regtype then
    raise exception '§1.1 failed: public.is_owner() must return boolean.';
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
    raise exception '§1.1 failed: public.is_owner() must set an empty search_path (proconfig element search_path=""). Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;
end;
$$;

-- §1.2  public.owner_accounts: locked down, empty of policies, and holding the
--       registered owner account
do $$
declare
  v_rec record;
begin
  if to_regclass('public.owner_accounts') is null then
    raise exception '§1.2 failed: public.owner_accounts is missing. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  select c.relkind,
         c.relrowsecurity,
         c.relforcerowsecurity,
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
    raise exception '§1.2 failed: FORCE ROW LEVEL SECURITY must NOT be set on public.owner_accounts (it would make is_owner() return false for everyone).';
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
    raise exception '§1.2 failed: public.owner_accounts is empty. Register the NexTech owner account before enabling messaging.';
  end if;
end;
$$;

-- §1.3  the four owner read policies from the owner migration are still present
do $$
declare
  v_pair record;
begin
  for v_pair in
    select * from (values
      ('orders',           'Owners can read all orders'),
      ('profiles',         'Owners can read all profiles'),
      ('services',         'Owners can read all services'),
      ('service_packages', 'Owners can read all service packages')
    ) as t(tbl, pol)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = v_pair.tbl
        and p.policyname = v_pair.pol
    ) then
      raise exception '§1.3 failed: owner policy "%" on public.% is missing. Apply 20261122120000_add_owner_access.sql first.',
        v_pair.pol, v_pair.tbl;
    end if;
  end loop;
end;
$$;

-- §1.4  public.orders.status still allows exactly pending/active/completed/rejected
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
    raise exception '§1.4 failed: constraint orders_status_check is missing on public.orders. Apply 20261122120000_add_owner_access.sql first.';
  end if;

  if v_def <> 'CHECK ((status = ANY (ARRAY[''pending''::text, ''active''::text, ''completed''::text, ''rejected''::text])))' then
    raise exception E'§1.4 failed: orders_status_check has changed.\n  actual: %', v_def;
  end if;

  if not v_validated then
    raise exception '§1.4 failed: orders_status_check is not validated.';
  end if;
end;
$$;

-- §1.5  this migration's own objects must NOT already exist. This migration only
--       ever creates them; it never adopts, overwrites or reuses a pre-existing
--       conversation/message table or write function of unknown shape. If any of
--       the four objects is present, abort so a human can inspect it first.
do $$
declare
  v_sigs text[] := array[
    'public.send_customer_message(uuid,text)',
    'public.append_message(uuid,uuid,text,text)'
  ];
  v_sig  text;
begin
  if to_regclass('public.conversations') is not null then
    raise exception '§1.5 failed: public.conversations already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  if to_regclass('public.messages') is not null then
    raise exception '§1.5 failed: public.messages already exists. Inspect it before applying this migration; it will not be overwritten.';
  end if;

  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is not null then
      raise exception '§1.5 failed: % already exists. Inspect it before applying this migration; it will not be replaced.', v_sig;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- §2  Tables
-- ============================================================================
-- Exactly one conversation per customer, enforced by a unique constraint rather
-- than by convention. conversations (id, customer_id) is a unique key so that a
-- message can carry a composite foreign key to it: that makes it impossible, at
-- the schema level, for a message to be attached to a conversation belonging to
-- a different customer — independent of any RLS policy or function logic.
create table public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references auth.users (id) on delete cascade,
  customer_display_name text,
  last_message_at       timestamptz,
  last_message_preview  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint conversations_customer_id_key unique (customer_id),
  constraint conversations_id_customer_key unique (id, customer_id)
);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  -- Denormalized on purpose: the composite foreign key below ties
  -- (conversation_id, customer_id) back to the owning conversation, so this column
  -- can never disagree with its conversation.
  customer_id     uuid not null,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  sender_role     text not null check (sender_role in ('customer', 'owner')),
  body            text not null check (char_length(btrim(body)) between 1 and 4000),
  -- Volatile default (statement time). Both §4 functions pass created_at explicitly;
  -- this default only protects a future service-role writer that omits the column.
  created_at      timestamptz not null default clock_timestamp(),
  read_at         timestamptz,
  constraint messages_conversation_customer_fkey
    foreign key (conversation_id, customer_id)
    references public.conversations (id, customer_id) on delete cascade,
  constraint messages_sender_role_consistent
    check (sender_role <> 'customer' or sender_id = customer_id)
);

-- Ordering key: created_at is not guaranteed unique, so id is the deterministic
-- secondary sort key everywhere messages are read.
create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at, id);

create index messages_conversation_unread_idx
  on public.messages (conversation_id) where read_at is null;

create index conversations_last_message_idx
  on public.conversations (last_message_at desc nulls last);

-- ============================================================================
-- §3  Grants + RLS — read-only for clients, writes are service-role only
-- ============================================================================
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

revoke all on public.conversations from public, anon, authenticated;
revoke all on public.messages      from public, anon, authenticated;
grant select on public.conversations to authenticated;
grant select on public.messages      to authenticated;
grant all    on public.conversations to service_role;
grant all    on public.messages      to service_role;

-- There is deliberately no INSERT / UPDATE / DELETE policy below. With RLS enabled
-- and no write policy, authenticated users cannot write to either table even if a
-- future grant accidentally allowed it.
-- The four policies below are plain CREATE POLICY: §1.5 already proved these tables
-- are brand new, so there is no pre-existing policy to remove and none is dropped.

create policy "Customers read their own conversation"
  on public.conversations for select
  to authenticated
  using ((select auth.uid()) = customer_id);

create policy "Owners read all conversations"
  on public.conversations for select
  to authenticated
  using ((select public.is_owner()));

create policy "Customers read their own messages"
  on public.messages for select
  to authenticated
  using ((select auth.uid()) = customer_id);

create policy "Owners read all messages"
  on public.messages for select
  to authenticated
  using ((select public.is_owner()));

-- ============================================================================
-- §4  Write functions — service_role EXECUTE only, never callable by a browser
-- ============================================================================

-- §4a  Customer message: get-or-create the conversation, insert the message and
--      refresh the conversation summary inside one transaction.
--
--      Timestamps use clock_timestamp() (statement time), never now()
--      (transaction start), so the order of concurrent writes matches the order
--      they were written. Serialization: the SELECT ... FOR UPDATE takes a lock
--      on the conversation row before the message is inserted; append_message
--      (§4b) takes the same lock on the same row. Competing writers to one
--      conversation therefore queue on that row, so their summary updates
--      (last_message_at / last_message_preview / updated_at) are applied one
--      after another and cannot overwrite each other's results.
--
--      This is not, however, an immunity from every possible deadlock: a deadlock
--      is a cycle among all locks a session holds, and locks acquired elsewhere in
--      the same transaction (or in future code paths, or by other sessions that
--      touch the same rows) are outside this function's control. The ordering rule
--      here removes the known cycle between these two writers; it does not prove
--      the absence of every cycle in every workload.
--
--      DO NOTHING (instead of a no-op DO UPDATE) never rewrites an existing
--      conversation row, so it fires no UPDATE trigger and does not churn
--      updated_at on a conversation that did not change. If a concurrent
--      transaction is creating the same conversation, this INSERT blocks on the
--      unique index until that transaction resolves, and the following SELECT
--      (a fresh snapshot under READ COMMITTED) then sees the winner's row.
create or replace function public.send_customer_message(p_sender_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_message_id      uuid;
  v_created_at      timestamptz;
  v_body            text := btrim(coalesce(p_body, ''));
begin
  if p_sender_id is null then
    raise exception 'A sender id is required.' using errcode = '22023';
  end if;

  -- Defense in depth: the owner account must never act as a customer.
  if exists (select 1 from public.owner_accounts where user_id = p_sender_id) then
    raise exception 'A registered owner cannot send as a customer.' using errcode = '42501';
  end if;

  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'A message must be between 1 and 4000 characters.' using errcode = '22023';
  end if;

  insert into public.conversations (customer_id, updated_at)
  values (p_sender_id, clock_timestamp())
  on conflict on constraint conversations_customer_id_key do nothing;

  select id
    into v_conversation_id
  from public.conversations
  where customer_id = p_sender_id
  for update;

  insert into public.messages (conversation_id, customer_id, sender_id, sender_role, body, created_at)
  values (v_conversation_id, p_sender_id, p_sender_id, 'customer', v_body, clock_timestamp())
  returning id, created_at into v_message_id, v_created_at;

  update public.conversations
     set last_message_at      = v_created_at,
         last_message_preview = left(v_body, 140),
         updated_at           = clock_timestamp()
   where id = v_conversation_id;

  return v_message_id;
end;
$$;

alter function public.send_customer_message(uuid, text) owner to postgres;
revoke all on function public.send_customer_message(uuid, text) from public, anon, authenticated;
grant execute on function public.send_customer_message(uuid, text) to service_role;

-- §4b  Owner reply. Replies ONLY, and only into a conversation that already
--      exists because that customer wrote first — it can never create one.
--      The caller is not trusted: existence of the sender in public.owner_accounts
--      is re-checked here, inside the database.
create or replace function public.append_message(
  p_conversation_id uuid,
  p_sender_id       uuid,
  p_sender_role     text,
  p_body            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_message_id  uuid;
  v_created_at  timestamptz;
  v_body        text := btrim(coalesce(p_body, ''));
begin
  if p_conversation_id is null then
    raise exception 'A conversation is required.' using errcode = '22023';
  end if;

  if p_sender_id is null then
    raise exception 'A sender id is required.' using errcode = '22023';
  end if;

  if p_sender_role is distinct from 'owner' then
    raise exception 'append_message only supports owner replies.' using errcode = '22023';
  end if;

  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'A message must be between 1 and 4000 characters.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.owner_accounts where user_id = p_sender_id) then
    raise exception 'The sender is not a registered NexTech owner.' using errcode = '42501';
  end if;

  -- Single lock point, shared with §4a. A conversation that the customer never
  -- started simply does not exist here.
  select customer_id
    into v_customer_id
  from public.conversations
  where id = p_conversation_id
  for update;

  if not found then
    raise exception 'Conversation % does not exist.', p_conversation_id using errcode = 'P0002';
  end if;

  insert into public.messages (conversation_id, customer_id, sender_id, sender_role, body, created_at)
  values (p_conversation_id, v_customer_id, p_sender_id, 'owner', v_body, clock_timestamp())
  returning id, created_at into v_message_id, v_created_at;

  update public.conversations
     set last_message_at      = v_created_at,
         last_message_preview = left(v_body, 140),
         updated_at           = clock_timestamp()
   where id = p_conversation_id;

  return v_message_id;
end;
$$;

alter function public.append_message(uuid, uuid, text, text) owner to postgres;
revoke all on function public.append_message(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.append_message(uuid, uuid, text, text) to service_role;

-- ============================================================================
-- §5  pg_temp helper for the §6 policy comparison (never persisted)
-- ============================================================================
-- Conservative expression normalizer: strips comments, collapses whitespace,
-- removes ONLY the known `public.` prefix and PostgreSQL's generated sub-select
-- aliases, then strips ONLY parentheses wrapping the entire expression. Inner
-- parentheses are never removed, so logical grouping can never be collapsed and
-- two different predicates can never normalise to the same string.
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

-- §6.1  public.is_owner() still in the reviewed shape, with exactly the intended
--       EXECUTE grants (authenticated + service_role, and NOT anon/PUBLIC)
do $$
declare
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception '§6.1 failed: public.is_owner() does not exist.';
  end if;

  select p.prosecdef,
         p.proconfig,
         (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
    into v_rec
  from pg_proc p
  where p.oid = 'public.is_owner()'::regprocedure;

  v_owner := v_rec.owner;

  if v_owner is null then
    raise exception '§6.1 failed: could not resolve the owner role of public.is_owner().';
  end if;
  if v_owner <> 'postgres' then
    raise exception '§6.1 failed: public.is_owner() must be owned by postgres, found %.', v_owner;
  end if;
  if not v_rec.prosecdef then
    raise exception '§6.1 failed: public.is_owner() must be SECURITY DEFINER.';
  end if;

  select exists (
    select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
  ) into v_ok;

  if not coalesce(v_ok, false) then
    raise exception '§6.1 failed: public.is_owner() must set an empty search_path. Actual proconfig: %.',
      coalesce(v_rec.proconfig::text, 'NULL');
  end if;

  if not has_function_privilege('authenticated', 'public.is_owner()', 'EXECUTE') then
    raise exception '§6.1 failed: authenticated must be able to EXECUTE public.is_owner().';
  end if;

  if not has_function_privilege('service_role', 'public.is_owner()', 'EXECUTE') then
    raise exception '§6.1 failed: service_role must be able to EXECUTE public.is_owner().';
  end if;

  -- has_function_privilege('anon', ...) is true whenever EXECUTE is granted to
  -- PUBLIC, so this single check covers both anon and PUBLIC.
  if has_function_privilege('anon', 'public.is_owner()', 'EXECUTE') then
    raise exception '§6.1 failed: public.is_owner() must not be executable by anon or PUBLIC.';
  end if;
end;
$$;

-- §6.2  public.owner_accounts is still invisible to clients and owned by the same
--       role as public.is_owner()
do $$
declare
  v_rec record;
begin
  if to_regclass('public.owner_accounts') is null then
    raise exception '§6.2 failed: public.owner_accounts does not exist.';
  end if;

  select c.relrowsecurity,
         (select r.rolname from pg_roles r where r.oid = c.relowner) as owner
    into v_rec
  from pg_class c
  where c.oid = 'public.owner_accounts'::regclass;

  if not v_rec.relrowsecurity then
    raise exception '§6.2 failed: row level security is not enabled on public.owner_accounts.';
  end if;

  if v_rec.owner <> 'postgres' then
    raise exception '§6.2 failed: public.owner_accounts must be owned by postgres, found %.', v_rec.owner;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owner_accounts'
  ) then
    raise exception '§6.2 failed: public.owner_accounts must not have any RLS policies.';
  end if;

  if has_table_privilege('anon', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('anon', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('anon', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('anon', 'public.owner_accounts', 'DELETE') then
    raise exception '§6.2 failed: the anon role must not have any privileges on public.owner_accounts.';
  end if;

  if has_table_privilege('authenticated', 'public.owner_accounts', 'SELECT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_accounts', 'DELETE') then
    raise exception '§6.2 failed: the authenticated role must not have any privileges on public.owner_accounts.';
  end if;

  if not has_table_privilege('service_role', 'public.owner_accounts', 'SELECT')
     or not has_table_privilege('service_role', 'public.owner_accounts', 'INSERT')
     or not has_table_privilege('service_role', 'public.owner_accounts', 'UPDATE')
     or not has_table_privilege('service_role', 'public.owner_accounts', 'DELETE') then
    raise exception '§6.2 failed: service_role must retain full privileges on public.owner_accounts.';
  end if;

  if (select c.relowner from pg_class c where c.oid = 'public.owner_accounts'::regclass)
     is distinct from
     (select p.proowner from pg_proc p where p.oid = 'public.is_owner()'::regprocedure) then
    raise exception '§6.2 failed: public.owner_accounts and public.is_owner() must be owned by the same role.';
  end if;
end;
$$;

-- §6.3  both write functions exist in the reviewed shape: SECURITY DEFINER, owned
--       by postgres, empty search_path, executable by service_role only
do $$
declare
  v_sig   text;
  v_sigs  text[] := array[
    'public.send_customer_message(uuid,text)',
    'public.append_message(uuid,uuid,text,text)'
  ];
  v_rec   record;
  v_owner name;
  v_ok    boolean;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception '§6.3 failed: % does not exist.', v_sig;
    end if;

    select p.prosecdef,
           p.proconfig,
           (select r.rolname from pg_roles r where r.oid = p.proowner) as owner
      into v_rec
    from pg_proc p
    where p.oid = v_sig::regprocedure;

    v_owner := v_rec.owner;

    if v_owner is null then
      raise exception '§6.3 failed: could not resolve the owner role of %.', v_sig;
    end if;
    if v_owner <> 'postgres' then
      raise exception '§6.3 failed: % must be owned by postgres, found %.', v_sig, v_owner;
    end if;
    if not v_rec.prosecdef then
      raise exception '§6.3 failed: % must be SECURITY DEFINER.', v_sig;
    end if;

    select exists (
      select 1 from unnest(v_rec.proconfig) as cfg where cfg = 'search_path=""'
    ) into v_ok;

    if not coalesce(v_ok, false) then
      raise exception '§6.3 failed: % must set an empty search_path. Actual proconfig: %.',
        v_sig, coalesce(v_rec.proconfig::text, 'NULL');
    end if;

    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception '§6.3 failed: service_role must be able to EXECUTE %.', v_sig;
    end if;

    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception '§6.3 failed: authenticated must NOT be able to EXECUTE %.', v_sig;
    end if;

    -- covers anon and PUBLIC
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception '§6.3 failed: anon/PUBLIC must NOT be able to EXECUTE %.', v_sig;
    end if;
  end loop;
end;
$$;

-- §6.4  the two messaging tables: RLS on, SELECT-only for authenticated, nothing
--       for anon, full DML for service_role, and no non-SELECT policy at all
do $$
declare
  v_tbl  text;
  v_priv text;
begin
  foreach v_tbl in array array['public.conversations', 'public.messages'] loop
    if not exists (
      select 1 from pg_class c where c.oid = v_tbl::regclass and c.relrowsecurity
    ) then
      raise exception '§6.4 failed: row level security is not enabled on %.', v_tbl;
    end if;

    if not has_table_privilege('authenticated', v_tbl, 'SELECT') then
      raise exception '§6.4 failed: authenticated must be able to SELECT from %.', v_tbl;
    end if;

    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('authenticated', v_tbl, v_priv) then
        raise exception '§6.4 failed: authenticated must not hold % on %.', v_priv, v_tbl;
      end if;

      if has_table_privilege('anon', v_tbl, v_priv) then
        raise exception '§6.4 failed: anon must not hold % on %.', v_priv, v_tbl;
      end if;
    end loop;

    if has_table_privilege('anon', v_tbl, 'SELECT') then
      raise exception '§6.4 failed: anon must not be able to SELECT from %.', v_tbl;
    end if;

    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', v_tbl, v_priv) then
        raise exception '§6.4 failed: service_role must hold % on %.', v_priv, v_tbl;
      end if;
    end loop;

    if exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = split_part(v_tbl, '.', 2)
        and p.cmd <> 'SELECT'
    ) then
      raise exception '§6.4 failed: % must not have any non-SELECT policy (all writes go through the §4 functions).', v_tbl;
    end if;

    if exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = split_part(v_tbl, '.', 2)
        and p.roles::text[] && array['anon', 'public']::text[]
    ) then
      raise exception '§6.4 failed: % has a policy exposed to anon/public.', v_tbl;
    end if;
  end loop;
end;
$$;

-- §6.5  exactly the four reviewed SELECT policies, with the exact predicates
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
      ('conversations', 'Customers read their own conversation', '(select auth.uid()) = customer_id'),
      ('conversations', 'Owners read all conversations',         '(select public.is_owner())'),
      ('messages',      'Customers read their own messages',     '(select auth.uid()) = customer_id'),
      ('messages',      'Owners read all messages',              '(select public.is_owner())')
    ) as t(tbl, pol, expected_qual)
  loop
    select p.cmd, p.roles::text[], p.qual, p.with_check
      into v_cmd, v_roles, v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = v_exp.tbl
      and p.policyname = v_exp.pol;

    if not found then
      raise exception '§6.5 failed: messaging policy "%" on public.% is missing.', v_exp.pol, v_exp.tbl;
    end if;

    if v_cmd <> 'SELECT' then
      raise exception '§6.5 failed: policy "%" must be FOR SELECT, found %.', v_exp.pol, v_cmd;
    end if;

    if v_roles <> array['authenticated'] then
      raise exception '§6.5 failed: policy "%" must apply to authenticated, found %.', v_exp.pol, v_roles;
    end if;

    if v_check is not null then
      raise exception '§6.5 failed: policy "%" must not have a WITH CHECK clause.', v_exp.pol;
    end if;

    if pg_temp.norm_expr(v_qual) <> pg_temp.norm_expr(v_exp.expected_qual) then
      raise exception E'§6.5 failed: policy "%" predicate is not the reviewed expression.\n  expected: %\n  actual  : %',
        v_exp.pol,
        pg_temp.norm_expr(v_exp.expected_qual),
        pg_temp.norm_expr(v_qual);
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('conversations', 'messages')) <> 4 then
    raise exception '§6.5 failed: expected exactly 4 messaging policies, found %.',
      (select count(*) from pg_policies where schemaname = 'public' and tablename in ('conversations', 'messages'));
  end if;
end;
$$;

-- §6.6  preservation: profile role protection untouched, and all six customer
--       policies plus all four owner policies still present
do $$
declare
  v_pair record;
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '§6.6 failed: the NexTech profile role protection trigger is missing or disabled.';
  end if;

  if coalesce(
       (select p.prosecdef
        from pg_proc p
        where p.oid = to_regprocedure('public.nextech_protect_profile_role()')),
       true
     ) then
    raise exception '§6.6 failed: profile role protection must remain SECURITY INVOKER (or the function is missing).';
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
      ('service_packages', 'Owners can read all service packages',                  'SELECT')
    ) as t(tbl, pol, cmd)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = v_pair.tbl
        and p.policyname = v_pair.pol
    ) then
      raise exception '§6.6 failed: existing policy "%" on public.% is missing.', v_pair.pol, v_pair.tbl;
    end if;

    if (select p.cmd from pg_policies p
        where p.schemaname = 'public' and p.tablename = v_pair.tbl and p.policyname = v_pair.pol) <> v_pair.cmd then
      raise exception '§6.6 failed: existing policy "%" on public.% changed command.', v_pair.pol, v_pair.tbl;
    end if;
  end loop;
end;
$$;

-- §6.7  the messaging constraints exist, are validated, and are wired to exactly
--       the intended columns
do $$
declare
  v_rec record;
begin
  -- one conversation per customer
  select con.contype,
         con.convalidated,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.conversations'::regclass
    and con.conname  = 'conversations_customer_id_key';

  if not found then
    raise exception '§6.7 failed: constraint conversations_customer_id_key is missing on public.conversations.';
  end if;
  if v_rec.contype <> 'u' then
    raise exception '§6.7 failed: conversations_customer_id_key must be a UNIQUE constraint.';
  end if;
  if not v_rec.convalidated then
    raise exception '§6.7 failed: conversations_customer_id_key is not validated.';
  end if;
  if v_rec.cols <> array['customer_id'] then
    raise exception '§6.7 failed: conversations_customer_id_key must cover exactly (customer_id), found %.', v_rec.cols;
  end if;

  -- composite foreign-key target
  select con.contype,
         con.convalidated,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.conversations'::regclass
    and con.conname  = 'conversations_id_customer_key';

  if not found then
    raise exception '§6.7 failed: constraint conversations_id_customer_key is missing on public.conversations.';
  end if;
  if v_rec.contype <> 'u' then
    raise exception '§6.7 failed: conversations_id_customer_key must be a UNIQUE constraint.';
  end if;
  if not v_rec.convalidated then
    raise exception '§6.7 failed: conversations_id_customer_key is not validated.';
  end if;
  if v_rec.cols <> array['id', 'customer_id'] then
    raise exception '§6.7 failed: conversations_id_customer_key must cover exactly (id, customer_id), found %.', v_rec.cols;
  end if;

  -- the composite foreign key that makes cross-customer attachment impossible
  select con.contype,
         con.convalidated,
         con.confrelid,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.confkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as refcols
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.messages'::regclass
    and con.conname  = 'messages_conversation_customer_fkey';

  if not found then
    raise exception '§6.7 failed: constraint messages_conversation_customer_fkey is missing on public.messages.';
  end if;
  if v_rec.contype <> 'f' then
    raise exception '§6.7 failed: messages_conversation_customer_fkey must be a FOREIGN KEY.';
  end if;
  if not v_rec.convalidated then
    raise exception '§6.7 failed: messages_conversation_customer_fkey is not validated.';
  end if;
  if v_rec.confrelid <> 'public.conversations'::regclass then
    raise exception '§6.7 failed: messages_conversation_customer_fkey must reference public.conversations.';
  end if;
  if v_rec.cols <> array['conversation_id', 'customer_id'] then
    raise exception '§6.7 failed: messages_conversation_customer_fkey must cover exactly (conversation_id, customer_id), found %.', v_rec.cols;
  end if;
  if v_rec.refcols <> array['id', 'customer_id'] then
    raise exception '§6.7 failed: messages_conversation_customer_fkey must reference exactly (id, customer_id), found %.', v_rec.refcols;
  end if;

  -- sender/role consistency
  select con.contype, con.convalidated
    into v_rec
  from pg_constraint con
  where con.conrelid = 'public.messages'::regclass
    and con.conname  = 'messages_sender_role_consistent';

  if not found then
    raise exception '§6.7 failed: constraint messages_sender_role_consistent is missing on public.messages.';
  end if;
  if v_rec.contype <> 'c' then
    raise exception '§6.7 failed: messages_sender_role_consistent must be a CHECK constraint.';
  end if;
  if not v_rec.convalidated then
    raise exception '§6.7 failed: messages_sender_role_consistent is not validated.';
  end if;
end;
$$;

commit;

-- ============================================================================
-- AFTER this migration commits:
--   1. Deploy the Edge Functions (verify_jwt = true):
--        supabase functions deploy send-message
--        supabase functions deploy mark-read
--   2. Sanity check (returns two rows — public.conversations and public.messages —
--      each with relrowsecurity = true):
--        select relname, relrowsecurity from pg_class
--        where oid in ('public.conversations'::regclass, 'public.messages'::regclass);
-- ============================================================================
