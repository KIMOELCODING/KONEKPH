# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Freshness note (verified 2026-07-17).** This file was rewritten after the previous
> version had drifted badly from the code (it described a "Draft 28" mock app with a
> barely-built backend). The claims below were checked against the repo on that date.
> `BACKEND_PLAN.md` is **older still** — its `Status:` markers are dated 2026-05-13 and
> mark shipped features (messaging, calendar, articles) as TODO. **Verify before trusting
> any "TODO / missing / not built" claim in either doc.**

## Project Overview

**ProList** (formerly **Konek.ph** — rebranded 2026-06-02; internal `konek` identifiers,
folder names, repo, and infra URLs are kept on purpose, do not "fix" them) is a Philippine
real estate **broker-to-broker** platform. Only brokers are users; buyers/clients are
off-platform, so all comms stay in-app. There are three deployable surfaces:

1. **Broker frontend** — `index.html`, a single self-contained ~14,581-line file (~5.3 MB).
   The **active** app. See "The index.html bundle" below — it is NOT just "minified," it is
   a self-unpacking bundle with a hard editing constraint.
2. **Admin app** — `admin-src/` (Vite + React 18 + TS + React Router + `@supabase/supabase-js`)
   source, built bundle committed at `admin/`. 10 pages (see "Admin app").
3. **Public marketing site** — `public-site/` (static) + `marketing-src/` (a React portal for
   marketing users). Built 2026-06-20; not yet deployed to Pages as of this writing.

Shared backend: a live **Supabase** project (`ffewjmucspcswdcxouvc`, "KONEK PH",
ap-southeast-1). `config.js` (gitignored) holds `window.SUPABASE_URL` + `window.SUPABASE_ANON_KEY`.
PWA shell: `service-worker.js`, `manifest.webmanifest`, `icons/`.

**Supabase plan: FREE (as of 2026-07-17).** Pro lapsed. Consequence baked into the code:
image transforms are Pro-only, so `window.__PL_IMG_TX` in `index.html` now defaults to
**false** (falls back to full-size `getPublicUrl`). Flip it back to `true` when the project
returns to Pro. Free also auto-pauses after ~7 days idle and has no backups.

`Draft 19.html` — **archive; never edit.**

## Development Workflow

- **Run the broker frontend**: open `index.html` in a browser. PowerShell: `start "index.html"`.
  No build, no install, no server. This is a deliberate constraint — do **not** add a build
  step, framework, or bundler to the broker frontend.
- **Run the admin app (dev)**: `npm --prefix admin-src install`, then
  `npm --prefix admin-src run dev`. Note: `vite.config.ts` pins port **5173**, which is often
  blocked on the dev Windows box — override with `-- --port 3030 --host 127.0.0.1`. Production
  build output is committed at `admin/`.
- **No test suite / no lint.** Correctness of browser-rendered behavior is validated by
  driving real headless Chrome over the DevTools Protocol (CDP) with plain Node 22 — there is
  no Playwright here. Working harnesses accumulate in the session scratchpad.
- "Today" in the calendar is **no longer hardcoded** — it derives from `new Date()`. (The old
  "hardcoded to 2026-05-06" note is obsolete; zero occurrences remain.)

## The index.html bundle — READ THIS BEFORE EDITING

`index.html` is a **self-unpacking bundle**, not merely minified:

- **Line 227 (~4.6 MB)** — one giant JSON string: the app's HTML/CSS/JS template plus base64
  assets, unpacked at runtime.
- **Line 235 (~0.48 MB)** — the unpacker + bootstrap.
- **Lines ~236–14,581** — readable, appended `<script id="k-*">` / `<style id="k-*">` modules
  that layer on nearly all real features. These edit normally.

Hard rules:
- **Never Read line 227 or 235 whole** — they will blow up context. Locate with **Grep on
  literal string anchors**, never line numbers.
- **Edits inside the line-227 JSON string must be JSON-escaped** or the app dies at load with
  **"Bundle unpack error"** (this broke once, commit `974ce18`, fixed 2026-06-21). Prefer
  editing the readable `k-*` modules instead — most features live there.
- **Always validate after editing**: `node scripts/check-bundle.cjs index.html`. A pre-commit
  hook also runs it.

### The `k-*` modules (~50, in document order)

Nearly every shipped feature is a `<script id="k-*">` (or `<style id="k-*">`) appended after
the bundle. Grep `<script id="k-` / `<style id="k-` to list them. Notable ones:

- `k-auth`, `k-signup-extend`, `k-signup-wizard`, `k-pw-meter`, `k-forgot`, `k-login-fix`,
  `k-auth-light` — real Supabase auth, multi-step signup wizard, password UX.
- `k-data`, `k-realtime-data`, `k-psgc-db` — live Supabase data wiring (replaces the old mock
  constants). `k-data` also defines `window.__plImg(bucket,path,w,h)` + the `__PL_IMG_TX` flag.
- `k-messages`, `k-msg-nav-badge`, `k-chat-polish`, `k-chat-drawer` — full realtime messaging
  (see "Messaging").
- `k-calendar`, `k-calendar-actions`, `k-dashboard`, `k-dash-enhance`, `k-listings`,
  `k-listings-ui`, `k-add-listing-v2`, `k-notifications`, `k-home-render`, `k-home-recent`,
  `k-help`, `k-report`, `k-broker-profile`, `k-profile`, `k-settings-trim` — page features.
- `k-signature`, `k-moa-js` — broker e-signature + per-listing Memorandum of Agreement.
- `k-net-new-ui` / `-css` / `-js` — the tier-lock & onboarding injector (pending-approval /
  paywall pages, accuracy-agreement + upgrade overlays). Still present.
- `k-mobile-js`, `k-fluid-root`, `k-desktop-scale`, `k-phone-ph`, `k-anim` — responsive/polish.

## Frontend Architecture (`index.html`)

### Page / navigation

Pages are `<div class="page">` inside `#app-shell > .main`; only the active one shows.
`goTo(key)` toggles `.active` and syncs the sidebar `<a class="nav-link" data-page="…">`.
The PAGES map lives inside the line-227 bundle. Baked-in keys include: `home, dashboard,
listings, your-listings, bookmarks, listing-detail, messages, broker, calendar, profile,
settings, help, premium, notifications, article`; injected by the net-new-ui module:
`pending-approval`, `paywall`. (Enumerate current keys by grepping `data-page=` and the
`k-net-new-ui-js` PAGES extension rather than trusting this list verbatim.)

### Auth → app shell

`#app-login` shows by default; `doLogin()` / `doSignup()` add `.visible` to `#app-shell` and
call `initCharts()` (Chart.js — `analyticsChart`, `postingChart`, destroyed on re-init).
`doLogout()` reverses it. The net-new-ui injector **wraps** `doLogin` to route to
`pending-approval` (unapproved) or `paywall` (expired) based on the real profile. Auth is
wired to Supabase (not the old mock). DevTools test hooks: `window.__currentUser`,
`__konekIsPremium()`, `__konekRoute()`, `__konekShowPaywall()`, `__konekShowPending()`,
`__konekOpenUpgrade()`.

### Modals / overlays

`showModal(id)` / `closeModal(id)` toggle `.show` on `.overlay` elements. Includes
`overlay-logout`, `overlay-submit-success`, `overlay-add-listing`, `overlay-adv-filter`,
`overlay-new-event`, plus injected `overlay-accuracy-agreement` (RESA Act §29 gate on Add
Listing) and `overlay-upgrade` (Premium upsell).

### Messaging

Full realtime chat on the Supabase `messages` table (Realtime publication in migration 0019).
Shipped sub-features (migrations 0027, 0038–0044): read/delivered receipts, attachments,
reply, soft-delete, reactions, **pin** (`set_message_pin` RPC), **edit within 30 min**
(`edit_message` RPC), **mute** (`conversation_states.is_muted`), **report user**
(`user_reports` table + admin review page), and **global search** (ilike, no FTS). The chat
drawer (`k-chat-drawer`) hosts Shared Media, Pinned Messages, Mute, and Report. Key realtime
detail: `onRealtimeMessageUpdate` merges a fixed `MERGE_FIELDS` set (`read_at, delivered_at,
deleted_at, pinned_at, body, edited_at`) from `payload.new`.

### Calendar

State: `calYr`, `calMo` (0-indexed), `calView` (`month`|`week`), `calWeekOffset`. Renderers:
`renderMiniCal()`, `renderBigCal()`, `renderWeekView()`. Data comes from the
`calendar_events` table via `k-data`, keyed `'YYYY-M-D'` (month not zero-padded).

### CSS conventions

- `:root` tokens: greens (`--gd`, `--gm`, `--gl`, `--ga`), text (`--td`, `--tm`, `--ts`,
  `--tl`), borders (`--br`), shadows (`--sh`/`--sh2`/`--sh3`).
- Glassmorphism: `rgba(255,255,255,.5–.65)` + `backdrop-filter: blur(20px) saturate(180%)` +
  `1px solid rgba(255,255,255,.7–.9)`.
- Collapsible sidebar 68px → `var(--sw)` (230px) on `:hover`, pure CSS.

## Backend (Supabase) — largely BUILT

Treat `BACKEND_PLAN.md` as the original design spec, but **its status markers are stale** —
much of what it lists as TODO is shipped. Ground truth is the migrations and the live DB.

- **Migrations: `0001` … `0044`** in `supabase/migrations/`. Beyond the initial schema/PSGC
  seed they cover messaging + billing, deals, home content, RLS hardening, listing
  views/reports, MOA e-signature, support tickets, presence, message
  attachments/reply/reactions/pin/edit, mute, user reports, and the marketing surface.
- **Storage buckets (6)**: `id-documents` (private), `avatars`, `listing-images`,
  `article-images`, `message-attachments`, `marketing-images`.
- **Edge Functions (5 deployed)** in `supabase/functions/`: `notify-broker`, `moa`,
  `submit-lead`, `create-marketing-user`, `reset-marketing-password`. (PayMongo billing
  functions are not among them yet.)
- Roles: brokers self-signup (PRC ID + 1×1 photo → private `id-documents`), `is_approved=false`
  → admin approves → trial → quarterly PayMongo charge (**price TBD**). Two tiers, Regular and
  Premium; monthly listing quota refreshes independent of billing. **Open product decision:**
  whether chat is free for all tiers or Premium-only (blocks the Referrals feature; note
  migration `0014_relax_chat_premium_gate` already relaxed the gate once).
- RLS is the real security boundary. **Standard for "done" on any DB change is a role-switch
  RLS proof**, not just a passing query.

### Live DB access

Run SQL on the live project via the Supabase Management API using a CLI token stored in
Windows Credential Manager (`Supabase CLI:supabase`). A `runsql.ps1` helper lives in the
session scratchpad. **One statement per call** — it rejects multi-statement / begin / commit.
Never echo the token.

## Admin app (`admin-src/`, built → `admin/`)

Vite + React 18 + TS + React Router + Supabase. **10 pages**: `Login`, `BrokerApprovals`,
`ListingApprovals`, `ManageListings`, `Reports`, `AdminArticles`, `AdminPromotions`,
`AdminUsers`, `SupportTickets`, `UserReports`. Routes + lazy chunks in `App.tsx`; the guard
resolves the session, checks the admin role, and redirects anon users to Login. `admin/`
(built bundle) is gitignored; `admin-src/` is the source of truth.

## Working in this repo

- Prefer surgical, anchor-based edits to `index.html`. Never Read the bundle lines whole;
  Grep literal substrings, Edit with unique surrounding context, then run
  `node scripts/check-bundle.cjs index.html`.
- Do **not** add a build step / framework / package manager to the broker frontend.
- The admin app and `marketing-src/` are normal Vite/React/TS projects — standard `npm` there.
- Verify browser-rendered changes for real (CDP-driven headless Chrome); "the Edit returned
  ok" is not verification for auth/routing/RLS/realtime behavior.
- Keep `konek`-named identifiers/paths as-is despite the ProList rebrand.
