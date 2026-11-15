begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Apply the NexTech profiles migrations before the profile-picture migration.';
  end if;
end;
$$;

alter table public.profiles
  add column if not exists avatar_path text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-pictures',
  'profile-pictures',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "NexTech profile pictures select own" on storage.objects;
create policy "NexTech profile pictures select own"
  on storage.objects
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'profile-pictures'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "NexTech profile pictures select own guard" on storage.objects;
create policy "NexTech profile pictures select own guard"
  on storage.objects
  as restrictive
  for select
  to public
  using (
    bucket_id <> 'profile-pictures'
    or (
      bucket_id = 'profile-pictures'
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  );

drop policy if exists "NexTech profile pictures insert own" on storage.objects;
create policy "NexTech profile pictures insert own"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-pictures'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "NexTech profile pictures insert own guard" on storage.objects;
create policy "NexTech profile pictures insert own guard"
  on storage.objects
  as restrictive
  for insert
  to public
  with check (
    bucket_id <> 'profile-pictures'
    or (
      bucket_id = 'profile-pictures'
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  );

drop policy if exists "NexTech profile pictures update own" on storage.objects;
create policy "NexTech profile pictures update own"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'profile-pictures'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'profile-pictures'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "NexTech profile pictures update own guard" on storage.objects;
create policy "NexTech profile pictures update own guard"
  on storage.objects
  as restrictive
  for update
  to public
  using (
    bucket_id <> 'profile-pictures'
    or (
      bucket_id = 'profile-pictures'
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  )
  with check (
    bucket_id <> 'profile-pictures'
    or (
      bucket_id = 'profile-pictures'
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  );

drop policy if exists "NexTech profile pictures delete own" on storage.objects;
create policy "NexTech profile pictures delete own"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'profile-pictures'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "NexTech profile pictures delete own guard" on storage.objects;
create policy "NexTech profile pictures delete own guard"
  on storage.objects
  as restrictive
  for delete
  to public
  using (
    bucket_id <> 'profile-pictures'
    or (
      bucket_id = 'profile-pictures'
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  );

commit;
