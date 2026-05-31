-- Konek.PH — Stop brokers from reading each other's private profile columns.
--
-- profiles_select_brokers (0001) let ANY authenticated broker read the FULL row
-- of every approved broker — including phone, subscription/billing state, and
-- id_photo_url / prc_id_url path strings. (The ID-doc *files* were always safe:
-- the private id-documents bucket only lets owner+admin read them. This was a
-- metadata/PII leak, not a file leak.)
--
-- Fix without splitting the table: peers now read other brokers ONLY through
-- the broker_directory view (created in 0016), which exposes safe columns only.
-- The two frontend reads that needed cross-broker data have been repointed:
--   1. Listing-detail "contact broker"  -> broker_directory  (index.html ~3785)
--   2. Chat conversation list           -> broker_directory  (index.html ~5677)
-- Self-reads still work via profiles_select_own; admins via profiles_select_admin.
--
-- PREREQUISITE: apply 0016 first (it creates public.broker_directory) and deploy
-- the matching index.html before running this — otherwise contact-broker and
-- chat names go blank.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- Safety: make sure the view this depends on exists before we remove the policy.
do $$
begin
  if not exists (
    select 1 from information_schema.views
    where table_schema = 'public' and table_name = 'broker_directory'
  ) then
    raise exception 'broker_directory view missing — apply 0016 before 0017.';
  end if;
end$$;

drop policy if exists profiles_select_brokers on public.profiles;
