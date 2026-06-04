-- ============================================================
-- 0028_listing_reports.sql
-- User-submitted reports against listings + admin moderation.
-- A broker flags a listing (scam / misleading / etc.); admins review on the
-- admin app and either take the listing down or dismiss the report.
-- ============================================================

create table if not exists public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,            -- category label chosen in the UI
  description text,                -- optional free-text note
  status text not null default 'pending'
    check (status in ('pending','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One report per user per listing (anti-spam). A repeat submit hits this and
  -- the frontend surfaces a friendly "already reported" message.
  unique (listing_id, reporter_id)
);

create index if not exists listing_reports_status_created_idx
  on public.listing_reports(status, created_at desc);
create index if not exists listing_reports_listing_idx
  on public.listing_reports(listing_id);

drop trigger if exists listing_reports_set_updated_at on public.listing_reports;
create trigger listing_reports_set_updated_at before update on public.listing_reports
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.listing_reports enable row level security;

-- Reporter may file a report as themselves, but NOT on their own listing.
drop policy if exists listing_reports_insert_own on public.listing_reports;
create policy listing_reports_insert_own on public.listing_reports
  for insert with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.broker_id <> auth.uid()
    )
  );

-- Reporter may read their own reports (e.g. to avoid duplicate submits).
drop policy if exists listing_reports_select_own on public.listing_reports;
create policy listing_reports_select_own on public.listing_reports
  for select using (reporter_id = auth.uid());

-- Admins see and manage every report. (Brokers get NO policy to see reports
-- filed against their own listings.)
drop policy if exists listing_reports_admin_select on public.listing_reports;
create policy listing_reports_admin_select on public.listing_reports
  for select using (public.is_admin());

drop policy if exists listing_reports_admin_update on public.listing_reports;
create policy listing_reports_admin_update on public.listing_reports
  for update using (public.is_admin()) with check (public.is_admin());
