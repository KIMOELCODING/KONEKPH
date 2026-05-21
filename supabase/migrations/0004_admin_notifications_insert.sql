-- Konek.PH — Admin INSERT on notifications
-- Fix for 403 when admin rejects a broker application from the admin app.
-- The original 0001 migration only gave owners SELECT/UPDATE on notifications,
-- so RLS blocked admin INSERTs (used by reject flow to notify the broker).
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

drop policy if exists notifications_insert_admin on public.notifications;
create policy notifications_insert_admin on public.notifications
  for insert with check (public.is_admin());

-- Admins can also read every notification (useful for audit / re-reading what
-- was sent). Owner SELECT policy from 0001 still applies for brokers.
drop policy if exists notifications_select_admin on public.notifications;
create policy notifications_select_admin on public.notifications
  for select using (public.is_admin());
