-- ============================================================
-- 0025 — Count UNIQUE visitors per period for Engagement Analytics
-- ============================================================
-- Problem: bump_view_count() records one listing_views row per OPEN, and the
-- dashboard chart counted raw rows. So a single broker opening a listing 16x
-- showed "16 visits". The owner wants 1 account = 1 visit, with the count
-- refreshing per the chart's Monthly/Quarterly toggle.
--
-- Fix (chosen behavior = "match the toggle"): keep raw timestamped events, but
-- aggregate DISTINCT viewer_id per period. Monthly toggle -> each viewer counts
-- once per calendar month; Quarterly toggle -> once per quarter. Done in a
-- SECURITY DEFINER RPC so viewer identities are aggregated server-side and never
-- returned to the browser (the client only receives bucketed counts).
--
-- Owner self-views remain excluded (re-asserted below from 0020, idempotently,
-- in case 0020 was never applied on this DB). No insert-time dedup — raw events
-- are retained so the same data can be bucketed monthly OR quarterly correctly.
--
-- Calendar fields are computed in Asia/Manila so buckets line up with the PH
-- client's local month/quarter boundaries.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- ------------------------------------------------------------
-- Re-assert owner-excluded view recorder (same as 0020; keeps raw events).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Distinct-visitor stats per period, owner-scoped.
-- Returns one row per (listing, period) with the count of DISTINCT viewers.
-- p_bucket: 'month' (default) or 'quarter'. period_no is 1-12 (month) or 1-4
-- (quarter); yr is the 4-digit year — both in Asia/Manila local time.
-- ------------------------------------------------------------
create or replace function public.listing_visit_stats(
  p_listing_ids uuid[],
  p_bucket text default 'month'
)
returns table(listing_id uuid, yr int, period_no int, visits bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    v.listing_id,
    extract(year from (v.created_at at time zone 'Asia/Manila'))::int as yr,
    case when p_bucket = 'quarter'
         then extract(quarter from (v.created_at at time zone 'Asia/Manila'))::int
         else extract(month   from (v.created_at at time zone 'Asia/Manila'))::int
    end as period_no,
    count(distinct v.viewer_id) as visits
  from public.listing_views v
  join public.listings l on l.id = v.listing_id
  where v.listing_id = any(p_listing_ids)
    and (l.broker_id = auth.uid() or public.is_admin())
    -- Exclude the owner's own views even for rows recorded before owner-
    -- exclusion landed in bump_view_count (cleans up historical self-views).
    and v.viewer_id is distinct from l.broker_id
  group by v.listing_id, yr, period_no;
$$;

revoke all on function public.listing_visit_stats(uuid[], text) from public;
grant execute on function public.listing_visit_stats(uuid[], text) to authenticated;
