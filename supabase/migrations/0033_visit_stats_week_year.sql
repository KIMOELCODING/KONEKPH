-- ============================================================
-- 0033 — Extend listing_visit_stats with 'week' and 'year' buckets
-- ============================================================
-- The Engagement Analytics chart's time filter is being consolidated into a
-- single dropdown with FOUR options: Weekly / Monthly / Quarterly / Yearly.
-- Inquiries and Saves are raw client-side timeseries and can bucket to any
-- period, but Visits are DISTINCT-viewer counts aggregated server-side (so
-- viewer identities never reach the browser). 0025 only produced 'month' and
-- 'quarter' buckets, so Weekly/Yearly Visits had no data source.
--
-- This migration re-creates listing_visit_stats keeping the exact return
-- contract (listing_id, yr, period_no, visits) and adds:
--   p_bucket = 'week'  -> yr = ISO week-numbering year, period_no = ISO week (1-53)
--   p_bucket = 'year'  -> yr = calendar year,           period_no = 1 (constant)
-- Existing 'month' (period_no 1-12) and 'quarter' (period_no 1-4) are unchanged,
-- so the Monthly/Quarterly consumers keep returning identical rows.
--
-- 'week'/'isoyear' are computed together so an early-January visit that belongs
-- to the previous ISO year buckets under that year (matching Postgres
-- extract(isoyear)/extract(week) and the client's ISO-week helper). All calendar
-- fields are in Asia/Manila so buckets line up with the PH client's boundaries.
--
-- Owner self-views stay excluded; owner/admin scoping unchanged. SECURITY
-- DEFINER so only bucketed counts leave the server. Idempotent.
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run.
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
    case when p_bucket = 'week'
         then extract(isoyear from (v.created_at at time zone 'Asia/Manila'))::int
         else extract(year    from (v.created_at at time zone 'Asia/Manila'))::int
    end as yr,
    case
      when p_bucket = 'quarter' then extract(quarter from (v.created_at at time zone 'Asia/Manila'))::int
      when p_bucket = 'week'    then extract(week    from (v.created_at at time zone 'Asia/Manila'))::int
      when p_bucket = 'year'    then 1
      else                           extract(month   from (v.created_at at time zone 'Asia/Manila'))::int
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
