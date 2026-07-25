-- 0047_broker_directory_lockdown.sql
-- SECURITY FIX — privilege escalation on the broker_directory view.
--
-- broker_directory is a security-definer, auto-updatable view (owner = postgres,
-- reloptions = null so NOT security_invoker). anon + authenticated inherited ALL
-- privileges on it from public's default ACL (ALTER DEFAULT PRIVILEGES ... GRANT
-- ALL ON TABLES — the Supabase standard). Because the view runs as its owner,
-- writes through it BYPASS row-level security on profiles.
--
-- PROVEN on the live DB (transaction-rolled-back tests):
--   * as authenticated (any broker's JWT):  UPDATE / DELETE another broker's row -> rows=1
--   * as anon (public key, NO login):        UPDATE another broker's row          -> rows=1
--   * INSERT reached the base table (blocked only by the tos_accepted_at CHECK, 23514)
-- i.e. anyone holding the shipped anon key could deface/impersonate (incl.
-- license_number) or DELETE any approved broker's profile with no authentication.
--
-- Why not security_invoker=on: profiles has no peer SELECT policy (only
-- profiles_select_own = auth.uid()=id and profiles_select_admin). Under
-- security_invoker, view reads would run as the caller and return ONLY their own
-- row, zeroing out all four read sites (bookmarks, listing-detail agent card,
-- messages loader, broker profile). The view MUST stay security-definer; the fix
-- is grant-revocation, not invoker semantics.
--
-- Why not touch ALTER DEFAULT PRIVILEGES: base tables rely on the grant-all +
-- RLS model (authenticated needs the table-level write grant for RLS write
-- policies to be reachable). Revoking table writes globally would break RLS
-- writes on every future table. The escalation is specific to security-definer
-- updatable VIEWS, so fix the view.
--
-- CONVENTION (for future work): any new security-definer view over a base table
-- in schema public MUST `revoke insert, update, delete on <view> from anon,
-- authenticated;` — the default ACL will otherwise silently re-grant ALL.

-- 1. broker_directory — strip inherited writes; also revoke anon SELECT.
--    The view is a full directory of every approved broker's professional identity
--    (name, license_number, agency, bio, service_areas, last_seen_at). No anon read
--    path exists (public-site reads public_listings, which carries no broker
--    identity; all four broker-app read sites are authenticated), so anon has no
--    business scraping it. If an anon read ever appears it fails loudly (one-line
--    re-grant), rather than leaking silently.
revoke insert, update, delete, truncate on public.broker_directory from anon, authenticated;
revoke select on public.broker_directory from anon;
grant  select on public.broker_directory to authenticated;   -- the one grant we keep

-- 2. public_listings — same inherited write grants. Not auto-updatable today
--    (writes already error), but strip them as defense-in-depth so it can never
--    become an escalation vector if its definition changes. anon SELECT stays:
--    the public marketing site legitimately reads it (no identity columns).
revoke insert, update, delete, truncate on public.public_listings from anon, authenticated;
