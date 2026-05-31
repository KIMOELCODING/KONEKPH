-- ============================================================
-- 0020 — Real per-view tracking for Engagement Analytics
-- ============================================================
-- The dashboard analytics chart used a single counter (listings.view_count),
-- so it could only draw a flat "Visits" line and counted the OWNER's own views.
-- This adds a timestamped event table so visits can be bucketed by month/quarter,
-- and rewrites bump_view_count() to (a) skip the listing owner and (b) record an
-- event. view_count is kept as a denormalized total (top-5 sort + dashboard tiles).

create table if not exists public.listing_views (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  viewer_id   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists listing_views_listing_created_idx
  on public.listing_views (listing_id, created_at desc);

alter table public.listing_views enable row level security;

-- Analytics are private: only the listing's owner (or an admin) reads its events.
drop policy if exists listing_views_owner_select on public.listing_views;
create policy listing_views_owner_select on public.listing_views
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_views.listing_id and l.broker_id = auth.uid()
    )
    or public.is_admin()
  );
-- No INSERT policy on purpose: rows are written only by bump_view_count()
-- (SECURITY DEFINER), which enforces owner-exclusion and the active-only rule.

-- Rewrite the RPC: skip owner self-views, record an event, keep counter in sync.
create or replace function public.bump_view_count(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_status text;
begin
  select broker_id, status into v_owner, v_status
    from public.listings
   where id = p_listing_id;

  -- Only count active listings; never count the owner viewing their own listing.
  if v_status is distinct from 'active' then return; end if;
  if v_owner is not distinct from auth.uid() then return; end if;

  insert into public.listing_views (listing_id, viewer_id)
  values (p_listing_id, auth.uid());

  update public.listings
     set view_count = view_count + 1
   where id = p_listing_id;
end;
$$;

revoke all on function public.bump_view_count(uuid) from public;
grant execute on function public.bump_view_count(uuid) to authenticated;

-- Realtime: let an owner's analytics tick up live as views land (RLS above
-- ensures each owner only receives their own listings' view events).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listing_views'
  ) then
    execute 'alter publication supabase_realtime add table public.listing_views';
  end if;
end$$;
