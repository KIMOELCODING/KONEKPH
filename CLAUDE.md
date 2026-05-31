# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Konek.ph** is a Philippine real estate broker dashboard. Current state of the repo:

- `index.html` — **active** frontend (~185 lines, ~5.3 MB). Minified onto two huge lines: line 174 ≈ 4.8 MB of base64 assets, line 182 ≈ 505 KB of HTML/CSS/JS. Navigate by **string-anchor grep**, never line numbers. A `<style id="k-net-new-ui">` + `<script id="k-net-new-ui-js">` pair is appended just before `</body>` to inject the §7.3 net-new UI (see below).
- `Draft 19.html` — **archive**; do not edit. Kept for diffing against the older single-file shape.
- `BACKEND_PLAN.md` — production backend design (Supabase + Cloudflare + PayMongo). Carries a per-area `Status: DONE / PARTIAL / TODO` marker so you can scan progress without diffing files. Schema for `profiles`, `listings`, `notifications`, PSGC + property_types lookups, several triggers, and most RLS are already implemented; messaging/calendar/articles/payments/referrals/audit/conversation-states schema + all 7 Edge Functions are still pending.
- `supabase/migrations/0001_initial_schema.sql` (282 lines), `supabase/migrations/0002_seed_psgc.sql` (72 lines), `supabase/storage_buckets.sql` (76 lines) — partial backend.
- `admin/` (built bundle) + `admin-src/` (Vite + React 18 + TS + React Router + Supabase) — separate admin web app at `admin.konek.ph` (planned). Pages present: `Login`, `BrokerApprovals`, `ListingApprovals`. Missing: `AdminArticles`, `AdminUsers`.
- `config.js` — gitignored, holds `window.SUPABASE_URL` + `window.SUPABASE_ANON_KEY` pointing to a live Supabase project.
- `service-worker.js`, `manifest.webmanifest`, `icons/` — PWA shell.

Demo login (mock, client-side only): `admin@konek.ph` / `admin123`.

## Development Workflow

- **Run the broker frontend**: open `index.html` directly in a browser. PowerShell: `start "index.html"`. No build, no install, no server.
- **Run the admin app (dev)**: `npm --prefix admin-src install` then `npm --prefix admin-src run dev`. Production build output is committed at `admin/`.
- External CDN deps: Google Fonts (Inter, Plus Jakarta Sans), Font Awesome 6.5.0, Chart.js 4.4.0, (and `@supabase/supabase-js` once it's wired into the broker HTML).
- No test suite, no lint config. Validate broker-frontend changes by reloading `index.html` in a browser.
- "Today" inside the broker app is still hardcoded to **2026-05-06** for calendar/event rendering — don't conflate with the real date when reasoning about calendar code.

## Known stale UI to fix when wiring the backend

- Premium page (anchors: `Enterprise`, `₱999/month`) still advertises **Basic (Free) / Premium ₱999/month / Enterprise**. Rewrite to Regular vs Premium quarterly + monthly-quota model — see `BACKEND_PLAN.md` §7.1.1 / §7.3 / §11.
- Signup form (anchors: `su-fname`, `su-lname`, `su-email`, `su-phone`, `su-pw`, `su-pw2`) is missing **PRC license #**, **1×1 photo upload**, **PRC ID upload**, **scrolled-to-bottom ToS checkbox** — all required by the plan. Schema columns `profiles.id_photo_url`, `profiles.prc_id_url`, `profiles.tos_accepted_at` are currently nullable in 0001 to allow signups during this gap; tighten to `not null` once the form is extended.
- Calendar "today" hardcoded to 2026-05-06 (`calYr`, `calMo`, `CAL_EVENTS=`). Unhardcode when wiring `calendar_events`.

## Frontend Architecture (`index.html`)

### Page/Navigation system

Pages are `<div class="page">` elements inside `#app-shell > .main`. Only the active page has `display:flex`; all others are hidden. `goTo(k)` drives navigation by toggling `.active` and syncing the sidebar `<a class="nav-link" data-page="…">`. PAGES keys (15 baked-in + 2 injected by §7.3):

```
home, dashboard, listings, your-listings, bookmarks, listing-detail, messages,
broker, calendar, profile, settings, help, premium, notifications, article,
pending-approval (injected), paywall (injected)
```

Inner pages (profile, settings, broker profile, etc.) navigate back with `goTo('dashboard')`. The broker profile sub-page is reached via `openBrokerProfile()` from inside Messages.

### Auth → app shell transition

`#app-login` is visible by default; `#app-shell` is hidden until `doLogin()` or `doSignup()` adds `.visible` to `#app-shell` and then calls `initCharts()`. `doLogout()` reverses this. Charts are stored in module-level vars (`analyticsChart`, `postingChart`) and destroyed on re-init.

The §7.3 injector **wraps** the original `doLogin` so that after the normal post-login transition, it routes to `pending-approval` (when `__currentUser.is_approved===false`) or `paywall` (when trial/sub expired). The placeholder `window.__currentUser` defaults to a Regular trial broker — replace with a real profile fetch when Supabase Auth is wired.

### Modal / overlay system

`showModal(id)` and `closeModal(id)` toggle `.show` on `.overlay` elements. Built-in overlay ids: `overlay-logout`, `overlay-submit-success`, `overlay-add-listing`, `overlay-adv-filter`, `overlay-new-event`. Injected by §7.3: `overlay-accuracy-agreement` (gates Add Listing submit), `overlay-upgrade` (Premium upsell).

### Calendar

State: `calYr`, `calMo` (0-indexed), `calView` (`'month'` | `'week'`), `calWeekOffset`. Renderers: `renderMiniCal()`, `renderBigCal()`, `renderWeekView()`. Events hardcoded in `CAL_EVENTS` keyed `'YYYY-M-D'`.

### Messaging

`selectChat(el, name, role, av, email, isFirst)` updates the chat header/panel/body and writes `currentBroker`, which `openBrokerProfile()` reads to navigate via `goTo('broker')`. The previous `goTo('contacts')` bug is gone in Draft 28.

### §7.3 net-new broker UI (Draft 28-only)

Injected at the end of `<body>`:

- `#page-pending-approval` — envelope-icon card, "Your account is under review", Sign out button.
- `#page-paywall` — Regular vs Premium cards. Premium has GCash + Card buttons (placeholder `alert` until `paymongo-create-source` Edge Function is built).
- `#overlay-accuracy-agreement` — RESA Act §29 confirmation checkbox; Confirm button gated until checked; intercepts Add Listing submit then re-fires it after confirmation.
- `#overlay-upgrade` — generic Premium upsell, opened by any locked feature.
- Lock icon decorators on sidebar `[data-page="messages"]` and listing-detail Call buttons. Click is captured at the capture phase and routed to the upgrade modal when `__currentUser.subscription_tier !== 'premium'`.

Test hooks exposed for DevTools: `window.__currentUser`, `window.__konekIsPremium()`, `window.__konekRoute()`, `window.__konekShowPaywall()`, `window.__konekShowPending()`, `window.__konekOpenUpgrade()`.

### Mock data — now overridden at runtime by `<script id="k-data">`

The four mock constants (`LISTINGS_DATA`, `YOUR_LISTINGS`, `CAL_EVENTS`, `HOME_ARTICLES`) still exist in the minified blob as fallback, but `<script id="k-data">` (appended right after `k-auth`) reassigns `window.*` versions from live Supabase queries after every `__konekRoute()` call:

- `listings` → `LISTINGS_DATA` (status=active, limit 50) + `YOUR_LISTINGS` (broker_id=current). Images resolved via `sb.storage.from('listing-images').getPublicUrl(path)`.
- `calendar_events` → `CAL_EVENTS` keyed `'YYYY-M-D'` (month not zero-padded). Priority → `cls`: urgent/high → `ev-p`, normal → `ev-g`, low → `ev-b`.
- `articles` → `HOME_ARTICLES` grouped by `type` (`news`/`announcement`/`memorandum`), only rows with non-null `published_at`.

Known limitation: the original `let calYr/calMo = 2026, 4` is closure-lexical, so writing `window.calYr` doesn't unhardcode the calendar's initial month. Tracked as TODO — needs a `let`→`var` swap on the minified blob.

`PSGC` and `PROP_TYPES` constants → already seeded in `0002_seed_psgc.sql` (curated subset).

### CSS conventions

- Theme tokens on `:root`: greens (`--gd`, `--gm`, `--gl`, `--ga`), text (`--td`, `--tm`, `--ts`, `--tl`), borders (`--br`), shadows (`--sh`/`--sh2`/`--sh3`).
- Glassmorphism: `background: rgba(255,255,255, .5–.65)` + `backdrop-filter: blur(20px) saturate(180%)` + `border: 1px solid rgba(255,255,255, .7–.9)`.
- Collapsible sidebar 68px → `var(--sw)` (230px) on `:hover` — pure CSS, no JS.
- The §7.3 injector reuses these tokens (`var(--gd)`, `var(--tm)`, etc.) so injected screens match the rest of the app.

## Backend (planned — see `BACKEND_PLAN.md`)

The backend is **partially** built. Treat `BACKEND_PLAN.md` as the spec and consult its per-area `**Status:**` markers + section §0 Implementation status before touching anything.

- Stack: Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) behind Cloudflare (DNS proxy, CDN, WAF). Broker frontend served from Cloudflare Pages at `app.konek.ph`; admin app at `admin.konek.ph`.
- Roles: brokers self-signup (with PRC ID + 1×1 photo into the private `id-documents` bucket); admins seeded manually. Brokers start `is_approved=false` → admin approves → 3-day trial → quarterly PayMongo charge (**price TBD**, pending expense analysis — use `₱TBD` placeholder).
- Two tiers: Regular and Premium. **Listing quota refreshes monthly** for both tiers, independent of billing. Tier defaults: Regular = 10/month, Premium = 15/month (numbers TBD). Premium also unlocks chat + matching + call; Regular sees these as locked → upgrade modal.
- Listings: admin-approved per-listing; editing a listing as a non-admin resets `status` to `'pending'` via trigger.
- Realtime chat uses Supabase Realtime on `messages`; gated to Premium on both ends via RLS + trigger.
- Pending work tracked in `BACKEND_PLAN.md` §12 build order: next-up items are migration `0003_messaging_billing.sql`, then Edge Functions, then wiring `doSignup`/`doLogin`/`doLogout` in `index.html`.

## Working in this repo

- Prefer surgical, anchor-based edits to `index.html`. Never try to Read line 174 or 182 whole — use Grep with literal substrings to locate, then Edit with unique surrounding context.
- Do **not** introduce a build step, framework, or package manager to the broker frontend. The "open the file in a browser" workflow is a deliberate constraint.
- The admin app (`admin-src/`) is a separate Vite/React/TS project — normal `npm` workflow applies there.
- When adding new broker UI listed in `BACKEND_PLAN.md` §7.3, follow the existing `<div class="page">` + `goTo` pattern and `.overlay`/`.modal` pattern. The §7.3 injector at the end of `<body>` shows a working example (DOM injection + PAGES extension + click-capture for tier locks).
