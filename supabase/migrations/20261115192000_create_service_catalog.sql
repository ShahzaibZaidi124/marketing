begin;

do $$
begin
  if to_regclass('public.services') is not null then
    raise exception 'public.services already exists. Inspect its columns and RLS policies before applying the NexTech service catalog migration.';
  end if;
  if to_regclass('public.service_packages') is not null then
    raise exception 'public.service_packages already exists. Inspect its columns and RLS policies before applying the NexTech service catalog migration.';
  end if;
end;
$$;

create table public.services (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,120}$'),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  base_price numeric(12, 2) check (base_price is null or base_price >= 0),
  currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_packages (
  service_id text not null references public.services (id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,120}$'),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  price numeric(12, 2) not null check (price >= 0),
  currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_id, id)
);

create index service_packages_active_idx
  on public.service_packages (service_id, id)
  where is_active;

create function public.update_catalog_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.update_catalog_updated_at() from public, anon, authenticated;
grant execute on function public.update_catalog_updated_at() to service_role;

create trigger services_set_updated_at
  before update on public.services
  for each row
  execute function public.update_catalog_updated_at();

create trigger service_packages_set_updated_at
  before update on public.service_packages
  for each row
  execute function public.update_catalog_updated_at();

alter table public.services enable row level security;
alter table public.service_packages enable row level security;

revoke all on public.services from public, anon, authenticated;
revoke all on public.service_packages from public, anon, authenticated;
grant select on public.services to authenticated;
grant select on public.service_packages to authenticated;
grant all on public.services to service_role;
grant all on public.service_packages to service_role;

create policy "Authenticated users can view active services"
  on public.services
  for select
  to authenticated
  using (is_active);

create policy "Authenticated users can view packages for active services"
  on public.service_packages
  for select
  to authenticated
  using (
    is_active
    and exists (
      select 1
      from public.services
      where services.id = service_packages.service_id
        and services.is_active
    )
  );

commit;
