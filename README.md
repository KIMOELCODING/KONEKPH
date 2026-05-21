# Konek.PH

Philippine real-estate broker dashboard. Single-page static frontend (`Draft 19.html`) wired to a Supabase backend.

This repo currently ships **Phase 1**: auth (signup with PRC docs, login, logout), Pending Approval screen, minimal Admin Portal (broker + listing approvals), and listings CRUD with the Listing Accuracy Agreement and the monthly-quota trigger. PayMongo billing, realtime chat, edge functions, crons, and Cloudflare are tracked in `BACKEND_PLAN.md` for follow-up phases.

## Local setup

### 1. Create a Supabase project

1. Sign in at https://supabase.com/dashboard and create a new project.
2. Wait for it to provision (~2 minutes).

### 2. Apply migrations

In the Supabase Dashboard -> **SQL Editor**, run these files in order:

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_seed_psgc.sql`
3. `supabase/storage_buckets.sql`

### 3. Configure the frontend

```powershell
copy config.example.js config.js
```

Edit `config.js` and paste in your project's values from **Project Settings -> API**:

```js
window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

`config.js` is gitignored — never commit credentials.

### 4. Seed an admin user

a. In Supabase Dashboard -> **Authentication -> Users**, click **Add user -> Create new user**. Enter an email + password (e.g. `admin@konek.ph` / a strong password). Confirm the email if Supabase prompts.

b. In **SQL Editor**, copy the new user's UUID from the Users table, then run:

```sql
update public.profiles
   set role = 'admin',
       is_approved = true,
       subscription_status = 'paid',
       first_name = 'Konek',
       last_name = 'Admin'
 where id = '<PASTE-ADMIN-USER-UUID-HERE>';
```

### 5. Run the frontend

```powershell
cd c:\Users\Predator\Konek-PH
python -m http.server 5500
```

Open http://localhost:5500/Draft%2019.html

> ⚠️ You **must** serve over HTTP (not `file://`) — Supabase Auth requires a real origin for session cookies.

## Verification walkthrough

1. Visit the login page -> click **Sign Up** -> fill all fields incl. PRC license, 1×1 photo, PRC ID, tick the ToS -> **Create Account**. You should land on the **Pending Approval** screen.
2. Log out -> log in as the admin you seeded. The sidebar shows an **Admin** link. Open it -> approve the new broker.
3. Log out -> log in as the new broker. You should land on the dashboard with a fresh 3-day trial (`trial_ends_at` set in the `profiles` table).
4. Open **Add Listing**, fill in details, **Submit**. The Listing Accuracy Agreement modal must block submission until checked. After submit, the listing appears under **Your Listings** with status `pending`.
5. As admin, approve the listing. Refresh as broker -> the listing is now visible on the public **Listings** marketplace.

## Project structure

```
Konek-PH/
├── Draft 19.html              # Entire frontend (HTML + CSS + JS inlined)
├── config.example.js          # Template for Supabase credentials
├── config.js                  # Local credentials (gitignored)
├── README.md
├── CLAUDE.md                  # Editing conventions
├── BACKEND_PLAN.md            # Production backend design (source of truth)
└── supabase/
    ├── storage_buckets.sql
    └── migrations/
        ├── 0001_initial_schema.sql
        └── 0002_seed_psgc.sql
```

## What's deferred

See `BACKEND_PLAN.md` §12 steps 6+:

- PayMongo paywall + Edge Functions
- Realtime chat + `messages`/`conversations`/`conversation_states` tables
- Calendar, articles/news, bookmarks, referrals/matching wiring
- Cron jobs for trial/subscription expiry
- Cloudflare DNS + WAF + CDN setup
