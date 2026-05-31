-- Konek.PH — Store property-type-specific listing details as JSONB.
--
-- The Add Listing form (k-add-listing-v2) shows a different set of spec fields
-- per property type (Garage, Floors, Furnishing, Utilities, Terrain, Niche
-- Details, etc.). Only a handful had real columns, so everything else the
-- broker filled was silently dropped and never shown on the detail page.
--
-- Rather than ~25 sparse columns, store the extra fields in one JSONB column,
-- shaped as { "<row-id>": { "label": "Garage", "value": "2" }, ... }. The
-- detail page renders whatever's present (filterable fields like beds/baths/
-- area/category stay as their own real columns).
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

alter table public.listings
  add column if not exists details jsonb not null default '{}'::jsonb;
