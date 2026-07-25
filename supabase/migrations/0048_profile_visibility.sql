-- 0048_profile_visibility.sql
-- S3 Profile Visibility — a broker toggle that hides their profile from PUBLIC
-- view while keeping listings visible and staying normal to active chat peers.
--
-- Adds ONE computed column to broker_directory: profile_visible. It reads
-- profiles.preferences to compute the flag but NEVER projects the raw preferences
-- column. DEFAULT-TRUE semantics: an absent 'profile_visibility' key -> NULL ->
-- the frontend treats NULL/true as VISIBLE and hides ONLY on explicit false, so a
-- broker who never toggled is never hidden.
--
-- SECURITY (carries 0047 forward — non-negotiable). broker_directory is a
-- SECURITY-DEFINER, auto-updatable view; Supabase's default ACL grants ALL to
-- anon/authenticated on new/replaced views. CREATE OR REPLACE preserves the
-- existing ACL (it does not drop the object, and pg_default_acl only fires on
-- brand-new objects), so 0047's revokes survive in principle — but this migration
-- RE-ASSERTS them unconditionally after the replace, and the apply step RE-PROVES
-- writes are denied (authenticated + anon UPDATE, anon SELECT). Reopening the
-- proven escalation (anon could UPDATE/DELETE any broker row via the view) while
-- shipping a privacy feature would be the worst possible outcome.
--
-- Safe-projection, NOT a row filter: hidden brokers' rows STILL return; the
-- frontend hides fields. A WHERE filter would null out active chat peers via the
-- messages loader's .in('id', otherIds) resolve. security_invoker is NOT flipped:
-- profiles has no peer SELECT policy (own + admin only), so invoker semantics would
-- break all four read sites — the view must stay security-definer.

-- 1. Redefine the view: the live column list (byte-identical, in order) PLUS the
--    computed flag appended at the end.
create or replace view public.broker_directory as
  select id,
         first_name,
         last_name,
         avatar_url,
         title,
         agency,
         license_number,
         bio,
         specialties,
         service_areas,
         closed_deals_count,
         created_at,
         last_seen_at,
         (preferences ->> 'profile_visibility')::boolean as profile_visible
  from public.profiles
  where is_approved = true and role = 'broker';

-- 2. IMMEDIATELY re-assert 0047's lockdown (verbatim). Keep authenticated SELECT.
revoke insert, update, delete, truncate on public.broker_directory from anon, authenticated;
revoke select on public.broker_directory from anon;
grant  select on public.broker_directory to authenticated;
