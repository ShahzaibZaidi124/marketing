begin;

do $$
begin
  if to_regclass('public.orders') is not null then
    raise exception 'public.orders already exists. Inspect its columns and RLS policies before applying the NexTech client orders migration.';
  end if;
end;
$$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users (id) on delete cascade,
  service_id text,
  service_name text not null check (btrim(service_name) <> ''),
  order_description text not null check (btrim(order_description) <> ''),
  project_name text,
  package_name text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed')),
  price numeric(12, 2) check (price is null or price >= 0),
  currency text not null default 'PKR'
    check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  requirements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(requirements) = 'object')
);

create function public.update_orders_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.update_orders_updated_at() from public, anon, authenticated;
grant execute on function public.update_orders_updated_at() to service_role;

create trigger orders_set_updated_at
  before update on public.orders
  for each row
  execute function public.update_orders_updated_at();

create index orders_client_created_at_idx
  on public.orders (client_id, created_at desc);

alter table public.orders enable row level security;
revoke all on public.orders from public, anon, authenticated;
grant select on public.orders to authenticated;
grant all on public.orders to service_role;

create policy "Clients can read their own orders"
  on public.orders
  for select
  to authenticated
  using ((select auth.uid()) = client_id);

commit;
