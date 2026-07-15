-- ProList — Report a user (Phase E2).
--
-- A broker reports another broker from the chat drawer (spam / harassment /
-- fraud / etc.). Admins review on the admin app and mark the report resolved or
-- dismissed. Person-scoped (NOT listing-scoped) so it cannot reuse
-- listing_reports (0028), whose listing_id is NOT NULL and whose insert RLS
-- joins to listings.
--
-- PRIVACY — HARD CONSTRAINT: the reported user must NEVER learn they were
-- reported. There is deliberately NO RLS policy granting the reported user any
-- visibility, the frontend inserts NO notification and invokes NO email, so a
-- user report is visible only to the reporter (their own row) and to admins.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

create table if not exists public.user_reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.profiles(id) on delete cascade,
  reported_user_id  uuid not null references public.profiles(id) on delete cascade,
  -- Context for the admin: which chat it came from. Nullable + ON DELETE SET
  -- NULL so the report survives conversation deletion.
  conversation_id   uuid references public.conversations(id) on delete set null,
  reason text not null
    check (reason in ('spam','harassment','fraud','fake_listing','inappropriate','scam','other')),
  description text,                -- optional free-text (required client-side for 'other')
  status text not null default 'pending'
    check (status in ('pending','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Can't report yourself.
  check (reporter_id <> reported_user_id)
);

-- One OPEN report per (reporter, reported) pair. A person is an ongoing actor,
-- so unlike listing_reports we do NOT block forever: a partial unique index
-- prevents stacking pending reports (dup -> 23505) while allowing a fresh report
-- once the prior one is resolved/dismissed (repeat offenders can be re-reported).
create unique index if not exists user_reports_one_open_per_pair
  on public.user_reports(reporter_id, reported_user_id) where status = 'pending';

create index if not exists user_reports_status_created_idx
  on public.user_reports(status, created_at desc);
create index if not exists user_reports_reported_idx
  on public.user_reports(reported_user_id);

drop trigger if exists user_reports_set_updated_at on public.user_reports;
create trigger user_reports_set_updated_at before update on public.user_reports
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.user_reports enable row level security;

-- Reporter may file a report as themselves, never against themselves.
drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports
  for insert with check (
    reporter_id = auth.uid() and reported_user_id <> auth.uid()
  );

-- Reporter may read their OWN reports only (e.g. to avoid duplicate submits).
drop policy if exists user_reports_select_own on public.user_reports;
create policy user_reports_select_own on public.user_reports
  for select using (reporter_id = auth.uid());

-- Admins see and manage every report. The reported user gets NO select policy —
-- this absence is the data-layer "never notified" guarantee.
drop policy if exists user_reports_admin_select on public.user_reports;
create policy user_reports_admin_select on public.user_reports
  for select using (public.is_admin());

drop policy if exists user_reports_admin_update on public.user_reports;
create policy user_reports_admin_update on public.user_reports
  for update using (public.is_admin()) with check (public.is_admin());
