-- Konek.PH — Storage hardening: per-bucket size + MIME allow-lists.
--
-- The frontend already validates size/type before upload (5 MB + JPEG/PNG/WebP),
-- but client checks are bypassable — anyone with the anon key can POST straight
-- to storage. These server-side limits are the real wall: Supabase Storage
-- rejects oversize or wrong-type uploads at the edge, before they hit a bucket.
--
-- file_size_limit is in BYTES. allowed_mime_types is a text[] of exact MIME types
-- (no wildcards). NULL on either column means "no limit" — which is the insecure
-- default we're closing here.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- id-documents (private): 1x1 photo + PRC ID. Allow images + PDF (some PRC IDs
-- are scanned to PDF). 5 MB matches the signup-form cap.
update storage.buckets
   set file_size_limit   = 5242880,  -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'id-documents';

-- avatars (public): profile photos. No PDF, and 2 MB is plenty for a headshot.
update storage.buckets
   set file_size_limit   = 2097152,  -- 2 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'avatars';

-- listing-images (public): property photos. Matches the in-app 5 MB + image rule.
update storage.buckets
   set file_size_limit   = 5242880,  -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'listing-images';

-- article-images (public, admin-write): Home carousel + article hero images.
update storage.buckets
   set file_size_limit   = 5242880,  -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'article-images';
