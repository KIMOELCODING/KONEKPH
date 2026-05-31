# Plan: Konek.ph — Full Backend Design (Supabase + Cloudflare)

## Context

Konek.ph's frontend is now `C:\Users\Predator\Konek-PH\index.html` (5.3 MB, 185 lines — the bulk of the app is minified onto two lines: line 174 ≈ 4.8 MB of base64 assets, line 182 ≈ 505 KB of HTML/CSS/JS). The previous draft, `Draft 19.html`, is retained alongside as an archive. Demo login (`admin@konek.ph` / `admin123`) is still a pure client-side mock.

We're designing the production backend so brokers can sign up, get verified by an admin, trial for 3 days, pay quarterly via PayMongo, post listings (admin-approved), chat in realtime (Premium only), match with other brokers by service area, and consume admin-curated news.

**Why now:** the frontend is stable enough to wire to real data, the broker-facing §7.3 screens (Pending Approval, Paywall, Listing Accuracy Agreement modal, Upgrade modal, tier locks) are now present in `index.html`, and the admin React app under `admin/` already covers broker + listing approvals. The remaining backend work is well-defined.

**Confirmed decisions:**
- Stack: **Supabase** (Postgres + Auth + Storage + Realtime + Edge Functions) behind **Cloudflare** (DNS proxy, CDN, DDoS).
- Roles for signup: **broker only**. Admin is seeded manually.
- Scope: **full backend, all entities**, including matching schema + API.
- Realtime chat: **Supabase Realtime** subscriptions on `messages` table.
- Billing: **quarterly recurring** (~90 days). **Price is TBD** — to be finalized after expense/margin analysis. Use `₱TBD` placeholder in seed data and replace once decided.
- **Listing quota refreshes monthly** for both tiers (independent of billing cycle). Quota = max *new* listings created per calendar month. Hitting the cap blocks new submissions until the 1st of next month; existing listings continue to live. Exact monthly numbers per tier are also TBD — see §1.1 `monthly_listing_quota` column.
- Listing quota overflow: **hard block + upgrade modal** (Regular only — Premium upgrade pitch); Premium overflow shows "wait until next month" message.
- Regular-tier chat/matching/call: **shown but locked**, click triggers upgrade modal.
- News/Announcements/Memoranda: **admin-only authored**.
- Email: **SMTP** (Gmail App Password) via Edge Function. *(Was Resend; switched back to SMTP 2026-05-29 after the Resend key was rotated out. Secrets: `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM_NAME`/`SMTP_FROM_EMAIL`/`SMTP_HOST`/`SMTP_PORT`.)*

**Draft 28 reality check (2026-05-13):**
- The Premium page in Draft 28 still advertises **Basic (Free) / Premium ₱999/month / Enterprise (custom)** — copy carried over from earlier drafts. **This is stale UI** — it must be rewritten to Regular vs Premium quarterly + monthly quota + price TBD when wiring begins. (Anchor: search line 182 for `Enterprise` or `₱999/month`.)
- The signup form still collects only `firstName, lastName, email, phone, password, password2` (anchors `su-fname`, `su-lname`, `su-email`, `su-phone`, `su-pw`, `su-pw2`). **Missing**: PRC license number, 1×1 photo upload, PRC ID scan upload, scrolled-to-bottom ToS checkbox. Must be added before signup can write to Supabase. The schema's `id_photo_url`, `prc_id_url`, `tos_accepted_at` columns are temporarily **nullable** in 0001 so signups don't fail; tighten to `not null` once the form is extended.
- The duplicate `id="page-listing-detail"` bug from Draft 19 is **fixed** in Draft 28.
- `goTo('contacts')` no longer appears in Draft 28 — the chat → broker-profile transition uses `goTo('broker')` correctly.
- Calendar "today" is still hardcoded to 2026-05-06 (events keyed `'2026-4-15'…'2026-5-22'`). Replace with `new Date()` when wiring to `calendar_events`.
- `index.html` PAGES set (15 keys): `home, dashboard, listings, your-listings, bookmarks, listing-detail, messages, broker, calendar, profile, settings, help, premium, notifications, article`. Plus two added by the §7.3 injector at the bottom of the file: `pending-approval`, `paywall`.
- §7.3 broker-facing UI (Pending Approval, Paywall, Listing Accuracy Agreement modal, Upgrade modal, tier-lock icons on Messages + Call) is **present** in Draft 28 — see the `<style id="k-net-new-ui">` and `<script id="k-net-new-ui-js">` blocks appended at the end of `<body>`. Currently gated by a `window.__currentUser` placeholder until real auth lands.

---

## 0. Implementation status (2026-05-13)

| Area | File(s) | Status | Notes |
|---|---|---|---|
| Schema — base | `supabase/migrations/0001_initial_schema.sql` (282 lines) | PARTIAL | Has `psgc_regions/provinces/cities`, `property_types`, `profiles`, `listings`, `notifications`, triggers `set_updated_at`, `handle_new_user`, `enforce_listing_insert`, `reset_listing_on_edit`, `apply_tier_quota_default`, helper `is_admin`, and RLS for profiles/listings/notifications. **Missing**: `psgc_barangays`, `saved_listings`, `conversations`, `messages`, `calendar_events`, `articles`, `payments`, `referrals`, `audit_log`, `conversation_states`, plus triggers `update_conversation_preview`, `enforce_premium_for_chat`, `upsert_conversation_state`. |
| Schema — PSGC + property-type seed | `supabase/migrations/0002_seed_psgc.sql` (72 lines) | PARTIAL | Seeds 4 regions / 8 provinces / 19 cities / 25 property-type rows — the curated subset Draft 28's `PSGC` constant exposes. Barangays are **not** seeded (no `psgc_barangays` table yet). Expand for production. |
| Storage buckets | `supabase/storage_buckets.sql` (76 lines) | PARTIAL | Has `id-documents` (private), `avatars` (public), `listing-images` (public) with owner/admin policies. **Missing**: `article-images`, `message-attachments`. |
| Edge Functions | `supabase/functions/` | TODO | Folder doesn't exist. All 7 functions still to write. |
| Admin Portal (React) | `admin/` (built bundle) + `admin-src/` (source) | PARTIAL | Vite + React 18 + TS + React Router + Supabase JS. Pages: `Login`, `BrokerApprovals`, `ListingApprovals`. **Missing**: `AdminArticles`, `AdminUsers`. |
| Broker frontend (active) | `index.html` | PARTIAL | §7.3 net-new UI present (Pending Approval, Paywall, Accuracy modal, Upgrade modal, tier locks). Supabase not wired. Premium-page copy stale. Signup form missing PRC/photo/ToS. |
| Broker frontend (archive) | `Draft 19.html` | Archived | Keep for reference; do not edit. |
| Frontend config | `config.js` | DONE | Gitignored. Points to live Supabase project. |
| PWA shell | `manifest.webmanifest`, `service-worker.js`, `icons/` | DONE | Not part of backend plan. |

---

## 1. Database Schema (PostgreSQL via Supabase)

All tables live in the `public` schema. Every table has `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` (trigger-maintained) unless noted.

### 1.1 `profiles` (extends `auth.users`) — **Status: PARTIAL (DONE)**
One row per Supabase auth user. Created via trigger on `auth.users` insert. Implemented in `0001_initial_schema.sql`, with three deviations from the spec below: `id_photo_url`, `prc_id_url`, `tos_accepted_at` are currently **nullable** (will tighten to `not null` once signup form collects them), and an `email text` column was added (handy for support lookups without joining `auth.users`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, FK→`auth.users.id` | |
| `first_name` | `text not null` | |
| `last_name` | `text not null` | |
| `email` | `text` | mirror of `auth.users.email` for convenience |
| `phone` | `text` | |
| `avatar_url` | `text` | Supabase Storage public URL |
| `title` | `text default 'Certified Broker'` | |
| `agency` | `text` | |
| `license_number` | `text` | PRC license # |
| `bio` | `text` | |
| `id_photo_url` | `text` *(TODO: `not null` once signup form sends it)* | private bucket path — 1x1 white bg |
| `prc_id_url` | `text` *(TODO: `not null` once signup form sends it)* | private bucket path |
| `tos_accepted_at` | `timestamptz` *(TODO: `not null` once signup form sends it)* | |
| `is_approved` | `boolean not null default false` | admin sets true |
| `approved_at` | `timestamptz` | |
| `approved_by` | `uuid` FK→`profiles.id` | |
| `role` | `text not null default 'broker'` | check in ('broker','admin') |
| `trial_started_at` | `timestamptz` | set on first login after approval |
| `trial_ends_at` | `timestamptz` | trial_started_at + 3 days |
| `subscription_status` | `text not null default 'pending_approval'` | check in ('pending_approval','trial','paid','expired') |
| `subscription_tier` | `text not null default 'regular'` | check in ('regular','premium') |
| `subscription_started_at` | `timestamptz` | |
| `subscription_ends_at` | `timestamptz` | +90 days on each successful charge |
| `monthly_listing_quota` | `int not null default 10` | per-broker override of the tier default; admin can bump for a specific user. Tier defaults seeded via trigger: regular → 10, premium → 15 (numbers TBD). |
| `service_areas` | `jsonb default '[]'` | array of `{region, province, city}` — used by matching |
| `specialties` | `text[] default '{}'` | e.g., `{'Residential','Commercial'}` |
| `closed_deals_count` | `int default 0` | denormalized counter |

### 1.2 `listings` — **Status: DONE**
Implemented in `0001_initial_schema.sql` matching the spec below.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `broker_id` | `uuid` FK→`profiles.id` not null | |
| `title` | `text not null` | |
| `category` | `text not null` | Residential / Commercial / Industrial / Agricultural / Leisure / Lot |
| `property_type` | `text` | from PROP_TYPES lookup (currently nullable in SQL — make `not null` if/when category-driven validation tightens) |
| `price` | `numeric(14,2) not null` | PHP |
| `region` | `text not null` | |
| `province` | `text not null` | |
| `city` | `text not null` | |
| `barangay` | `text` | |
| `street_address` | `text` | |
| `lot_area_sqm` | `numeric(10,2)` | |
| `floor_area_sqm` | `numeric(10,2)` | |
| `bedrooms` | `int` | |
| `bathrooms` | `int` | |
| `amenities` | `text[] default '{}'` | |
| `description` | `text` | |
| `images` | `text[] default '{}'` | Supabase Storage URLs |
| `status` | `text not null default 'pending'` | check in ('pending','active','archive','rejected') |
| `featured` | `boolean default false` | admin-toggled |
| `accuracy_agreement_accepted_at` | `timestamptz not null` | timestamp of Listing Accuracy Agreement modal |
| `approved_by` | `uuid` FK→`profiles.id` | admin who approved |
| `approved_at` | `timestamptz` | |
| `rejection_reason` | `text` | |
| `view_count` | `int default 0` | |

Indexes (all in 0001): `(broker_id, status)`, `(status, created_at desc)`, `(region, city)`, `(category)`, `(broker_id, created_at desc)` — used by the monthly-quota trigger to count this calendar month's posts.

**Monthly quota note:** the cap is on *listings created within the current calendar month*, NOT on simultaneously-active listings. A broker who posts 10 listings in May cannot post an 11th until June 1, regardless of how many got archived/rejected in May. Existing active listings from previous months are NOT counted toward the current month's quota.

**Lot category note:** when `category='Lot'`, `bedrooms`/`bathrooms`/`amenities` must allow nulls (the Add Listing modal in Draft 28 hides those fields when category=Lot). The validation trigger must not require them for Lot.

### 1.3 `saved_listings` (bookmarks) — **Status: TODO**
| Column | Type |
|---|---|
| `user_id` | `uuid` FK→`profiles.id` |
| `listing_id` | `uuid` FK→`listings.id` |
| `created_at` | `timestamptz` |

PK: `(user_id, listing_id)`.

### 1.4 `conversations` — **Status: TODO**
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `participant_a` | `uuid` FK→`profiles.id` | always smaller UUID |
| `participant_b` | `uuid` FK→`profiles.id` | always larger UUID |
| `last_message_at` | `timestamptz` | sort key for chat list |
| `last_message_preview` | `text` | denormalized |

Unique constraint on `(participant_a, participant_b)`.

### 1.5 `messages` — **Status: TODO**
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `conversation_id` | `uuid` FK→`conversations.id` not null | |
| `sender_id` | `uuid` FK→`profiles.id` not null | |
| `body` | `text` | |
| `attachment_listing_id` | `uuid` FK→`listings.id` | for property-card attachments |
| `attachment_image_url` | `text` | |
| `read_at` | `timestamptz` | null = unread |

Realtime: enable on this table for Supabase Realtime subscriptions, filtered by `conversation_id`.

### 1.6 `calendar_events` — **Status: TODO**
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK→`profiles.id` not null | |
| `title` | `text not null` | |
| `event_date` | `date not null` | |
| `event_time` | `time` | |
| `category` | `text` | Work / Personal / Urgent / Other |
| `priority` | `text default 'normal'` | low/normal/high/urgent |
| `description` | `text` | |
| `notes` | `text` | |

Index: `(user_id, event_date)`.

### 1.7 `articles` — **Status: TODO**
Admin-authored news/announcements/memoranda. Backs Draft 28's `HOME_ARTICLES` mock constant and the `article` detail page.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `author_id` | `uuid` FK→`profiles.id` not null | must be role=admin |
| `type` | `text not null` | check in ('news','announcement','memorandum') |
| `title` | `text not null` | |
| `body` | `text not null` | rich-text/HTML |
| `image_url` | `text` | |
| `category` | `text` | |
| `read_time_minutes` | `int` | |
| `published_at` | `timestamptz` | null = draft |
| `view_count` | `int default 0` | |

### 1.8 `notifications` — **Status: DONE**
Implemented in `0001_initial_schema.sql`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK→`profiles.id` not null | |
| `type` | `text not null` | listing_approved / listing_rejected / new_message / payment_success / trial_ending / etc. |
| `title` | `text not null` | |
| `body` | `text` | |
| `link` | `text` | deep-link into app |
| `read_at` | `timestamptz` | |

Index: `(user_id, read_at, created_at desc)`.

### 1.9 `payments` — **Status: TODO**
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK→`profiles.id` not null | |
| `paymongo_payment_id` | `text unique not null` | from webhook |
| `amount_centavos` | `int not null` | ₱TBD → set after pricing decision |
| `currency` | `text default 'PHP'` | |
| `method` | `text` | gcash / card |
| `status` | `text not null` | pending / paid / failed / refunded |
| `paid_at` | `timestamptz` | |
| `period_start` | `timestamptz` | |
| `period_end` | `timestamptz` | period_start + 90 days |

### 1.10 `referrals` (matching system) — **Status: TODO**
When Broker A "Connects" with Broker B via matching, log the intent.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `from_broker_id` | `uuid` FK→`profiles.id` not null | |
| `to_broker_id` | `uuid` FK→`profiles.id` not null | |
| `buyer_target_region` | `text` | |
| `buyer_target_province` | `text` | |
| `buyer_target_city` | `text` | |
| `buyer_notes` | `text` | what the buyer wants |
| `status` | `text default 'open'` | open / accepted / declined / closed |
| `conversation_id` | `uuid` FK→`conversations.id` | auto-created chat between the two brokers |

### 1.11 `audit_log` (admin actions) — **Status: TODO**
| Column | Type |
|---|---|
| `id` | `uuid` PK |
| `admin_id` | `uuid` FK→`profiles.id` |
| `action` | `text` (approve_broker / reject_broker / approve_listing / reject_listing / feature_listing / publish_article) |
| `target_type` | `text` |
| `target_id` | `uuid` |
| `metadata` | `jsonb` |

### 1.12 `conversation_states` (per-user chat UI flags) — **Status: TODO**
Draft 28 messages page shows Pinned / Important / Unread filters and a context menu with Pin, Mute, Mark Read, Mark Important, Delete. These flags are **per user, per conversation** — Broker A pinning a chat must not affect Broker B's view.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` FK→`profiles.id` | |
| `conversation_id` | `uuid` FK→`conversations.id` | |
| `is_pinned` | `boolean default false` | |
| `is_muted` | `boolean default false` | |
| `is_important` | `boolean default false` | |
| `archived_at` | `timestamptz` | null = not archived; "Delete Chat" sets this |
| `last_read_at` | `timestamptz` | drives the unread badge — `messages.created_at > last_read_at` AND `sender_id != user_id` |
| `created_at` | `timestamptz default now()` | |
| `updated_at` | `timestamptz` | trigger-maintained |

PK: `(user_id, conversation_id)`. Rows are upserted on first interaction (open conversation, send/receive message). RLS: owner SELECT/UPDATE only.

The frontend's `data-pinned` / `data-important` / `data-unread` attributes (used by `filterChats`) read directly from this table joined to the user's `conversations` list.

### 1.13 Static lookup tables (seed once)
- `psgc_regions`, `psgc_provinces`, `psgc_cities` — **Status: DONE** (`0002_seed_psgc.sql`, curated subset of Draft 28's `PSGC` constant).
- `psgc_barangays` — **Status: TODO** (skipped in 0001 — Draft 28's `PSGC` includes barangay data but the demo currently stores barangay as a free-text column on `listings`. Add the table only if we want validated FK references later).
- `property_types(category text, type text)` — **Status: DONE** (25 rows seeded in `0002_seed_psgc.sql`).

---

## 2. Supabase Storage Buckets

| Bucket | Public | Purpose | Path convention | Status |
|---|---|---|---|---|
| `id-documents` | **private** | 1x1 photo, PRC ID scan | `{user_id}/id_photo.jpg`, `{user_id}/prc_id.jpg` | **DONE** (`supabase/storage_buckets.sql`) |
| `avatars` | public | Profile photos | `{user_id}/avatar.jpg` | **DONE** |
| `listing-images` | public (via Cloudflare CDN) | Property photos | `{listing_id}/{n}.jpg` | **DONE** |
| `article-images` | public | Hero images for news | `{article_id}/hero.jpg` | **TODO** |
| `message-attachments` | private (signed URLs) | Chat image attachments | `{conversation_id}/{message_id}.jpg` | **TODO** |

Cloudflare proxies all public buckets via custom domain (`cdn.konek.ph`) for caching + DDoS shielding.

---

## 3. Auth & Onboarding Flow — **Status: TODO** (schema ready, frontend unwired)

```
Signup form (frontend)
  ├─ Inputs: first_name, last_name, email, phone, password, password2
  ├─ File uploads: id_photo (jpg/png), prc_id (jpg/png)   ← FORM DOES NOT COLLECT YET
  └─ Checkbox: ToS accepted (scrolled-to-bottom required)  ← FORM DOES NOT COLLECT YET
        │
        ▼
1. POST /auth/v1/signup  (Supabase Auth → creates auth.users row)
2. Upload id_photo + prc_id to `id-documents` bucket
3. INSERT into profiles (is_approved=false, subscription_status='pending_approval', tos_accepted_at=now())
4. Redirect to "Pending Approval" screen (page-pending-approval, present in Draft 28)

ADMIN reviews documents in Admin Portal (admin/ React app, BrokerApprovals page — DONE)
  └─ Approves → UPDATE profiles SET is_approved=true, approved_at=now(), approved_by=admin.id
                Edge Function triggered (DB webhook) → SMTP → "Account Ready" email

User logs in for the FIRST time after approval
  └─ Edge Function or login-side hook checks: if is_approved AND trial_started_at IS NULL:
       UPDATE profiles SET trial_started_at=now(), trial_ends_at=now()+'3 days', subscription_status='trial'
  └─ App loads normally with full dashboard

On every page load
  └─ Frontend checks profile.trial_ends_at vs now() AND subscription_status
     - if not approved → goTo('pending-approval')
     - if trial expired AND not 'paid' → goTo('paywall')
     - if 'paid' AND subscription_ends_at < now() → goTo('paywall')
```

---

## 4. Row-Level Security (RLS) Policies

Enable RLS on every table. Key policies:

**`profiles`** — **Status: DONE** (0001 has profiles_select_own, profiles_select_brokers, profiles_select_admin, profiles_insert_self, profiles_update_self, profiles_update_admin)
- SELECT: all authenticated users can read public fields of any approved broker; only owner + admin can read full row (including ID urls, trial dates).
- UPDATE: owner can update name/phone/bio/agency/avatar/service_areas/specialties; admin can update `is_approved`, `subscription_*`, `role`.
- INSERT: only via trigger from `auth.users` (or self-insert during signup completion).

**`listings`** — **Status: DONE** (0001 has listings_select_active, listings_select_own, listings_select_admin, listings_insert_own, listings_update_own, listings_update_admin)
- SELECT: `status='active'` visible to all authenticated brokers; owner sees all their own listings (any status); admin sees all.
- INSERT: only authenticated brokers with `is_approved=true` and `subscription_status IN ('trial','paid')`. **Tier limit enforced via trigger** (see §5).
- UPDATE: owner can edit own listings (resets status to 'pending' on edit); admin can change `status`, `featured`.
- DELETE: owner (sets to 'archive' soft delete) + admin.

**`saved_listings`** — **TODO** — owner-only.

**`conversations` + `messages`** — **TODO**
- SELECT/INSERT: only if `auth.uid() IN (participant_a, participant_b)` AND **both participants are Premium tier** (`subscription_tier='premium'`). Regular tier blocked at DB level — frontend lock is defense-in-depth.

**`calendar_events`** — **TODO** — owner-only.

**`articles`** — **TODO**
- SELECT: all authenticated users (`published_at IS NOT NULL`).
- INSERT/UPDATE/DELETE: only `role='admin'`.

**`notifications`** — **Status: DONE** — owner SELECT/UPDATE (mark read); INSERT via server/Edge Functions only.

**`payments`** — **TODO** — owner SELECT; INSERT/UPDATE only via service-role (Edge Function webhook).

**`referrals`** — **TODO**
- SELECT/INSERT: any Premium broker.
- UPDATE: either participant.

**`audit_log`** — **TODO** — admin SELECT only; INSERT via service-role.

---

## 5. Database Triggers & Functions

1. **`handle_new_user()`** — **Status: DONE** — on `auth.users` INSERT, create `profiles` row.
2. **`enforce_listing_insert()`** — **Status: DONE** (named `enforce_listing_insert` in 0001, called "enforce_listing_limit" in earlier drafts of this plan — single function, same behavior) — BEFORE INSERT on `listings`, count listings created by this broker within the **current calendar month** (`created_at >= date_trunc('month', now())`), reject if count ≥ `profiles.monthly_listing_quota`. Existing listings from previous months are NOT counted. Raises with PG error code → frontend shows: upgrade modal (Regular tier) or "wait until next month" message (Premium tier already at cap).
3. **`reset_listing_on_edit()`** — **Status: DONE** — BEFORE UPDATE on `listings` (if non-admin), force `status='pending'`, clear `approved_at`.
4. **`update_conversation_preview()`** — **Status: TODO** — AFTER INSERT on `messages`, update parent conversation's `last_message_at` + `last_message_preview`.
5. **`set_updated_at()`** — **Status: DONE** — generic trigger for all tables with `updated_at`.
6. **`enforce_premium_for_chat()`** — **Status: TODO** — BEFORE INSERT on `conversations` and `messages`, verify both participants have `subscription_tier='premium'`.
7. **`apply_tier_quota_default()`** — **Status: DONE** — BEFORE INSERT/UPDATE on `profiles` when `subscription_tier` changes, set `monthly_listing_quota` to the tier default (regular=10, premium=15, TBD).
8. **`upsert_conversation_state()`** — **Status: TODO** — AFTER INSERT on `messages`, upsert a `conversation_states` row for the recipient with the conversation_id (so unread counts work) and refresh the sender's `last_read_at` to `now()`.

Helper function: **`is_admin()`** — **Status: DONE** — used by storage policies and RLS to test `auth.uid()`'s role.

---

## 6. Supabase Edge Functions (Deno/TypeScript) — **Status: TODO (all)**

Folder `supabase/functions/` does not exist yet. All seven functions below are to be created.

| Function | Trigger | Purpose |
|---|---|---|
| `send-account-ready-email` | DB webhook on `profiles.is_approved` flipping to true | Sends approval email via SMTP |
| `paymongo-create-source` | HTTPS POST from frontend (paywall page → GCash/Card button) | Creates PayMongo source for GCash or attaches payment intent for Card; returns checkout URL |
| `paymongo-webhook` | HTTPS POST from PayMongo | Verifies signature (HMAC-SHA256 with webhook secret), on `payment.paid` event: insert into `payments`, update `profiles.subscription_status='paid'`, `subscription_tier='premium'`, `subscription_ends_at = period_end` |
| `start-trial-on-first-login` | HTTPS POST from frontend after login | If approved && trial_started_at IS NULL → set trial dates |
| `notify-listing-status` | DB webhook on `listings.status` change | Insert into `notifications` + optional email |
| `expire-trials-cron` | Scheduled (every hour) | Sweep `profiles` where `trial_ends_at < now()` AND `subscription_status='trial'` → set to `'expired'` |
| `expire-subscriptions-cron` | Scheduled (daily) | Same for `subscription_ends_at` |

**No `reset-monthly-quota-cron` needed** — the monthly-quota trigger queries `created_at >= date_trunc('month', now())` directly, so the count "resets" implicitly when the calendar month rolls over.

---

## 7. Frontend Integration (index.html)

Wire the existing HTML/CSS/JS to Supabase. **No layout changes** — only swap mock data for live calls. Tier-gating overlays are already injected by the §7.3 script block.

Because Draft 28's app code is minified onto one line (line 182), navigate with **string-anchor grep** rather than line numbers: e.g., `Grep -path 'index.html' -pattern 'function doSignup'`.

### 7.1 Add Supabase JS SDK — **Status: TODO**
Inside `<head>` after Chart.js:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```
Initialize once in the main `<script>` block, reading from `config.js`:
```js
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
```

### 7.1.1 PAGES map in Draft 28 — **Status: DONE** (registration), **TODO** (data wiring)

The frontend's `PAGES` object (anchor: search `const PAGES =` or `PAGES={`) registers route keys → DOM ids. The §7.3 script also extends this map with `pending-approval` and `paywall` at runtime.

| Key | DOM id | Purpose | Backend wiring |
|---|---|---|---|
| `home` | `page-home` | Featured carousel, latest news tabs, trending news, recent listings | `articles` + `listings` queries |
| `dashboard` | `page-dashboard` | Analytics charts | Aggregations over `listings.view_count`, `saved_listings`, plus an `events`/`inquiries` table (not yet in schema — see §1 TODO) |
| `listings` | `page-listings` | Browse all active listings, grid/list view | `listings` filtered to status=active |
| `your-listings` | `page-your-listings` | Broker's own listings with pending/active/archive chips | `listings.broker_id = me`. Add `rejected` chip + show `rejection_reason` |
| `bookmarks` | `page-bookmarks` | Saved listings (tile or list view) | `saved_listings` join `listings` |
| `listing-detail` | `page-listing-detail` | Single listing detail | `listings` by id |
| `messages` | `page-messages` | Chat list + window + side panel | `conversations`, `messages`, `conversation_states` (§1.12) |
| `broker` | `page-broker` | Broker profile sub-view (opened from chat) | `profiles` by id |
| `calendar` | `page-calendar` | Mini cal + month/week view | `calendar_events` |
| `profile` | `page-profile` | Own profile editor | `profiles` self |
| `settings` | `page-settings` | Multi-panel settings | `profiles` self + per-user settings |
| `help` | `page-help` | Static help content | None |
| `premium` | `page-premium` | Pricing/upgrade marketing page — **CONTENT IS STALE** (Free / ₱999/month / Enterprise). Rewrite to Regular vs Premium quarterly before PayMongo wiring | PayMongo Edge Function entry point |
| `notifications` | `page-notifications` | Full notification list | `notifications` |
| `article` | `page-article` | News/announcement/memorandum detail | `articles` by id |
| `pending-approval` *(injected)* | `page-pending-approval` | Pending-approval screen for unapproved brokers | profile.is_approved gate (no query needed) |
| `paywall` *(injected)* | `page-paywall` | Trial/subscription expired gate; entry point to PayMongo | `paymongo-create-source` Edge Function |

### 7.2 Function-level rewrites — **Status: TODO**

Anchors below are grep targets within `index.html` line 182.

| Anchor | New behavior |
|---|---|
| `function doSignup` | Validate inputs, upload id_photo + prc_id to `id-documents`, `supabase.auth.signUp`, insert profile row, redirect to `pending-approval`. Form-extension prereq: add PRC license / 1×1 photo / PRC ID / ToS fields. |
| `function doLogin` | `supabase.auth.signInWithPassword`, fetch profile, call `start-trial-on-first-login` Edge Function if needed, then route via the existing wrapper to dashboard / pending-approval / paywall. |
| `function doLogout` | `supabase.auth.signOut`, clear local state. |
| `LISTINGS_DATA=` | Remove constant; replace consumer code with `await supabase.from('listings').select().eq('status','active').order('created_at',{ascending:false})`. |
| `YOUR_LISTINGS=` | Replace with `.from('listings').select().eq('broker_id', user.id)`. |
| `CAL_EVENTS=` | Replace with `.from('calendar_events').select().eq('user_id', user.id)`. Also fix hardcoded "today" to `new Date()`. |
| `HOME_ARTICLES=` | Replace with `.from('articles').select().not('published_at','is',null).order('published_at',{ascending:false})`. |
| `function selectChat` | Fetch conversations → render contacts; on select, fetch messages + subscribe via `supabase.channel(...).on('postgres_changes', ...)` to push new messages live. |
| Add Listing modal submit (`form` inside `#overlay-add-listing`) | Already gated by the injected Accuracy Agreement modal (§7.3). On confirm, upload images to `listing-images`, insert listing with status='pending', show submit-success overlay. |
| Advanced filter | Build `.from('listings')` query with chained `.eq`/`.gte`/`.lte`/`.contains` calls. |

### 7.3 New UI additions — **Status: DONE (broker side), PARTIAL (admin portal)**

Implemented by `<style id="k-net-new-ui">` and `<script id="k-net-new-ui-js">` appended to the end of `<body>` in `index.html`. The script injects DOM at `DOMContentLoaded`, extends `window.PAGES`, hooks the existing `doLogin`/`doLogout`, and intercepts locked clicks. Until real auth lands, behavior is gated by a `window.__currentUser` placeholder (default `{ subscription_tier: 'regular', subscription_status: 'trial', is_approved: true }`) so locks are visible in the demo.

1. **Pending Approval screen** (`page-pending-approval`) — full-page block: envelope icon, headline "Your account is under review", sub "We'll email you once an admin verifies your PRC ID and 1×1 photo (typically <24 hours).", "Sign out" button → `doLogout()`. Auto-shown after login when `__currentUser.is_approved === false`.
2. **Paywall screen** (`page-paywall`) — two cards: Regular (current/free during trial) and Premium (₱TBD / 90 days). Premium card has GCash + Card buttons → currently `alert('PayMongo integration pending')`; wire to `paymongo-create-source` Edge Function once built. Auto-shown when trial/subscription expired.
3. **Listing Accuracy Agreement modal** (`#overlay-accuracy-agreement`) — appears before Add Listing submit. Required checkbox "I confirm this property and its details are legitimate and that I am the listing broker of record." Confirm disabled until ticked; on confirm, original submit fires.
4. **Upgrade modal** (`#overlay-upgrade`) — title "Premium feature locked", lists what Premium unlocks. Buttons: "See plans" → `goTo('paywall')`; "Maybe later" → `closeModal`.
5. **Tier locks** — lock icon on sidebar `Messages` link and the Call button on listing detail. Click is intercepted when `__currentUser.subscription_tier !== 'premium'` → `showModal('overlay-upgrade')`.
6. **Admin Portal pages** (visible only when `role='admin'`) — implemented as a separate React app at `admin/`. Status:
   - `BrokerApprovals` — **DONE** (`admin-src/src/pages/BrokerApprovals.tsx`)
   - `ListingApprovals` — **DONE** (`admin-src/src/pages/ListingApprovals.tsx`)
   - `AdminArticles` — **TODO**
   - `AdminUsers` — **TODO**

---

## 8. PayMongo Integration Details — **Status: TODO**

1. **Create source** (frontend → `paymongo-create-source` Edge Function):
   - For GCash: PayMongo Sources API → returns redirect URL → frontend redirects user.
   - For Card: PayMongo Payment Intents + Payment Methods API → 3DS flow.
2. **Webhook** (`paymongo-webhook` Edge Function):
   - Endpoint URL configured in PayMongo dashboard.
   - Verify `Paymongo-Signature` header (HMAC-SHA256 with webhook secret stored in Supabase env vars).
   - Handle `source.chargeable` (auto-create payment) and `payment.paid` (success).
   - Idempotent on `paymongo_payment_id` unique constraint.
3. **Pricing**: ₱TBD per quarter (90 days). Set after fee analysis (PayMongo ~2.5% card / ~2.0% GCash fee).

---

## 9. Matching System — **Status: TODO**

**Concept:** Broker A's buyer wants property in City X, but A doesn't operate there. A searches the matching system for brokers with City X in their `service_areas`, optionally filtered by specialty.

### 9.1 Schema (covered in §1)
- `profiles.service_areas` — JSONB array of `{region, province, city}` objects, populated by broker in Profile settings. (Column DONE in 0001.)
- `profiles.specialties` — text array. (Column DONE in 0001.)
- `referrals` table — TODO.

### 9.2 API
- `GET /matching/brokers?region=...&province=...&city=...&specialty=...` — RPC function `search_brokers_by_area` returning Premium-only brokers whose `service_areas` contains the queried city. Fields: id, name, avatar, agency, closed_deals_count, listings_count, specialties.
- `POST /matching/referrals` — body `{to_broker_id, buyer_target_*, buyer_notes}` → insert referral, auto-create conversation between the two brokers, insert initial message containing buyer notes, return `conversation_id` so frontend can navigate to chat.

### 9.3 Frontend (deferred)
New page `page-matching` to be designed in a separate plan. Backend ready to serve it.

---

## 10. Cloudflare Configuration — **Status: TODO**

### 10.1 Cloudflare Pages (static frontend host)
- Host `index.html` (renamed to `index.html`) on **Cloudflare Pages**, served at `app.konek.ph`.
- Chosen over Vercel/Render because we already use Cloudflare for CDN/WAF — single vendor, unlimited bandwidth on free tier, same edge network as listing-image CDN.
- No build step. Deploy via Git push (connect repo) or direct upload via `wrangler pages deploy`.
- Preview URLs auto-generated per branch for QA before promoting to production.
- Environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) injected at build time via Pages dashboard — only public anon key exposed to browser; service-role key stays in Edge Functions.

### 10.2 DNS + CDN + WAF
- DNS proxied (orange cloud) on `konek.ph`, `app.konek.ph` (Pages), `cdn.konek.ph` (Supabase Storage), `api.konek.ph` (Supabase API).
- WAF rules: rate limit `/auth/*` (10 req/min/IP), `/paymongo-webhook` (allow only PayMongo IPs), block known bot user agents.
- Page Rules: aggressive cache on `cdn.konek.ph/listing-images/*` (cache-everything, 7-day edge TTL).
- DDoS: default "I'm Under Attack" mode available for incident response.

### 10.3 Admin React app deployment
- Build `admin-src/` (`npm run build`) → output already committed at `admin/`. Deploy as a separate Pages project on subdomain `admin.konek.ph`. Same env-var conventions.

---

## 11. Critical Files Touched

- `C:\Users\Predator\Konek-PH\index.html` — wire up SDK, replace mock data, rewrite the Premium page copy (search `Enterprise` or `₱999/month`), add PRC license / 1×1 photo / PRC ID / ToS fields to the signup form (anchor: `su-fname`), unhardcode calendar "today" (anchor: `calYr`, `calMo`). New broker UI (Pending Approval, Paywall, Accuracy modal, Upgrade modal, tier locks) is already present via the appended `<style id="k-net-new-ui">` + `<script id="k-net-new-ui-js">` blocks.
- `C:\Users\Predator\Konek-PH\supabase\migrations\0001_initial_schema.sql` — DONE for profiles/listings/notifications/PSGC/property_types + 5 triggers + most RLS.
- `C:\Users\Predator\Konek-PH\supabase\migrations\0002_seed_psgc.sql` — DONE for curated PSGC + property types.
- `C:\Users\Predator\Konek-PH\supabase\storage_buckets.sql` — DONE for id-documents/avatars/listing-images.
- `C:\Users\Predator\Konek-PH\supabase\migrations\0003_messaging_billing.sql` — **TODO**: `saved_listings`, `conversations`, `messages`, `calendar_events`, `articles`, `payments`, `referrals`, `audit_log`, `conversation_states`, plus triggers `update_conversation_preview`, `enforce_premium_for_chat`, `upsert_conversation_state`, plus RLS for each.
- `C:\Users\Predator\Konek-PH\supabase\functions\send-account-ready-email\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\supabase\functions\paymongo-create-source\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\supabase\functions\paymongo-webhook\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\supabase\functions\start-trial-on-first-login\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\supabase\functions\notify-listing-status\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\supabase\functions\expire-trials-cron\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\supabase\functions\expire-subscriptions-cron\index.ts` — **TODO**.
- `C:\Users\Predator\Konek-PH\admin-src\src\pages\AdminArticles.tsx` — **TODO**.
- `C:\Users\Predator\Konek-PH\admin-src\src\pages\AdminUsers.tsx` — **TODO**.
- `C:\Users\Predator\Konek-PH\.env.example` — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`.

---

## 12. Build Order (next session checklist)

Items already done are marked ✔ for completeness.

1. ✔ Create Supabase project; run `0001_initial_schema.sql` + `0002_seed_psgc.sql` + `storage_buckets.sql`.
2. ✔ Seed admin user manually via SQL.
3. ✔ Admin React app: Login + BrokerApprovals + ListingApprovals pages.
4. **Next**: Write `0003_messaging_billing.sql` covering `saved_listings`, `conversations`, `messages`, `calendar_events`, `articles`, `payments`, `referrals`, `audit_log`, `conversation_states` + their triggers + RLS.
5. Create `supabase/functions/send-account-ready-email` + Resend integration.
6. Wire `doSignup` / `doLogin` / `doLogout` in `index.html` to Supabase Auth; the §7.3 wrapper already routes to `pending-approval` / `paywall` based on `__currentUser`. Replace placeholder with real profile fetch.
7. Extend signup form with PRC license / 1×1 photo / PRC ID / ToS checkbox (anchor: `su-fname`). Tighten `id_photo_url`, `prc_id_url`, `tos_accepted_at` to `not null` in profiles.
8. Rewrite Premium page copy (anchor: `Enterprise` / `₱999/month`) to Regular vs Premium quarterly with price TBD.
9. Replace `LISTINGS_DATA` + `YOUR_LISTINGS` with live queries; the Accuracy Agreement modal (§7.3) is already wired between submit and the original handler.
10. Build PayMongo Edge Functions (sandbox first). Wire paywall GCash/Card buttons (currently placeholder alert).
11. Build `AdminArticles` + `AdminUsers` pages in `admin-src/`.
12. Wire Calendar + Notifications to Supabase. Unhardcode calendar "today".
13. Enable Realtime on messages; build chat with live subscriptions.
14. Build Matching schema (already covered in §1) → API endpoints → frontend page in a follow-up plan.
15. Cron jobs for trial/subscription expiry.
16. Cloudflare DNS cutover + WAF rules.

---

## 13. Verification

End-to-end test script (manual, run after each milestone):

1. **Signup → pending**: register a new broker; verify row in `profiles` with `is_approved=false`; verify ID files in `id-documents` bucket; verify Pending Approval screen shown on login.
2. **Admin approval**: log in to admin React app at `admin/`; approve the new broker via BrokerApprovals; verify Resend dashboard shows the email sent; verify approved broker now sees dashboard.
3. **Trial start**: after first post-approval login, check `trial_started_at` and `trial_ends_at` set to +3 days.
4. **Listing create + approval**: broker posts listing; verify Listing Accuracy Agreement modal blocks submission without checkbox; on submit, row inserted with `status='pending'`; not visible on public newsfeed. Admin approves → status flips to 'active' → visible to all.
5. **Monthly listing quota (Regular)**: as Regular broker, post 10 listings within the current calendar month; verify 11th attempt returns DB error and frontend shows upgrade modal. Then manually set one listing's `created_at` to last month and retry — should succeed, because previous months don't count.
5b. **Monthly listing quota (Premium)**: as Premium broker at the 15-listing cap, attempt to post a 16th; verify error message reads "wait until next month". On the 1st of next month (simulate via clock), verify the same broker can post again with a fresh quota.
6. **Tier lock**: as Regular broker, click Messages in sidebar → upgrade modal opens. Click Call on listing detail → upgrade modal opens.
7. **PayMongo (sandbox)**: trigger checkout; complete sandbox payment; verify webhook received, `payments` row inserted, `subscription_tier='premium'`, `subscription_status='paid'`, `subscription_ends_at` = +90 days. Verify Messages/Matching now unlocked.
8. **Realtime chat**: open chat as two Premium brokers in two browsers; send message in browser A; verify it appears in browser B within ~1s without refresh.
8b. **Per-user chat state**: as Broker A, pin a chat with Broker B; verify `conversation_states` row inserted for A only. Log in as B in another browser; verify B's view of the same chat is NOT pinned.
9. **Trial expiry**: manually set `trial_ends_at` to past time; reload app; verify redirect to paywall.
10. **Matching**: as Premium broker A, search for brokers covering "Cebu City"; verify only Premium brokers with Cebu City in `service_areas` returned; click Connect → referral row inserted, conversation created, redirected to chat with broker B.
11. **Admin article**: admin publishes a news article; verify it appears on home page for all brokers.
12. **RLS sanity**: as broker, attempt `supabase.from('profiles').select('*').neq('id', myId)` — verify private fields (id_photo_url, prc_id_url, trial_ends_at) are not returned. Attempt to insert into `articles` as broker → denied.
13. **Cloudflare CDN**: load a listing image; verify response headers include `cf-cache-status: HIT` on second load.
