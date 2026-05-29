-- 0008_clean_psgc_seed.sql — drop the curated subset from 0002_seed_psgc.sql.
--
-- The 0002 seed used hand-rolled codes ('NCR', 'NCR-MM', 'NCR-MM-QC', etc.).
-- scripts/load-psgc.mjs later loaded the full PSGC with its own synthetic
-- code scheme ('R01', 'R01-P01', 'R01-P01-C001', 'R01-P01-C001-B0001').
--
-- Result: two parallel hierarchies in the same tables. The seed cities have
-- no rows in psgc_barangays (the loader only created barangays under its own
-- coded cities), so picking a seed-coded city → barangay dropdown is empty.
--
-- We wipe everything and rely entirely on the loader's data. The loader is
-- idempotent (Prefer: resolution=merge-duplicates), so the user can re-run
-- it any time. listings.region/province/city/barangay are plain text columns
-- (no FK), so no listings are affected by this delete.

truncate table public.psgc_barangays restart identity cascade;
truncate table public.psgc_cities    restart identity cascade;
truncate table public.psgc_provinces restart identity cascade;
truncate table public.psgc_regions   restart identity cascade;
