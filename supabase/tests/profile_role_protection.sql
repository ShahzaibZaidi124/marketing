begin;

create temporary table role_protection_probe (
  id integer primary key,
  role text not null,
  display_name text not null
);

insert into pg_temp.role_protection_probe (id, role, display_name)
values (1, 'customer', 'Existing client');

create trigger role_protection_probe_guard
  before insert or update on pg_temp.role_protection_probe
  for each row
  execute function public.nextech_protect_profile_role();

grant select, insert, update on pg_temp.role_protection_probe to authenticated, service_role;

do $$
declare
  temp_schema_name name;
begin
  select nspname
  into temp_schema_name
  from pg_catalog.pg_namespace
  where oid = pg_catalog.pg_my_temp_schema();

  execute format(
    'grant usage on schema %I to authenticated, service_role',
    temp_schema_name
  );
end;
$$;

set local role authenticated;

do $$
declare
  update_denied boolean := false;
  insert_denied boolean := false;
begin
  begin
    update pg_temp.role_protection_probe
    set role = 'seller'
    where id = 1;
  exception
    when insufficient_privilege then update_denied := true;
  end;

  if not update_denied then
    raise exception 'Authenticated role change was not rejected.';
  end if;

  begin
    insert into pg_temp.role_protection_probe (id, role, display_name)
    values (2, 'seller', 'Untrusted role assignment');
  exception
    when insufficient_privilege then insert_denied := true;
  end;

  if not insert_denied then
    raise exception 'Authenticated role assignment was not rejected.';
  end if;

  insert into pg_temp.role_protection_probe (id, role, display_name)
  values (3, 'customer', 'New client');

  update pg_temp.role_protection_probe
  set display_name = 'Edited client profile'
  where id = 1;
end;
$$;

reset role;
set local role service_role;

update pg_temp.role_protection_probe
set role = 'seller'
where id = 1;

reset role;

do $$
begin
  if not exists (
    select 1
    from pg_temp.role_protection_probe
    where id = 1
      and role = 'seller'
      and display_name = 'Edited client profile'
  ) then
    raise exception 'Trusted role management or ordinary profile editing failed.';
  end if;

  if not exists (
    select 1
    from pg_temp.role_protection_probe
    where id = 3
      and role = 'customer'
  ) then
    raise exception 'Ordinary customer profile creation failed.';
  end if;
end;
$$;

rollback;
