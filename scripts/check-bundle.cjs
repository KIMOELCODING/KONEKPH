#!/usr/bin/env node
// Guard against shipping an unbootable index.html.
//
// index.html is a self-unpacking bundle: the whole app HTML lives inside a
// <script type="__bundler/template"> as a single JSON string, plus a
// __bundler/manifest of base64 assets. A raw control character pasted into the
// template string (e.g. pretty-printed HTML with literal newlines) makes
// JSON.parse throw at boot and the entire app dies with "Bundle unpack error".
// Commit 974ce18 did exactly that and shipped it. This script re-parses each
// __bundler/* script and fails (non-zero exit) if any is invalid.
//
// Usage:
//   node scripts/check-bundle.cjs [path]      # validate a file (default: index.html)
//   git show :index.html | node scripts/check-bundle.cjs   # validate staged blob via stdin
'use strict';
const fs = require('fs');

function readInput() {
  const arg = process.argv[2];
  if (arg && arg !== '-') return fs.readFileSync(arg, 'utf8');
  if (arg === '-' || !process.stdin.isTTY) return fs.readFileSync(0, 'utf8'); // stdin
  return fs.readFileSync('index.html', 'utf8');
}

const html = readInput();
const required = ['manifest', 'template'];
const optional = ['ext_resources'];
let failed = false;

for (const t of required.concat(optional)) {
  const tag = '<script type="__bundler/' + t + '">';
  const s = html.indexOf(tag);
  if (s < 0) {
    if (optional.includes(t)) continue;
    console.error('check-bundle: FAIL — missing <script __bundler/' + t + '>');
    failed = true;
    continue;
  }
  const cs = s + tag.length;
  const e = html.indexOf('</script>', cs);
  const text = html.slice(cs, e).trim();
  try {
    JSON.parse(text);
  } catch (err) {
    console.error('check-bundle: FAIL — __bundler/' + t + ' JSON is invalid: ' + err.message);
    console.error('  (a raw control char in the template string? edits there must be JSON-escaped.)');
    failed = true;
  }
}

if (failed) {
  console.error('check-bundle: index.html would NOT boot. Fix before committing.');
  process.exit(1);
}
console.log('check-bundle: OK — __bundler/* scripts parse cleanly.');
