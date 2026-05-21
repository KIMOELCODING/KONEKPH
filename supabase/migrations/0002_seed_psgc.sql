-- Konek.PH — seed PSGC lookups + property types
-- Extracted from Draft 19.html PSGC (line ~3081) and PROP_TYPES (line ~3127).
-- This is NOT the full PSGC — it's the curated subset the demo UI exposes.
-- Expand as needed when going to production.

-- Regions
insert into public.psgc_regions(code, name) values
  ('NCR',   'NCR'),
  ('R03',   'Region III (Central Luzon)'),
  ('R04A',  'Region IV-A (CALABARZON)'),
  ('R07',   'Region VII (Central Visayas)')
on conflict (code) do nothing;

-- Provinces
insert into public.psgc_provinces(code, region_code, name) values
  ('NCR-MM', 'NCR',  'Metro Manila'),
  ('R03-BUL','R03',  'Bulacan'),
  ('R03-PAM','R03',  'Pampanga'),
  ('R04A-CAV','R04A','Cavite'),
  ('R04A-LAG','R04A','Laguna'),
  ('R04A-BAT','R04A','Batangas'),
  ('R04A-RIZ','R04A','Rizal'),
  ('R07-CEB','R07',  'Cebu')
on conflict (code) do nothing;

-- Cities
insert into public.psgc_cities(code, province_code, name) values
  ('NCR-MM-QC',   'NCR-MM', 'Quezon City'),
  ('NCR-MM-MNL',  'NCR-MM', 'Manila'),
  ('NCR-MM-MAK',  'NCR-MM', 'Makati'),
  ('NCR-MM-TAG',  'NCR-MM', 'Taguig'),
  ('NCR-MM-PAS',  'NCR-MM', 'Pasig'),
  ('NCR-MM-MAN',  'NCR-MM', 'Mandaluyong'),
  ('R03-BUL-MAL', 'R03-BUL','Malolos'),
  ('R03-BUL-MEY', 'R03-BUL','Meycauayan'),
  ('R03-PAM-SFN', 'R03-PAM','San Fernando'),
  ('R03-PAM-ANG', 'R03-PAM','Angeles'),
  ('R04A-CAV-TAG','R04A-CAV','Tagaytay'),
  ('R04A-CAV-DAS','R04A-CAV','Dasmariñas'),
  ('R04A-LAG-STR','R04A-LAG','Santa Rosa'),
  ('R04A-LAG-BIN','R04A-LAG','Biñan'),
  ('R04A-BAT-BCY','R04A-BAT','Batangas City'),
  ('R04A-BAT-LIP','R04A-BAT','Lipa'),
  ('R04A-RIZ-ANT','R04A-RIZ','Antipolo'),
  ('R07-CEB-CEB', 'R07-CEB','Cebu City'),
  ('R07-CEB-MAN', 'R07-CEB','Mandaue')
on conflict (code) do nothing;

-- Property types
insert into public.property_types(category, type) values
  ('Residential','House and Lot'),
  ('Residential','Apartment'),
  ('Residential','Townhouse'),
  ('Residential','Condominium'),
  ('Residential','Condotel'),
  ('Residential','Residential Lot'),
  ('Commercial','Building'),
  ('Commercial','Office'),
  ('Commercial','Retail Space'),
  ('Commercial','Dormitories'),
  ('Commercial','Commercial Lot'),
  ('Industrial','Warehouse'),
  ('Industrial','Factory (Plant)'),
  ('Industrial','Commissary'),
  ('Industrial','Industrial Lot'),
  ('Agricultural','Agriculture Lot'),
  ('Leisure','Island'),
  ('Leisure','Resort'),
  ('Leisure','Hotel'),
  ('Leisure','Beach Lot'),
  ('Lot','Residential Lot'),
  ('Lot','Commercial Lot'),
  ('Lot','Agriculture Lot'),
  ('Lot','Beach Lot'),
  ('Lot','Industrial Lot')
on conflict do nothing;
