#!/usr/bin/env bash
# Cloudflare Pages build for the ProList PUBLIC marketing site (prolistph.com).
# Separate Pages project from the broker/admin app (build.sh). Assembles a clean
# dist-public/ from public-site/ and injects config.js from Pages env vars so the
# anon key + Turnstile site key are never committed.
set -euo pipefail

# 1) Clean publish dir with the static public-site assets.
rm -rf dist-public && mkdir -p dist-public
cp -r public-site/* dist-public/
# Never publish the local/example configs — config.js is generated below.
rm -f dist-public/config.js dist-public/config.example.js

# 2) Generate config.js from Pages env vars.
#    SUPABASE_URL + SUPABASE_ANON_KEY are required; TURNSTILE_SITE_KEY is optional
#    (empty = anti-bot widget disabled, but submit-lead still requires a token, so
#    set it for production).
printf "window.SUPABASE_URL='%s';\nwindow.SUPABASE_ANON_KEY='%s';\nwindow.TURNSTILE_SITE_KEY='%s';\n" \
  "$SUPABASE_URL" "$SUPABASE_ANON_KEY" "${TURNSTILE_SITE_KEY:-}" > dist-public/config.js

echo "Build complete: dist-public/ assembled with injected config.js"
