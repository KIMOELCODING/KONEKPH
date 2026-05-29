---
name: konek-audit
description: Run a feature-state audit of Konek.PH (broker frontend + admin app + Supabase backend). Use when the user says "audit", "what's working", "what's broken", "checklist", "status of the app", or asks for a punch-list of bugs/optimizations. Returns a markdown checklist of Working / Not wired / Bugs / Optimizations against a known baseline.
---

# Konek.PH feature audit

Produce an up-to-date checklist of what works, what's stubbed, what's buggy, and what could be optimized. The baseline below was last refreshed **2026-05-28**; verify each item against current code before reporting, and update the baseline in this file when fixes land.

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

## Current baseline (2026-05-28)

### Working
**Broker frontend ([Draft 28.html](../../../Draft%2028.html))**
- Supabase auth (signup/login) + `notify-broker` invoked on new_signup/reapply
- Pending-approval / paywall routing + tier-lock decorators (§7.3 injector)
- Listings feed + Storage public URLs (24× `sb.from('listings')`)
- Bookmarks via `saved_listings`
- Calendar CRUD via `calendar_events`
- Home content: `articles` + `promoted_slides` + trending
- Deals counters
- Listing view-counter (`bump_view_count` RPC)
- PSGC dropdowns DB-driven (cascade region→province→city→barangay)
- **PSGC dropdowns cached in localStorage** under `konek.psgc.v1.*` keys
- Listing Accuracy Agreement + Upgrade modal
- Calendar "today" is dynamic (`var calYr = new Date().getFullYear()...`)
- `__konekLoadData` has 30s TTL memoization; mutation callers pass `{force:true}`

**Admin app ([admin-src/](../../../admin-src/))**
- Login + resilient auth (timeout fallbacks)
- BrokerApprovals + doc viewer + email notify
- ListingApprovals + detail modal + reject reason
- AdminArticles, AdminPromotions
- Production build strips `console.*` and `debugger` (Vite esbuild drop)
- Admin selects narrowed to explicit column lists

**Backend (`supabase/`)**
- 0001 base schema + RLS (profiles/listings/notifications/PSGC + 5 triggers)
- 0003 messaging/billing schema + premium-gate triggers
- 0003 home content (articles policies + promoted_slides)
- 0005 deals, 0006 bump_view_count, 0006 relax_listing_gate
- 0007 psgc_barangays + 0008 clean seed
- `notify-broker` Edge Function (6 actions, Gmail SMTP)

### Not wired
- Realtime chat UI (`sb.channel(` absent in broker HTML; schema + RLS exist)
- PayMongo billing — placeholder `alert('PayMongo integration pending …')` at [Draft 28.html](../../../Draft%2028.html); no `paymongo-create-source` Edge Function
- Trial/subscription enforcement relaxed in [0006_relax_listing_gate.sql](../../../supabase/migrations/0006_relax_listing_gate.sql)
- Premium page copy still shows ₱999/Enterprise (~15 hits)
- Signup form missing PRC #, 1×1 photo, PRC ID upload, ToS checkbox
- AdminUsers page never created
- Broker matching by service area (schema only)
- Referrals UI (schema only)
- Audit-log surfacing

### Bugs / risks
1. **Duplicate migration prefixes** — `0003_home_content` vs `0003_messaging_billing`; `0006_bump_view_count` vs `0006_relax_listing_gate`. Order-fragile on fresh DB rebuild
2. `prompt()` for rejection reasons in [BrokerApprovals.tsx:68](../../../admin-src/src/pages/BrokerApprovals.tsx#L68) and [ListingApprovals.tsx:75](../../../admin-src/src/pages/ListingApprovals.tsx#L75) — bad mobile UX, blocks E2E
3. PSGC override polling (500ms × 20) in `k-psgc-db` — defensive but smelly; delete once stable
4. `notify-broker` SMTP has no retry queue; Gmail rotation breaks approvals silently
5. `is_admin()` policies not re-verified after 0003 additions
6. `enforce_premium_for_chat` only server-side; Regular-tier UI doesn't block composer input

### Optimizations remaining
- Bundle / gzip-precompress 5.3MB HTML; lazy-load line-174 base64 assets (biggest TTI win)
- Replace base64 assets with Storage URLs
- Listings keyset pagination + infinite scroll
- Verify `messages(conversation_id, created_at)` index for realtime tail
- Verify service-worker registration (PWA install)

### Done this session (2026-05-28)
- Calendar unhardcoded (`var calYr = new Date().getFullYear()...`)
- PSGC localStorage cache (`konek.psgc.v1.*` keys; `__konekPsgcClear()` to invalidate)
- 30s memoization on `__konekLoadData` with `{force:true}` opt for mutation callers
- Admin `select('*')` narrowed to explicit column lists
- Vite prod build drops `console.*` and `debugger`

## Notes for the runner

- Mark items "done" by moving them to a "Done this session" sub-section AND striking them in their original section, so the diff against the baseline is obvious.
- When a `Not wired` item ships, remove it from `Not wired` and add to the relevant `Working` section.
- Don't grow the baseline forever — once a fixed bug has been gone for two audits, drop the entry entirely.
