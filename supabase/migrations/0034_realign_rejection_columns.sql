-- Konek.PH (ProList) — realign profiles rejection columns into the migration set.
--
-- profiles.rejected_at / rejected_reason are read + written by both the admin app
-- (BrokerApprovals reject/filter, AdminUsers deactivate/reactivate) and the broker
-- app (reapply gate, signup upsert), but they were added out-of-band to the live DB
-- and never captured in a migration. They ALREADY EXIST on the live database, so
-- this migration is purely source-of-truth hygiene: it makes a fresh build / staging
-- clone match production. Idempotent (`add column if not exists`) — safe to re-run.
--
-- Set by admin on rejection; cleared implicitly when a broker reapplies + is later
-- approved. Both nullable: null = not rejected.

alter table public.profiles add column if not exists rejected_at     timestamptz;
alter table public.profiles add column if not exists rejected_reason text;

-- These are self-editable narrative/state columns, NOT privileged (they mirror the
-- admin decision the broker is allowed to see + act on), so they are intentionally
-- left out of guard_profile_privileged_columns (0016). No RLS change needed:
-- profiles_update_admin already lets admins write them; profiles_select_own /
-- _select_admin already let the owner + admins read them.
