# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keeping this file honest (read first)

This file was rewritten on **2026-07-18** after the previous version had drifted into fiction —
it described a "Draft 28" mock app with a barely-built backend and pointed sessions at work
that was already done. **How it went stale:** it was written as a frozen snapshot (hardcoded
migration lists, page keys, "missing" features) while the code kept moving, and nothing updated
the snapshot. `BACKEND_PLAN.md` rotted the same way — its `Status:` markers are dated
2026-05-13 and still call shipped features (messaging, calendar, articles) "TODO".

**The convention that keeps this current:** describe **where to look**, not **what you'll
find**. Anything enumerable — migrations, `k-*` modules, page keys, tables, buckets, functions —
is pointed at its source of truth with the command to list it, not transcribed into a list that
freezes. Where a snapshot count appears it is marked *"as of <date>, verify"* and is illustrative
only. When you add a feature, you should not need to edit an inventory here — if you find
yourself wanting to, that inventory shouldn't have been hardcoded. Only edit this file when an
**architectural rule or workflow** changes.

## Project Overview

**ProList** (formerly **Konek.ph** — rebranded 2026-06-02) is a Philippine real estate
**broker-to-broker** platform. Only brokers are users; buyers/clients stay off-platform, so all
comms stay in-app. Internal `konek` identifiers, folder names, the repo, infra URLs, and skill
names are kept on purpose after the rebrand — **do not "fix" them.**

Three deployable surfaces:

1. **Broker frontend** — `index.html`, a single self-unpacking bundle (~14.5k lines, ~5.3 MB).
   The **active** app. See "The index.html bundle" — it has a hard editing constraint.
2. **Admin app** — `admin-src/` (Vite + React 18 + TS + React Router + `@supabase/supabase-js`);
   built bundle committed at `admin/` (gitignored source-of-truth is `admin-src/`).
3. **Public marketing site** — `public-site/` (static) + `marketing-src/` (React portal for
   marketing users). Built 2026-06-20.

Shared backend: a live **Supabase** project (ref `ffewjmucspcswdcxouvc`, ap-southeast-1).
`config.js` (gitignored) holds `window.SUPABASE_URL` + `window.SUPABASE_ANON_KEY`.
PWA shell: `service-worker.js`, `manifest.webmanifest`, `icons/`.

`Draft 19.html` — **archive; never edit.**

### Supabase plan: FREE (as of 2026-07-18 — verify)

Pro lapsed. Consequences that are baked into the code and must stay in mind:

- **Image transforms are Pro-only.** `window.__PL_IMG_TX` (in `index.html`, the `k-data`
  module) now defaults to **false** → falls back to full-size `getPublicUrl`. On Free, transform
  URLs return **403** (verified against a live listing image); the plain URL returns 200. Flip
  the default back to `true` when the project returns to Pro. `localStorage 'prolist.imgtx'`
  (`'1'`/`'0'`) overrides per-browser.
- **Auto-pause** after ~7 days idle (a paused project stops resolving in DNS and the Management
  API times out — that's "paused," not "broken"). **No backups on Free.**

## Development Workflow

- **Run the broker frontend**: open `index.html` in a browser (`start "index.html"`). No build,
  no install, no server — and do **not** add one. That constraint is deliberate.
- **Run the admin app / marketing portal (dev)**: `npm --prefix admin-src install` then
  `npm --prefix admin-src run dev`. `vite.config.ts` pins port **5173**, which is often blocked
  on the dev Windows box — override with `-- --port 3030 --host 127.0.0.1`.
- **No test suite / no lint.** Browser-rendered behavior (auth, routing, RLS, realtime,
  tier-locks) is verified by driving **real headless Chrome over the DevTools Protocol (CDP)**
  with plain Node 22 (global `WebSocket`) — there is no Playwright here. Reusable harnesses
  accumulate in the session scratchpad.
- The calendar's "today" is **not** hardcoded (derives from `new Date()`). Ignore any older note
  claiming it is pinned to 2026-05-06.

## The index.html bundle — READ BEFORE EDITING

`index.html` is a **self-unpacking bundle**, not merely minified:

- **Line ~227 (~4.6 MB)** — one giant JSON string: the app template + base64 assets, unpacked
  at runtime.
- **Line ~235 (~0.48 MB)** — the unpacker/bootstrap.
- **Everything after (~line 236 →)** — readable, appended `<script id="k-*">` / `<style id="k-*">`
  modules that carry nearly all real features. These edit normally.

Hard rules:
- **Never Read the two bundle lines whole** — they blow up context. Locate with **Grep on literal
  string anchors**, never line numbers.
- **Edits inside the line-227 JSON string must be JSON-escaped**, or the app dies at load with
  **"Bundle unpack error"** (this broke once, commit `974ce18`, fixed 2026-06-21). Prefer editing
  the readable `k-*` modules — that's where most features live.
- **Always validate after editing**: `node scripts/check-bundle.cjs index.html`. A pre-commit
  hook (`.githooks/pre-commit`, via `core.hooksPath`) also runs it.

### Enumerating the parts (don't trust a transcribed list)

- **`k-*` modules** (the appended feature layers): list them in source with
  `grep -n '<script id="k-\|<style id="k-' index.html`, or at runtime with
  `document.querySelectorAll('[id^="k-"]')`. There are ~50 in source *(as of 2026-07-18)*.
  Load-bearing ones you'll meet often: `k-auth` / `k-signup-wizard` (auth + multi-step signup),
  `k-data` / `k-realtime-data` (live Supabase wiring; `k-data` also defines `__plImg` +
  `__PL_IMG_TX`), `k-messages` / `k-chat-drawer` (realtime chat), `k-net-new-ui*` (tier-lock &
  onboarding injector — see "Tier-lock layer"), `k-moa-js` / `k-signature` (MOA + e-signature).
- **Page keys**: `goTo(key)` drives navigation. `PAGES` lives inside the line-227 bundle and is
  **not** a runtime global. Enumerate the sidebar-reachable set from the DOM:
  `[...document.querySelectorAll('[data-page]')].map(a=>a.dataset.page)`; others (e.g.
  `listing-detail`, `broker`, `premium`, `notifications`, `article`, and the injected
  `pending-approval` / `paywall`) are reached programmatically. To see them all, grep `data-page=`
  plus the `k-net-new-ui-js` PAGES extension.

## Frontend Architecture (`index.html`)

### Page / navigation
Pages are `<div class="page">` inside `#app-shell > .main`; only the active one shows. `goTo(k)`
toggles `.active` and syncs the sidebar `<a class="nav-link" data-page="…">`.

### Auth → app shell
`#app-login` shows by default; `doLogin()` / `doSignup()` add `.visible` to `#app-shell` and call
`initCharts()` (Chart.js: `analyticsChart`, `postingChart`, destroyed on re-init). `doLogout()`
reverses it. Auth is wired to Supabase. The `k-net-new-ui` injector routes an approved-but-unpaid
or expired user to `pending-approval` / `paywall`. DevTools hooks: `window.__currentUser`,
`__konekIsPremium()`, `__konekRoute()`, `__konekShowPaywall()`, `__konekShowPending()`,
`__konekOpenUpgrade()`.

### Tier-lock layer — currently DORMANT (important)
Premium gating (the `decorateLocks()` decorator + `route()` paywall redirect + upgrade overlay)
is behind a master switch: `window.__konekBillingEnabled`, which **defaults to `false`**
("billing deferred" while trial/PayMongo/pricing are TBD). Because of that switch:

> `isPremium()` returns `true` for **every** user while billing is off (`billingOn()` is false →
> `isPremium()` short-circuits to `true`). So `decorateLocks()` hits its `if (isPremium()) return;`
> guard and **early-returns for everyone — no tier gate has ever actually run in the live app.**

Consequences to respect:
- Locks you see in the source (e.g. the listing-detail **Call** button lock) are **latent**, not
  active. The **Messages** lock was removed outright (2026-07-18 decision: **chat is free for all
  tiers**, because a matched broker may be Regular and must be able to reply — Premium's value is
  the matching engine + direct call, not messaging).
- **When billing is flipped on, this entire layer goes live having never been exercised.** Treat
  turning `__konekBillingEnabled` on as shipping untested code: drive every gated path (paywall
  route, Call lock, upgrade overlay, quota) under a real non-Premium session before trusting it.
- To test any gate today you must force `window.__konekBillingEnabled = true` **and** set a
  non-premium `__currentUser` — otherwise everything reads as Premium.

### Modals / overlays
`showModal(id)` / `closeModal(id)` toggle `.show` on `.overlay` elements (`overlay-logout`,
`overlay-add-listing`, `overlay-adv-filter`, `overlay-new-event`, injected
`overlay-accuracy-agreement` = RESA Act §29 gate on Add Listing, `overlay-upgrade` = upsell).

### Messaging
Full realtime chat on the `messages` table. `onRealtimeMessageUpdate` merges a fixed
`MERGE_FIELDS` set (`read_at, delivered_at, deleted_at, pinned_at, body, edited_at`) from
`payload.new` — a synthetic realtime payload that omits any of these will corrupt that field, so
test fixtures must send the full row. The chat drawer (`k-chat-drawer`) hosts Shared Media,
Pinned Messages, Mute, and Report.

### CSS conventions
- `:root` tokens: greens (`--gd/--gm/--gl/--ga`), text (`--td/--tm/--ts/--tl`), borders (`--br`),
  shadows (`--sh/--sh2/--sh3`).
- Glassmorphism: `rgba(255,255,255,.5–.65)` + `backdrop-filter: blur(20px) saturate(180%)` +
  `1px solid rgba(255,255,255,.7–.9)`.
- Collapsible sidebar 68px → `var(--sw)` (230px) on `:hover`, pure CSS.

## Backend (Supabase) — source of truth is the DB, not any doc

`BACKEND_PLAN.md` is the original **design intent**; its status markers are stale. Ground truth:

- **Schema / migrations**: `supabase/migrations/` is the source of truth. `ls` it for the current
  range and read the header comment of each for what it does — do **not** rely on a list here.
  Live tables: `select table_name from information_schema.tables where table_schema='public'`.
- **Storage buckets**: defined in `supabase/storage_buckets.sql` (+ later migrations). List live:
  `select id from storage.buckets`. `id-documents` is private; the rest are public.
- **Edge Functions**: `ls supabase/functions/`. Deploy with the `deploy-supabase-function` skill.
- **RLS is the real security boundary.** The standard for "done" on any DB change is a
  **role-switch RLS proof** (seed as `postgres`, then `set local role authenticated` +
  `set_config('request.jwt.claim.sub', <uid>, true)` to simulate each user), not a passing query.
  Note Supabase re-grants `EXECUTE` to `anon` on new public functions — revoke from `public` AND
  `anon`. `conversations` has `check (participant_a < participant_b)`.

### Live DB access
Run SQL on the live project via the Supabase Management API using a CLI token stored in Windows
Credential Manager (`Supabase CLI:supabase`); a `runsql.ps1` helper lives in the scratchpad.
**One statement per call** — it rejects multi-statement / begin / commit. Never echo the token.

## Admin app (`admin-src/`, built → `admin/`)
Pages live in `admin-src/src/pages/` (`ls` it) and are routed with lazy chunks in
`admin-src/src/App.tsx`; the guard resolves the session, checks the admin role, and redirects anon
users to Login. `admin/` (built) is gitignored; `admin-src/` is the source of truth.

## Working in this repo
- Prefer surgical, anchor-based edits to `index.html`. Never Read the bundle lines whole; Grep
  literal substrings, Edit with unique context, then `node scripts/check-bundle.cjs index.html`.
- Do **not** add a build step / framework / package manager to the broker frontend.
- `admin-src/` and `marketing-src/` are normal Vite/React/TS projects — standard `npm` there.
- Verify browser-rendered changes for real (CDP-driven headless Chrome). "The Edit returned ok" is
  not verification for auth/routing/RLS/realtime/tier-lock behavior.
- Keep `konek`-named identifiers/paths as-is despite the ProList rebrand.
