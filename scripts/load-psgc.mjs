#!/usr/bin/env node
// scripts/load-psgc.mjs
//
// One-shot loader: pulls the full Philippine PSGC dataset and upserts it into
// the Supabase psgc_regions / psgc_provinces / psgc_cities / psgc_barangays
// tables, replacing the curated seed from 0002_seed_psgc.sql.
//
// Usage (PowerShell):
//   $env:SUPABASE_URL = "https://ffewjmucspcswdcxouvc.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ...<service role key>..."
//   node scripts/load-psgc.mjs
//
// Optional:
//   $env:PSGC_SRC = "C:\path\to\psgc.json"  # use a local file instead of HTTP
//
// Source of truth: the PSA Q-publication, distributed as a flat JSON. We
// accept either a flat array (each row { code, name, geographic_level }) or a
// hierarchical object { Region: { Province: { City: [Barangay,...] }}}.
//
// SAFETY: this uses the service-role key — never commit it. The script does
// upserts (on conflict do nothing equivalent), so re-runs are idempotent.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_SRC    = process.env.PSGC_SRC;
const REMOTE_URL   = process.env.PSGC_URL
  || 'https://raw.githubusercontent.com/flores-jacob/philippine-regions-provinces-cities-municipalities-barangays/master/philippine_provinces_cities_municipalities_and_barangays_2019v2.json';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const REST = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=minimal',
};

// ---------- 1. Fetch source ----------------------------------------------

async function fetchSource(){
  if (LOCAL_SRC){
    const path = resolve(LOCAL_SRC);
    if (!existsSync(path)) throw new Error(`PSGC_SRC not found: ${path}`);
    console.log(`Reading local PSGC: ${path}`);
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  console.log(`Fetching PSGC from ${REMOTE_URL}`);
  const r = await fetch(REMOTE_URL);
  if (!r.ok) throw new Error(`Fetch failed: ${r.status} ${r.statusText}`);
  return r.json();
}

// ---------- 2. Normalize to 4 flat arrays --------------------------------

function emptyTables(){
  return { regions: [], provinces: [], cities: [], barangays: [] };
}

// Detect the input shape and flatten.
function normalize(raw){
  if (Array.isArray(raw)) return normalizeFlat(raw);
  if (raw && typeof raw === 'object') {
    // flores-jacob shape: top-level keys are region codes whose values have
    // {region_name, province_list: {<PROV>: {municipality_list: {<MUN>: {barangay_list: [...]}}}}}
    var firstKey = Object.keys(raw)[0];
    var firstVal = firstKey != null ? raw[firstKey] : null;
    if (firstVal && (firstVal.region_name || firstVal.province_list)) {
      return normalizeFloresJacob(raw);
    }
    return normalizeHierarchical(raw);
  }
  throw new Error('Unsupported PSGC shape');
}

// flores-jacob/philippine-regions-provinces-cities-municipalities-barangays
function normalizeFloresJacob(obj){
  const t = emptyTables();
  for (const [regionCodeRaw, regionVal] of Object.entries(obj)){
    const regionCode = `R${regionCodeRaw}`;
    const regionName = (regionVal && regionVal.region_name) || `Region ${regionCodeRaw}`;
    t.regions.push({ code: regionCode, name: regionName });
    const provinces = (regionVal && regionVal.province_list) || {};
    let pIdx = 0;
    for (const [provName, provVal] of Object.entries(provinces)){
      pIdx++;
      const provCode = `${regionCode}-P${String(pIdx).padStart(2,'0')}`;
      t.provinces.push({ code: provCode, region_code: regionCode, name: provName });
      const cities = (provVal && provVal.municipality_list) || {};
      let cIdx = 0;
      for (const [cityName, cityVal] of Object.entries(cities)){
        cIdx++;
        const cityCode = `${provCode}-C${String(cIdx).padStart(3,'0')}`;
        t.cities.push({ code: cityCode, province_code: provCode, name: cityName });
        const bgys = (cityVal && cityVal.barangay_list) || [];
        let bIdx = 0;
        for (const bName of bgys){
          bIdx++;
          const bCode = `${cityCode}-B${String(bIdx).padStart(4,'0')}`;
          t.barangays.push({ code: bCode, city_code: cityCode, name: String(bName) });
        }
      }
    }
  }
  return t;
}

// PSA-style flat: [{code, name, geographic_level: 'Reg'|'Prov'|'Mun'|'City'|'Bgy'}]
function normalizeFlat(rows){
  const t = emptyTables();
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(r => seen.has(r.code) ? false : (seen.add(r.code), true));
  };
  for (const r of rows){
    const code = String(r.code || r.psgc_code || '').trim();
    const name = String(r.name || r['Name'] || '').trim();
    const level = String(r.geographic_level || r.level || r['Geographic Level'] || '').trim().toLowerCase();
    if (!code || !name) continue;
    if (level.startsWith('reg')) t.regions.push({ code, name });
    else if (level.startsWith('prov')) t.provinces.push({ code, region_code: deriveRegion(code), name });
    else if (level === 'mun' || level === 'city' || level === 'subm' || level === 'submun') t.cities.push({ code, province_code: deriveProvince(code), name });
    else if (level === 'bgy' || level === 'brgy' || level === 'barangay') t.barangays.push({ code, city_code: deriveCity(code), name });
  }
  t.regions   = dedup(t.regions);
  t.provinces = dedup(t.provinces);
  t.cities    = dedup(t.cities);
  t.barangays = dedup(t.barangays);
  return t;
}

// 10-digit PSGC structure: RRPPMMMBBB where R=region(2), P=province(2),
// M=city/mun(3), B=barangay(3). Parent codes pad the trailing digits with 0s.
function deriveRegion(code){ return code.slice(0,2).padEnd(10,'0'); }
function deriveProvince(code){ return code.slice(0,4).padEnd(10,'0'); }
function deriveCity(code){ return code.slice(0,7).padEnd(10,'0'); }

// OSS-style hierarchical: { "RegionName": { provinces: { "Prov": { ... }}}}
// or older shape: { "RegionName": { "ProvinceName": { "CityName": ["Bgy1",...] }}}
function normalizeHierarchical(obj){
  const t = emptyTables();
  let rIdx = 0;
  for (const [regionName, regionVal] of Object.entries(obj)){
    rIdx++;
    const regionCode = `R${String(rIdx).padStart(2,'0')}`;
    t.regions.push({ code: regionCode, name: regionName });
    const provinces = regionVal && regionVal.provinces ? regionVal.provinces : regionVal;
    if (!provinces || typeof provinces !== 'object') continue;
    let pIdx = 0;
    for (const [provName, provVal] of Object.entries(provinces)){
      pIdx++;
      const provCode = `${regionCode}-P${String(pIdx).padStart(2,'0')}`;
      t.provinces.push({ code: provCode, region_code: regionCode, name: provName });
      const cities = provVal && provVal.municipalities ? provVal.municipalities
                  : provVal && provVal.cities ? provVal.cities
                  : provVal;
      if (!cities || typeof cities !== 'object') continue;
      let cIdx = 0;
      for (const [cityName, cityVal] of Object.entries(cities)){
        cIdx++;
        const cityCode = `${provCode}-C${String(cIdx).padStart(3,'0')}`;
        t.cities.push({ code: cityCode, province_code: provCode, name: cityName });
        const barangays = Array.isArray(cityVal) ? cityVal
                       : (cityVal && cityVal.barangays) ? cityVal.barangays
                       : null;
        if (!Array.isArray(barangays)) continue;
        let bIdx = 0;
        for (const bName of barangays){
          bIdx++;
          const bCode = `${cityCode}-B${String(bIdx).padStart(4,'0')}`;
          t.barangays.push({ code: bCode, city_code: cityCode, name: String(bName) });
        }
      }
    }
  }
  return t;
}

// ---------- 3. Bulk upsert -----------------------------------------------

async function upsertBatch(table, rows, conflictCol){
  const url = `${REST}/${table}?on_conflict=${conflictCol}`;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });
  if (!r.ok){
    const text = await r.text();
    throw new Error(`Upsert ${table} failed (${r.status}): ${text.slice(0, 500)}`);
  }
}

async function loadTable(table, rows, conflictCol){
  if (!rows.length){ console.log(`  ${table}: skipped (0 rows)`); return; }
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH){
    const slice = rows.slice(i, i + BATCH);
    await upsertBatch(table, slice, conflictCol);
    done += slice.length;
    process.stdout.write(`  ${table}: ${done}/${rows.length}\r`);
  }
  console.log(`  ${table}: ${done}/${rows.length} ✓`);
}

// ---------- main ---------------------------------------------------------

(async () => {
  const raw = await fetchSource();
  const t = normalize(raw);
  console.log(`\nNormalized counts:`);
  console.log(`  regions:    ${t.regions.length}`);
  console.log(`  provinces:  ${t.provinces.length}`);
  console.log(`  cities:     ${t.cities.length}`);
  console.log(`  barangays:  ${t.barangays.length}\n`);

  if (!t.regions.length){
    console.error('No regions parsed — the input shape may be unsupported. Aborting.');
    process.exit(2);
  }

  console.log('Upserting to Supabase...');
  await loadTable('psgc_regions',   t.regions,   'code');
  await loadTable('psgc_provinces', t.provinces, 'code');
  await loadTable('psgc_cities',    t.cities,    'code');
  await loadTable('psgc_barangays', t.barangays, 'code');
  console.log('\nDone.');
})().catch(err => {
  console.error('\nLoader failed:', err.message);
  process.exit(1);
});
