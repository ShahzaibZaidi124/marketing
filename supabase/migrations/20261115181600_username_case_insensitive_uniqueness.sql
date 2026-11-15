begin;

do $$
declare
  duplicate_usernames text;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Apply the NexTech profiles migrations before the username uniqueness migration.';
  end if;

  select string_agg(username_key, ', ' order by username_key)
  into duplicate_usernames
  from (
    select lower(btrim(username)) as username_key
    from public.profiles
    where username is not null
      and btrim(username) <> ''
    group by lower(btrim(username))
    having count(*) > 1
  ) as duplicates;

  if duplicate_usernames is not null then
    raise exception 'Cannot create the case-insensitive username index. Resolve these existing duplicate usernames first: %',
      duplicate_usernames;
  end if;
end;
$$;

create unique index if not exists profiles_username_normalized_unique_idx
  on public.profiles (lower(btrim(username)))
  where username is not null
    and btrim(username) <> '';

create or replace function public.is_profile_username_taken(candidate_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_username text := lower(btrim(candidate_username));
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to check username availability.'
      using errcode = '42501';
  end if;

  if normalized_username is null or normalized_username = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles as profile
    where lower(btrim(profile.username)) = normalized_username
      and profile.id <> current_user_id
  );
end;
$function$;

revoke all on function public.is_profile_username_taken(text) from public, anon, authenticated;
grant execute on function public.is_profile_username_taken(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.is_profile_username_taken(text)', 'EXECUTE') then
    raise exception 'Anonymous users must not be able to execute the username availability function.';
  end if;

  if not has_function_privilege('authenticated', 'public.is_profile_username_taken(text)', 'EXECUTE') then
    raise exception 'Authenticated users must be able to execute the username availability function.';
  end if;
end;
$$;

commit;
