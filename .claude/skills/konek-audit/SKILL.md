---
name: konek-audit
description: Run a feature-state audit of Konek.PH (broker frontend + admin app + Supabase backend). Use when the user says "audit", "what's working", "what's broken", "checklist", "status of the app", or asks for a punch-list of bugs/optimizations. Returns a markdown checklist of Working / Not wired / Bugs / Optimizations against a known baseline.
---

# Konek.PH feature audit

Produce an up-to-date checklist of what works, what's stubbed, what's buggy, and what could be optimized. The baseline below was last refreshed **2026-05-31**; verify each item against current code before reporting, and update the baseline in this file when fixes land.

## Procedure

1. **Verify the baseline in parallel** — for each "Working" claim, run a targeted Grep to confirm the relevant call/wire-up still exists. For each "Not wired" claim, confirm the absence. Don't trust the baseline blindly — code may have moved.

2. **Scan for new issues** the baseline doesn't list:
   - `Grep` for `TODO|FIXME|XXX|HACK|alert\(|prompt\(` in [index.html](../../../index.html) and [admin-src/src/](../../../admin-src/src/) — surface anything not already in the checklist
   - `Glob supabase/migrations/*.sql` — flag any duplicate numeric prefixes
   - `Grep` for `select\('\*'\)` in admin pages — flag wide selects
   - Check that `var calYr` in the minified blob uses `new Date()`, not a hardcoded year

3. **Report** in the exact structure below. Use markdown checkboxes. Link file references with `[name](path)` or `[name:line](path#Lline)` per the repo's VSCode-extension convention.

4. **Update the baseline** in this file (under `## Current baseline`) when items move between sections — e.g., when a "Not wired" item ships, strike it through in this doc so future runs know.

## Report structure

```markdown
# Konek.PH — Feature Audit (YYYY-MM-DD)

## Working features
### Broker frontend
- [x] ...
### Admin app
- [x] ...
### Backend
- [x] ...

## Not working / not yet wired
- [ ] ...

## Bugs / risks
1. ...

## Optimizations
- ...

## Suggested next-up
1. ...
```

## Current baseline (2026-05-31)

### Working
**Broker frontend ([index.html](../../../index.html))**
- **Edit-listing prefill correct** — location cascade via case-insensitive `setSelByName`; negative spec values blocked (`min=0`), dropped on save, hidden on render
- **Per-type spec details via `listings.details` JSONB** (0015) — Add Listing extra fields persisted + rendered on detail page
- Supabase auth (signup/login) + `notify-broker` invoked on new_signup/reapply
- **Signup form complete** — PRC license # (`su-license`), 1×1 photo + PRC ID upload to `id-documents` (5 MB cap), ToS checkbox enforced ([line 363](../../../index.html#L363)), **+ OTP email verification** (`__konekVerifyOtp`)
- Pending-approval / paywall routing + tier-lock decorators (§7.3 injector)
- **Realtime chat** — `sb.channel`, `__konekStartChat({brokerId,listingId})`, optimistic send, mark-read, listing-card attachments
- **In-app notifications** — broker bell + realtime; home/dashboard badge sync
- Listings feed + Storage public URLs; bookmarks via `saved_listings`
- **Listing-detail carousel rebuilt from real photos** (`populateDetail` → `#ldsh-main-img` + `.ld-sh-thumbs`)
- **Featured hero slideshow rebuilt from real listings** (`renderFeaturedSlideshow` in `renderListings`; prefers `featured`, falls back to recent-with-image, hides if none)
- Listing image upload validation (5 MB + JPEG/PNG/WebP)
- Calendar CRUD; calendar "today" dynamic (`var calYr = new Date().getFullYear()...`)
- Home content: `articles` + `promoted_slides` + trending; deals counters
- Dashboard real MoM trend pills + recent-listings filter chips
- Listing view-counter (`bump_view_count` RPC)
- PSGC cascade dropdowns + localStorage cache (`konek.psgc.v1.*`)
- Listing Accuracy Agreement + Upgrade modal
- `__konekLoadData` HOT (30s) / WARM (5min) TTL split

**Admin app ([admin-src/](../../../admin-src/))**
- Login + resilient auth (timeout fallbacks)
- BrokerApprovals + doc viewer + email notify
- ListingApprovals + detail modal + reject reason
- **RejectModal component replaces `prompt()`** in both approval pages
- AdminArticles, AdminPromotions
- **Routes lazy-loaded** (React.lazy + Suspense)
- Production build strips `console.*` and `debugger` (Vite esbuild drop)

**Backend (`supabase/`)**
- 0001 base schema + RLS (profiles/listings/notifications/PSGC + 5 triggers)
- 0003 messaging/billing schema + indexes (incl. `messages(conversation_id, created_at desc)` ✅) + premium-gate triggers
- 0005 deals, 0006 bump_view_count, 0007 psgc_barangays, 0008 clean seed, 0009 listings delete-own, 0010 home content, 0011 relax listing gate
- 0012 tighten admin notif SELECT, 0013 enforce ToS (BEFORE INSERT), 0014 relax chat premium gate + `notify_message_recipient` trigger, **0015 `listings.details` JSONB** (per-property-type specs)
- `notify-broker` Edge Function (admin fan-out, Gmail SMTP)

**Admin app — AdminUsers page now shipped** ([AdminUsers.tsx](../../../admin-src/src/pages/AdminUsers.tsx), routed in App.tsx); `prompt()` fully gone; `select('*')` only remains as a by-id profile fetch in [App.tsx:51](../../../admin-src/src/App.tsx#L51) (single row, OK)

### Not wired
- PayMongo billing — placeholder `alert` at [index.html:1667](../../../index.html#L1667); no `paymongo-create-source` Edge Function
- Trial/subscription enforcement relaxed in [0011_relax_listing_gate.sql](../../../supabase/migrations/0011_relax_listing_gate.sql) (intentional deferral)
- Premium page copy still shows ₱999/Enterprise (~3 hits)
- Broker-profile "Message" button (chat plumbing exists, no UI entry point)
- ~~Chat photo attachments~~ — **DESCOPED 2026-05-31** (will not build; do not re-flag)
- ~~AdminUsers page~~ — **SHIPPED 2026-05-31**
- Broker matching by service area (schema only)
- Referrals UI (schema only)
- Audit-log surfacing

### Bugs / risks
1. PSGC override polling (~500ms loop) in `k-psgc-db` (~line 6291) — defensive against a load-order race that would break location dropdowns; **leave until post-launch stability is confirmed** (removing it has no user-facing upside).
   *(Verified 2026-05-31: prior "bug" entries cleared — `alert()` popups replaced by toast helper (only a DOM-not-ready fallback `alert` remains, ~line 253); Messages search now filters real `.kmsg-item` rows via `filterConvList`/`wireConvSearch` (~lines 6156/6170), mock `chat-suggest` dropdown suppressed; `notify-broker` `sendEmail` has 2-attempt retry + returns 502 on failure + writes the in-app admin notification before sending so failures aren't silent — a durable queue is intentionally out of scope at this scale.)*

### Optimizations remaining
- Lazy-load / move line-174 base64 assets (4.8 MB) to Storage URLs (biggest TTI win on 5.3 MB HTML)
- Listings keyset pagination + infinite scroll (still flat-limited)
- Supabase image transforms for grid + carousel thumbnails (download at thumb size)
- Verify service-worker registration (PWA install)

### Done this session (2026-05-31)
- AdminUsers page shipped; admin `prompt()` and wide `select('*')` (AdminArticles/AdminPromotions) removed
- Migration 0015 `listings.details` JSONB applied — per-property-type spec fields now persisted + rendered
- Edit-listing fixes: case-insensitive PSGC prefill (`setSelByName`); negatives blocked (`min=0`) + dropped on save + hidden on render
- **Security pass (Tier 2):**
  - 0018 — per-bucket `file_size_limit` + `allowed_mime_types` allow-lists (id-documents 5 MB img+pdf, avatars 2 MB img, listing/article-images 5 MB img); server-side enforcement so raw anon-key uploads can't bypass the client check
  - Password hardening (dashboard Auth, user-applied): min length 6→8, password complexity requirement (recommended preset), "require current password when updating" ON, "secure password change" ON
  - ⏳ DEFERRED to Pro: "Prevent use of leaked passwords" (HaveIBeenPwned) is Pro-plan-gated — enable on upgrade
- **Security pass (Tier 1):**
  - 0016 — privilege-escalation guard (non-admins can't self-set role/is_approved/subscription/quota) + listing featured/approval guard + `broker_directory` safe view
  - 0017 — dropped `profiles_select_brokers`; peers now read other brokers only via `broker_directory` (no phone/billing/ID-doc paths). Frontend repointed: listing-detail contact (~3785) + chat conversation loader (~5677)
  - XSS: escaped `loc` on detail page (~3583) + avatar `src` in conv list (~5750); verified chat body / buildCard / detail use textContent
  - Verified clean: no service-role key in client; `is_admin()` intact after 0012–0017
  - Resend key `re_RJw3tY6P_...` deleted by user
- Verified still-true: calYr dynamic, signup form complete, no duplicate migration prefixes

### Done prior session (2026-05-29)
- Listing-detail carousel wired to real listing photos (was hardcoded Unsplash thumbnails)
- Featured listings hero slideshow wired to real listings (was 5 mock slides)

## Notes for the runner

- Mark items "done" by moving them to a "Done this session" sub-section AND striking them in their original section, so the diff against the baseline is obvious.
- When a `Not wired` item ships, remove it from `Not wired` and add to the relevant `Working` section.
- Don't grow the baseline forever — once a fixed bug has been gone for two audits, drop the entry entirely.
