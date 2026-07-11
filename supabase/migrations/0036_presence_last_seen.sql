-- ProList — Messaging Phase 3: online presence + last-seen.
--
-- ADDITIVE ONLY. No existing columns are changed.
--   1. profiles.last_seen_at (nullable timestamptz) — persistent "last active"
--      stamp, written low-frequency by the client (60s interval while visible +
--      on tab hide/unload), NOT per message.
--   2. broker_directory view — reproduced from 0022 (exact column list + order)
--      with last_seen_at appended at the end, so a broker can read a peer's
--      last-seen through the same safe view already used for name/avatar/license
--      (peer profiles reads are RLS-blocked since 0017).
--   3. touch_last_seen() — SECURITY DEFINER RPC that stamps ONLY the caller's own
--      row (where id = auth.uid()), so it is structurally impossible to write
--      another user's last_seen_at. Complements profiles_update_self (0001,
--      using auth.uid() = id); the 0016 privileged-column guard leaves new
--      non-privileged columns like last_seen_at writable.
--
-- Ephemeral online/away presence is Supabase Realtime Presence on a dedicated
-- 'presence:online' channel (client-side only) — no DB heartbeat, nothing here.
--
-- Idempotent. Apply: Dashboard -> SQL Editor -> paste -> Run.

-- 1. column ---------------------------------------------------------------
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- 2. broker_directory (0022 column list, in order) + last_seen_at appended ---
create or replace view public.broker_directory as
  select id, first_name, last_name, avatar_url, title, agency,
         license_number, bio, specialties, service_areas, closed_deals_count,
         created_at, last_seen_at
  from public.profiles
  where is_approved = true and role = 'broker';

grant select on public.broker_directory to authenticated;

-- 3. own-row last-seen touch ---------------------------------------------
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

grant execute on function public.touch_last_seen() to authenticated;
