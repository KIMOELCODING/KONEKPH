-- 0009_listings_delete_own.sql — let brokers delete their own listings.
--
-- 0001 only granted SELECT / INSERT / UPDATE on public.listings; without a
-- DELETE policy, broker-side `delete()` calls silently failed under RLS
-- (PostgREST returns 0 affected rows, no error), so the Your Listings trash
-- button appeared to do nothing.
--
-- Cascades to clean up:
--   - public.saved_listings.listing_id -> on delete cascade (orphan bookmarks
--     are removed) — defined in 0003_messaging_billing.sql
--   - public.deals.listing_id          -> on delete set null (deal history
--     is preserved with amount/closed_at) — defined in 0005_deals.sql
--   - public.messages.attachment_listing_id -> on delete set null
--
-- NOT cleaned up by this policy:
--   - storage objects under `listing-images/<broker_id>/...` orphan. Bucket
--     lifecycle is a separate concern; we accept the storage drift for now.
--
-- Admins can already update listings; granting them delete too keeps the
-- admin React app's surface consistent.

drop policy if exists listings_delete_own on public.listings;
create policy listings_delete_own on public.listings
  for delete using (broker_id = auth.uid());

drop policy if exists listings_delete_admin on public.listings;
create policy listings_delete_admin on public.listings
  for delete using (public.is_admin());
