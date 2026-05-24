-- Konek.PH — Storage buckets setup
-- Run in Supabase SQL Editor AFTER 0001_initial_schema.sql.
-- Alternatively create these via Dashboard -> Storage -> New bucket.

-- ============================================================
-- Buckets
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('id-documents',  'id-documents',  false),
  ('avatars',       'avatars',       true),
  ('listing-images','listing-images',true),
  ('article-images','article-images',true)
on conflict (id) do nothing;

-- ============================================================
-- Policies
-- ============================================================

-- id-documents (private): each broker can upload/read/update only their own
-- folder; admins can read all (for the approval flow).
drop policy if exists "id_docs owner write" on storage.objects;
create policy "id_docs owner write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "id_docs owner update" on storage.objects;
create policy "id_docs owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "id_docs owner read" on storage.objects;
create policy "id_docs owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'id-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- avatars (public read, owner write to own folder)
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- listing-images (public read, owner writes to own folder)
drop policy if exists "listing_images public read" on storage.objects;
create policy "listing_images public read" on storage.objects
  for select using (bucket_id = 'listing-images');

drop policy if exists "listing_images owner write" on storage.objects;
create policy "listing_images owner write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing_images owner update" on storage.objects;
create policy "listing_images owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- article-images (public read, admin-only write — backs Home carousel + articles)
drop policy if exists "article_images public read" on storage.objects;
create policy "article_images public read" on storage.objects
  for select using (bucket_id = 'article-images');

drop policy if exists "article_images admin write" on storage.objects;
create policy "article_images admin write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'article-images' and public.is_admin());

drop policy if exists "article_images admin update" on storage.objects;
create policy "article_images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'article-images' and public.is_admin());

drop policy if exists "article_images admin delete" on storage.objects;
create policy "article_images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'article-images' and public.is_admin());
