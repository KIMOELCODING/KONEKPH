-- ============================================================
-- 0030_lock_leads_insert.sql
-- Close the anonymous direct-insert path on public.leads.
--
-- 0029 let anon/authenticated INSERT leads directly (column-restricted) so the
-- public marketing site could submit inquiries. That means a bot can bypass the
-- form and POST straight to PostgREST. Now that lead intake goes through the
-- `submit-lead` Edge Function (honeypot + Cloudflare Turnstile verification,
-- then a service-role insert), remove the direct path entirely.
--
-- After this migration, the ONLY way to create a lead is the Edge Function:
-- service_role bypasses RLS + column grants, so it still inserts; anon and
-- authenticated have no insert privilege and no insert policy.
--
-- PREREQUISITE: deploy the `submit-lead` function and set TURNSTILE_SECRET_KEY
-- BEFORE applying this, or the public form will have no working submit path.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Remove the column-level insert grant added in 0029.
revoke insert (marketing_listing_id, name, location, email, phone, message)
  on public.leads from anon, authenticated;
-- Belt-and-suspenders: drop any table-level insert too.
revoke insert on public.leads from anon, authenticated;

-- Drop the permissive insert policy — no RLS insert path for anon/authenticated.
drop policy if exists leads_insert_anon on public.leads;

-- SELECT/UPDATE policies for marketing/admin (leads_select_marketing /
-- leads_update_marketing) are unchanged. The submit-lead function inserts with
-- the service role, which is exempt from RLS and column grants.
