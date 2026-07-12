-- Konek.PH (ProList) — broker-controlled listing status (active <-> archive)
--
-- The broker-facing "Your Listings" page gets a Mark-as-Inactive / Restore flow.
-- Storage value stays 'archive' (displayed as "Inactive"); 'active' is live.
--
-- WHY AN RPC: reset_listing_on_edit (0001) fires BEFORE UPDATE whenever status
-- (or title/price/description/images) changes and, for any non-admin actor,
-- forces status -> 'pending'. A plain client update({status:'archive'}) would
-- therefore dump a live listing back into the approval queue. SECURITY DEFINER
-- alone does NOT help: the trigger keys off auth.uid()'s ROLE (still the broker
-- inside a definer function), not the executing DB role.
--
-- BYPASS: a transaction-local GUC flag ('app.status_transition') that the trigger
-- honors. set_listing_status() sets it (is_local => this txn only, invisible to
-- every other statement/session) right before its UPDATE, so ONLY this trusted
-- transition path skips the pending-reset. Normal broker edits never set the flag
-- and keep resetting to 'pending' exactly as before.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- ============================================================
-- 1. Amend reset_listing_on_edit — honor the transition flag
-- ============================================================
-- Additive: identical behavior when the flag is unset (every normal edit path).
create or replace function public.reset_listing_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  -- Trusted status-transition path (set_listing_status RPC) bypasses the reset.
  if current_setting('app.status_transition', true) = 'on' then
    return new;
  end if;
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role is distinct from 'admin' then
    new.status := 'pending';
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end $$;

-- ============================================================
-- 2. set_listing_status(p_listing_id, p_status) — broker active<->archive only
-- ============================================================
create or replace function public.set_listing_status(p_listing_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare cur text; owner uuid;
begin
  select status, broker_id into cur, owner
    from public.listings where id = p_listing_id;

  if owner is null then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if owner is distinct from auth.uid() then
    raise exception 'Not your listing' using errcode = 'P0001';
  end if;
  -- Only broker-controlled active<->archive transitions. Anything else (reaching
  -- pending/rejected, or a no-op same-state) is rejected.
  if not ((cur = 'active'  and p_status = 'archive')
       or (cur = 'archive' and p_status = 'active')) then
    raise exception 'Transition not allowed: % -> %', cur, p_status using errcode = 'P0001';
  end if;

  -- Transaction-local: only THIS update skips the pending-reset trigger.
  perform set_config('app.status_transition', 'on', true);
  update public.listings
    set status = p_status, updated_at = now()
    where id = p_listing_id;
end $$;

-- Revoke the default PUBLIC grant (which anon/authenticated inherit) so only the
-- explicit authenticated grant remains.
revoke execute on function public.set_listing_status(uuid, text) from public;
grant  execute on function public.set_listing_status(uuid, text) to authenticated;
