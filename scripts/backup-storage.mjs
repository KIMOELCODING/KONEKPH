#!/usr/bin/env node
// ProList — local Supabase Storage backup.
//
// Supabase Pro's daily backups cover the Postgres database ONLY, not Storage
// objects (the database just holds file paths). This script downloads every
// object from every Storage bucket — id-documents (broker PRC IDs + 1x1
// photos), listing-images, avatars — into a local timestamped folder so the
// uploaded files are recoverable if anything is deleted in Storage.
//
// Zero dependencies: uses Node's built-in fetch + fs (requires Node 18+).
//
// SETUP (one time):
//   1. Copy scripts/storage-backup.example.json -> scripts/storage-backup.local.json
//   2. Paste your project URL + SERVICE ROLE key (Supabase Dashboard ->
//      Project Settings -> API -> service_role secret). This file is gitignored.
//      (Or set env vars SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY instead.)
//
// RUN:
//   node scripts/backup-storage.mjs
//
// Output: ./storage-backups/<YYYY-MM-DD_HH-mm-ss>/<bucket>/<path...>
// plus a manifest.json with per-bucket counts/bytes.
//
// The service_role key bypasses RLS — it is a full-access secret. Keep
// storage-backup.local.json out of git (it already is) and never share it.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ---- Load config (env vars win; else the gitignored local JSON) ------------
async function loadConfig() {
  let url = process.env.SUPABASE_URL || '';
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    try {
      const raw = await readFile(join(__dirname, 'storage-backup.local.json'), 'utf8');
      const cfg = JSON.parse(raw);
      url = url || cfg.url || cfg.SUPABASE_URL || '';
      key = key || cfg.serviceRoleKey || cfg.SUPABASE_SERVICE_ROLE_KEY || '';
    } catch { /* no local file — fall through to the error below */ }
  }
  if (!url || !key) {
    console.error(
      '\n[backup-storage] Missing credentials.\n' +
      '  Create scripts/storage-backup.local.json (copy the .example.json) with\n' +
      '  your project URL + service_role key, or set SUPABASE_URL and\n' +
      '  SUPABASE_SERVICE_ROLE_KEY environment variables.\n'
    );
    process.exit(1);
  }
  return { url: url.replace(/\/+$/, ''), key };
}

// ---- Storage REST helpers --------------------------------------------------
function api(cfg, path, init = {}) {
  return fetch(cfg.url + '/storage/v1' + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + cfg.key,
      apikey: cfg.key,
      ...(init.headers || {}),
    },
  });
}

async function listBuckets(cfg) {
  const res = await api(cfg, '/bucket');
  if (!res.ok) throw new Error('list buckets failed: ' + res.status + ' ' + (await res.text()));
  return (await res.json()).map((b) => b.name);
}

// List one prefix level. Supabase returns "folders" as entries with id === null;
// real files have a non-null id. Paginates until a short page is returned.
async function listPrefix(cfg, bucket, prefix) {
  const out = [];
  const PAGE = 100;
  let offset = 0;
  for (;;) {
    const res = await api(cfg, '/object/list/' + encodeURIComponent(bucket), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error('list ' + bucket + '/' + prefix + ' failed: ' + res.status + ' ' + (await res.text()));
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Recursively collect every file path under a bucket.
async function walkBucket(cfg, bucket, prefix = '') {
  const entries = await listPrefix(cfg, bucket, prefix);
  const files = [];
  for (const e of entries) {
    if (!e || !e.name) continue;
    const full = prefix ? prefix + '/' + e.name : e.name;
    if (e.id === null || e.id === undefined) {
      // folder placeholder — recurse
      files.push(...await walkBucket(cfg, bucket, full));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function downloadObject(cfg, bucket, path, destFile) {
  const res = await api(cfg, '/object/' + encodeURIComponent(bucket) + '/' + path.split('/').map(encodeURIComponent).join('/'));
  if (!res.ok) throw new Error('download ' + bucket + '/' + path + ' failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destFile), { recursive: true });
  await writeFile(destFile, buf);
  return buf.length;
}

// ---- Main ------------------------------------------------------------------
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function main() {
  const cfg = await loadConfig();
  const runDir = join(REPO_ROOT, 'storage-backups', stamp());
  console.log('[backup-storage] project:', cfg.url);
  console.log('[backup-storage] output :', runDir, '\n');

  const buckets = await listBuckets(cfg);
  console.log('[backup-storage] buckets:', buckets.join(', '), '\n');

  const manifest = { startedAt: new Date().toISOString(), project: cfg.url, buckets: {} };
  let grandFiles = 0, grandBytes = 0;

  for (const bucket of buckets) {
    process.stdout.write(`  ${bucket}: listing… `);
    const paths = await walkBucket(cfg, bucket);
    console.log(paths.length + ' file(s)');
    let bytes = 0, ok = 0, failed = 0;
    for (const p of paths) {
      try {
        bytes += await downloadObject(cfg, bucket, p, join(runDir, bucket, ...p.split('/')));
        ok++;
        if (ok % 25 === 0) process.stdout.write(`    …${ok}/${paths.length}\n`);
      } catch (err) {
        failed++;
        console.warn('    ! ' + p + ' — ' + err.message);
      }
    }
    manifest.buckets[bucket] = { files: ok, failed, bytes };
    grandFiles += ok; grandBytes += bytes;
    console.log(`    ${bucket}: ${ok} downloaded, ${failed} failed, ${(bytes / 1048576).toFixed(1)} MB`);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.totals = { files: grandFiles, bytes: grandBytes };
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n[backup-storage] DONE — ${grandFiles} file(s), ${(grandBytes / 1048576).toFixed(1)} MB`);
  console.log('[backup-storage] saved to', runDir);
}

main().catch((err) => {
  console.error('\n[backup-storage] FAILED:', err.message);
  process.exit(1);
});
