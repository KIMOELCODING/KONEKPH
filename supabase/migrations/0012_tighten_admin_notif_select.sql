-- Konek.PH — Tighten admin SELECT on notifications.
-- 0004 gave admins blanket SELECT on every row "for audit". That lets any admin
-- read a broker's private rejection reasons / in-app pings. The owner SELECT
-- policy from 0001 (notifications_select_own) already covers admins reading
-- their own admin-bound notifications (broker_signup, broker_reapply,
-- new_listing), so the blanket policy is redundant for the bell.
--
-- Drop it. If we need audit later, add a separate admin-audit endpoint that
-- runs with service_role, not a permissive RLS policy.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

drop policy if exists notifications_select_admin on public.notifications;
