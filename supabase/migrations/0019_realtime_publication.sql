-- ============================================================
-- 0019 — Realtime publication for live app data
-- ============================================================
-- Adds the tables the broker frontend needs to update without a reload
-- (listings feed + own-listing status, calendar, home content, dashboard
-- deals, notifications) to the supabase_realtime publication. Without this,
-- the frontend's postgres_changes subscriptions never fire and data only
-- refreshes on navigation. 0003 already added public.messages.
--
-- RLS still gates every event: a subscriber only receives a row change it is
-- allowed to SELECT (listings_select_active for the public feed,
-- listings_select_own for an owner's pending/rejected status, owner-scoped
-- policies for calendar_events/deals, published-or-admin for articles).
--
-- Idempotent: safe to re-run. Apply in the Supabase SQL editor / CLI.

-- 1) Add tables to the realtime publication (guard each — add only if missing).
do $$
declare
  t text;
  tables text[] := array[
    'listings',
    'calendar_events',
    'articles',
    'promoted_slides',
    'deals',
    'notifications'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;

-- 2) REPLICA IDENTITY FULL on the dynamic tables so UPDATE/DELETE events carry
--    the full row. This makes realtime authorization (RLS) and the frontend's
--    column filters (status=, broker_id=, user_id=) reliable on updates —
--    e.g. an admin flipping a listing to status='active', or rejecting one.
--    These tables are low-volume, so the extra WAL is negligible.
alter table public.listings        replica identity full;
alter table public.calendar_events replica identity full;
alter table public.deals           replica identity full;
alter table public.articles        replica identity full;
alter table public.promoted_slides replica identity full;
