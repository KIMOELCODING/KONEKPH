-- 0031_dedup_psgc.sql
-- Collapse the double-seeded PSGC into one canonical dataset + clean display names.
--
-- Background: two location datasets were seeded — a small CURATED subset (clean
-- Title-Case names, very few cities, no barangays) and the FULL official PSGC
-- import (ALL-CAPS, complete: 17 regions / 94 provinces / 1,666 cities /
-- 42,042 barangays). They overlapped, leaving two regions named "NCR"
-- (codes NCR vs RNCR) and two Region IV-A (codes R04A "Region IV-A (CALABARZON)"
-- vs R4A "REGION IV-A"). Real broker listings use the FULL set, so this keeps the
-- full set as canonical, removes the 2 curated-duplicate region subtrees, and
-- Title-cases the survivor names.
--
-- Listings store location as TEXT (no FK to psgc_*), so existing rows are repointed
-- by value here; future broker picks come from the cleaned dropdowns. There are no
-- barangays under the curated dupes, and no listing references them (verified).
-- Idempotent / safe to re-run.

begin;

-- 1. Remove the curated-duplicate region subtrees. FKs (provinces->regions,
--    cities->provinces) are NO ACTION, so delete bottom-up.
delete from psgc_cities
  where province_code in (select code from psgc_provinces where region_code in ('NCR','R04A'));
delete from psgc_provinces where region_code in ('NCR','R04A');
delete from psgc_regions   where code in ('NCR','R04A');

-- 2. Title-case the 14 surviving "REGION ..." names explicitly. initcap() would
--    mangle the Roman numerals (e.g. 'REGION IV-A' -> 'Region Iv-A'). NCR/CAR/BARMM
--    are already clean acronyms and left as-is.
update psgc_regions set name = 'Region I'    where code = 'R01';
update psgc_regions set name = 'Region II'   where code = 'R02';
update psgc_regions set name = 'Region III'  where code = 'R03';
update psgc_regions set name = 'Region IV-A' where code = 'R4A';
update psgc_regions set name = 'Region IV-B' where code = 'R4B';
update psgc_regions set name = 'Region V'    where code = 'R05';
update psgc_regions set name = 'Region VI'   where code = 'R06';
update psgc_regions set name = 'Region VII'  where code = 'R07';
update psgc_regions set name = 'Region VIII' where code = 'R08';
update psgc_regions set name = 'Region IX'   where code = 'R09';
update psgc_regions set name = 'Region X'    where code = 'R10';
update psgc_regions set name = 'Region XI'   where code = 'R11';
update psgc_regions set name = 'Region XII'  where code = 'R12';
update psgc_regions set name = 'Region XIII' where code = 'R13';

-- 3. Title-case provinces + cities. initcap is safe at these levels (no Roman
--    numerals; verified on samples). Barangays (42k) are left ALL-CAPS in this
--    pass — they aren't used by listings and have Roman-numeral edge cases.
update psgc_provinces set name = initcap(name) where name <> initcap(name);
update psgc_cities    set name = initcap(name) where name <> initcap(name);

-- 4. Repoint existing listings' stored text to the cleaned canonical values.
--    Region names are unique after the dedupe, so a case-insensitive match is safe.
update listings l set region = r.name
  from psgc_regions r
  where upper(l.region) = upper(r.name) and l.region <> r.name;
update listings set province = initcap(province) where province <> initcap(province);
update listings set city     = initcap(city)     where city     <> initcap(city);

commit;
