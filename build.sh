#!/usr/bin/env bash
# Cloudflare Pages build for ProList.
# Builds the admin + marketing React apps, assembles a clean dist/ (so repo
# source/docs are NOT published), and injects config.js for every portal from
# Pages env vars.
set -euo pipefail

# 1) Build the admin React app (vite outDir = ../admin per admin-src/vite.config.ts)
npm --prefix admin-src ci
npm --prefix admin-src run build

# 1b) Build the marketing portal (vite outDir = ../marketing, base /marketing/).
#     Path-based on this same project: served at /marketing/ (like /admin/).
npm --prefix marketing-src ci
npm --prefix marketing-src run build

# 2) Assemble a clean publish dir — only public assets, never source/docs.
rm -rf dist && mkdir -p dist
cp index.html manifest.webmanifest service-worker.js _headers dist/
cp -r icons dist/icons
cp -r admin dist/admin
cp -r marketing dist/marketing
# marketing-src/public/config.example.js rides along in the vite build output —
# don't publish the placeholder; the real config.js is injected in step 3.
rm -f dist/marketing/config.example.js

# 2b) Stamp a unique service-worker cache VERSION per deploy. Without this the
#     hardcoded 'prolist-v1' never changes, so the activate step never clears the
#     old cache and returning visitors stay on a stale build. A new VERSION each
#     deploy (git SHA, or epoch as fallback) rotates the cache → returning users
#     pick up the latest shell on their next load.
BUILD_ID="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
sed -i "s/const VERSION = '[^']*';/const VERSION = 'prolist-${BUILD_ID}';/" dist/service-worker.js
echo "Stamped service-worker VERSION = prolist-${BUILD_ID}"

# 3) Generate config.js for ALL portals from Pages env vars (never committed).
#    Broker loads "/config.js"; admin loads "/admin/config.js"; marketing loads
#    "/marketing/config.js" (Vite rewrites the root "/config.js" ref per base).
printf "window.SUPABASE_URL='%s';\nwindow.SUPABASE_ANON_KEY='%s';\n" \
  "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > dist/config.js
cp dist/config.js dist/admin/config.js
cp dist/config.js dist/marketing/config.js

echo "Build complete: dist/ assembled with broker + admin + marketing portals and injected config.js"
