begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist. Apply the NexTech profiles migration before protecting profile roles.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    raise exception 'public.profiles.role does not exist. Inspect the profile schema before applying role protection.';
  end if;
end;
$$;

create or replace function public.nextech_protect_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.role is distinct from 'customer' then
    raise exception 'Profile roles can only be assigned by trusted administration.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception 'Profile roles can only be changed by trusted administration.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.nextech_protect_profile_role() from public, anon;
grant execute on function public.nextech_protect_profile_role() to authenticated, service_role;

drop trigger if exists nextech_protect_profile_role on public.profiles;
create trigger nextech_protect_profile_role
  before insert or update on public.profiles
  for each row
  execute function public.nextech_protect_profile_role();

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'nextech_protect_profile_role'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception 'Profile role protection trigger is missing or disabled.';
  end if;

  if (
    select prosecdef
    from pg_proc
    where oid = 'public.nextech_protect_profile_role()'::regprocedure
  ) then
    raise exception 'Profile role protection must remain SECURITY INVOKER.';
  end if;
end;
$$;

commit;
