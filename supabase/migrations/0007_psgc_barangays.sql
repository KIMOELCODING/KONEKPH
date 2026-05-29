-- 0007_psgc_barangays.sql — add the missing barangay lookup table and the
-- indexes we need to power city → barangay cascading dropdowns at scale.
--
-- The full PSGC has ~42,000 barangays, so an index on city_code is mandatory
-- for the filtered query to be fast. Reads are public (matches the other
-- psgc_* tables); writes are admin-only (data is bulk-loaded by a script
-- running with the service role, which bypasses RLS).

create table if not exists public.psgc_barangays (
  code text primary key,
  city_code text not null references public.psgc_cities(code) on delete cascade,
  name text not null
);

create index if not exists psgc_barangays_city_idx
  on public.psgc_barangays(city_code, name);

alter table public.psgc_barangays enable row level security;

drop policy if exists psgc_barangays_read on public.psgc_barangays;
create policy psgc_barangays_read on public.psgc_barangays
  for select using (true);

-- For consistency with the other psgc_* tables, also ensure a fast lookup
-- by parent on the existing tables. Safe if already present.
create index if not exists psgc_provinces_region_idx
  on public.psgc_provinces(region_code, name);

create index if not exists psgc_cities_province_idx
  on public.psgc_cities(province_code, name);
