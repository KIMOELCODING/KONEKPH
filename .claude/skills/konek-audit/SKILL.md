---
name: konek-audit
description: Run a feature-state audit of Konek.PH (broker frontend + admin app + Supabase backend). Use when the user says "audit", "what's working", "what's broken", "checklist", "status of the app", or asks for a punch-list of bugs/optimizations. Returns a markdown checklist of Working / Not wired / Bugs / Optimizations against a known baseline.
---

# Konek.PH feature audit

Produce an up-to-date checklist of what works, what's stubbed, what's buggy, and what could be optimized. The baseline below was last refreshed **2026-05-29**; verify each item against current code before reporting, and update the baseline in this file when fixes land.

## Procedure

1. **Verify the baseline in parallel** — for each "Working" claim, run a targeted Grep to confirm the relevant call/wire-up still exists. For each "Not wired" claim, confirm the absence. Don't trust the baseline blindly — code may have moved.

2. **Scan for new issues** the baseline doesn't list:
   - `Grep` for `TODO|FIXME|XXX|HACK|alert\(|prompt\(` in [Draft 28.html](../../../Draft%2028.html) and [admin-src/src/](../../../admin-src/src/) — surface anything not already in the checklist
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

## Current baseline (2026-05-29)

### Working
**Broker frontend ([Draft 28.html](../../../Draft%2028.html))**
- Supabase auth (signup/login) + `notify-broker` invoked on new_signup/reapply
- **Signup form complete** — PRC license # (`su-license`), 1×1 photo + PRC ID upload to `id-documents` (5 MB cap), ToS checkbox enforced ([line 363](../../../Draft%2028.html#L363)), **+ OTP email verification** (`__konekVerifyOtp`)
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
- 0012 tighten admin notif SELECT, 0013 enforce ToS (BEFORE INSERT), 0014 relax chat premium gate + `notify_message_recipient` trigger
- `notify-broker` Edge Function (admin fan-out, Gmail SMTP)

### Not wired
- PayMongo billing — placeholder `alert` at [Draft 28.html:1667](../../../Draft%2028.html#L1667); no `paymongo-create-source` Edge Function
- Trial/subscription enforcement relaxed in [0011_relax_listing_gate.sql](../../../supabase/migrations/0011_relax_listing_gate.sql) (intentional deferral)
- Premium page copy still shows ₱999/Enterprise (~3 hits)
- Broker-profile "Message" button (chat plumbing exists, no UI entry point)
- Chat photo attachments (schema has `attachment_image_url`; no `message-attachments` bucket/uploader)
- AdminUsers page never created
- Broker matching by service area (schema only)
- Referrals UI (schema only)
- Audit-log surfacing

### Bugs / risks
1. `select('*')` in [AdminArticles.tsx:45](../../../admin-src/src/pages/AdminArticles.tsx#L45) + [AdminPromotions.tsx:58](../../../admin-src/src/pages/AdminPromotions.tsx#L58) — wide selects (BrokerApprovals/ListingApprovals already narrowed)
2. ~15 `alert()` calls in broker frontend — poor UX, blocks E2E
3. Messages search input binds to vanished mock data — no-op
4. **🔑 Exposed Resend API key `re_RJw3tY6P_...`** still live — delete at resend.com/api-keys (standing reminder)
5. `notify-broker` SMTP has no retry queue; Gmail rotation breaks approvals silently
6. PSGC override polling (500ms × 20) in `k-psgc-db` — defensive but smelly; delete once stable
7. `is_admin()` policies not re-verified after 0012–0014 additions

### Optimizations remaining
- Lazy-load / move line-174 base64 assets (4.8 MB) to Storage URLs (biggest TTI win on 5.3 MB HTML)
- Listings keyset pagination + infinite scroll (still flat-limited)
- Supabase image transforms for grid + carousel thumbnails (download at thumb size)
- Verify service-worker registration (PWA install)

### Done this session (2026-05-29)
- Listing-detail carousel wired to real listing photos (was hardcoded Unsplash thumbnails)
- Featured listings hero slideshow wired to real listings (was 5 mock slides)
- Verified: signup form complete (PRC/photo/PRC ID/ToS/OTP), migration prefix collisions resolved (0010/0011), admin RejectModal replaces prompt(), messages index present, calYr dynamic

## Notes for the runner

- Mark items "done" by moving them to a "Done this session" sub-section AND striking them in their original section, so the diff against the baseline is obvious.
- When a `Not wired` item ships, remove it from `Not wired` and add to the relevant `Working` section.
- Don't grow the baseline forever — once a fixed bug has been gone for two audits, drop the entry entirely.
