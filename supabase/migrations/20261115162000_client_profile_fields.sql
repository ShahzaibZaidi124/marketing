alter table public.profiles
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists bio text,
  add column if not exists services_interested text,
  add column if not exists project_interests text;

update public.profiles as profile
set
  country = coalesce(
    nullif(btrim(profile.country), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'country'), '')
  ),
  city = coalesce(
    nullif(btrim(profile.city), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'city'), '')
  ),
  bio = coalesce(
    nullif(btrim(profile.bio), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'about'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'bio'), '')
  ),
  services_interested = coalesce(
    nullif(btrim(profile.services_interested), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'services_interested'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'interests'), '')
  ),
  project_interests = coalesce(
    nullif(btrim(profile.project_interests), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'project_interests'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'skills_interests'), '')
  )
from auth.users as auth_user
where profile.id = auth_user.id
  and (
    (nullif(btrim(profile.country), '') is null and nullif(btrim(auth_user.raw_user_meta_data ->> 'country'), '') is not null)
    or (nullif(btrim(profile.city), '') is null and nullif(btrim(auth_user.raw_user_meta_data ->> 'city'), '') is not null)
    or (nullif(btrim(profile.bio), '') is null and coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'about'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'bio'), '')
    ) is not null)
    or (nullif(btrim(profile.services_interested), '') is null and coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'services_interested'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'interests'), '')
    ) is not null)
    or (nullif(btrim(profile.project_interests), '') is null and coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'project_interests'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'skills_interests'), '')
    ) is not null)
  );
