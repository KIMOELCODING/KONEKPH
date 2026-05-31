-- Konek.PH — Security hardening: lock privileged columns + safe broker view.
--
-- Closes three RLS gaps found in the 2026-05-31 security pass. Postgres RLS is
-- ROW-level, not COLUMN-level, so `profiles_update_self` / `listings_update_own`
-- (0001) let a user change ANY column of their own row — including role,
-- is_approved, subscription_*, and listing.featured / approval stamps.
--
-- This migration adds BEFORE INSERT/UPDATE triggers that pin those privileged
-- columns for non-admins, and adds a safe `broker_directory` view that exposes
-- only non-sensitive broker fields (no phone / ID-doc paths / billing internals).
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- NOTE: the final DROP POLICY block is intentionally left COMMENTED OUT — only
-- run it AFTER the frontend reads are repointed to broker_directory (see §3).

-- ============================================================
-- 1. profiles — pin privileged columns for non-admins
-- ============================================================
-- Without this, any authenticated broker can self-escalate:
--   update profiles set role='admin'  where id = auth.uid();   -- becomes admin
--   update profiles set is_approved=true ...                    -- skips review
--   update profiles set subscription_tier='premium' ...         -- free Premium
-- Admins (and service-role / definer contexts where auth.uid() is null) bypass.

create or replace function public.guard_profile_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service-role / SECURITY DEFINER paths (signup trigger, edge functions):
  -- auth.uid() is null -> trusted, allow as-is.
  if auth.uid() is null then
    return new;
  end if;

  -- Admins may set anything (approvals, tier changes, quota overrides).
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Never let a client seed privileged state on signup.
    new.role                    := 'broker';
    new.is_approved             := false;
    new.approved_at             := null;
    new.approved_by             := null;
    new.subscription_status     := 'pending_approval';
    new.subscription_tier       := 'regular';
    new.subscription_started_at := null;
    new.subscription_ends_at    := null;
    new.trial_started_at        := null;
    new.trial_ends_at           := null;
    new.monthly_listing_quota   := 10;
    new.closed_deals_count      := 0;
    return new;
  end if;

  -- UPDATE by a non-admin: freeze every privileged column to its prior value.
  -- Self-editable fields (names, phone, avatar, bio, agency, title, license,
  -- ID-doc paths, specialties, service_areas, tos_accepted_at) are untouched.
  new.role                    := old.role;
  new.is_approved             := old.is_approved;
  new.approved_at             := old.approved_at;
  new.approved_by             := old.approved_by;
  new.subscription_status     := old.subscription_status;
  new.subscription_tier       := old.subscription_tier;
  new.subscription_started_at := old.subscription_started_at;
  new.subscription_ends_at    := old.subscription_ends_at;
  new.trial_started_at        := old.trial_started_at;
  new.trial_ends_at           := old.trial_ends_at;
  new.monthly_listing_quota   := old.monthly_listing_quota;
  new.closed_deals_count      := old.closed_deals_count;
  return new;
end $$;

-- Runs alphabetically AFTER profiles_apply_tier_quota, so for non-admins this
-- guard has the final say on tier/quota (correct: they can't change either).
drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- ============================================================
-- 2. listings — pin featured / approval columns for non-admins
-- ============================================================
-- reset_listing_on_edit (0001) only re-pends on CONTENT changes, so it misses
-- a broker flipping `featured=true` (free hero placement) or stamping fake
-- approved_by/approved_at. view_count is intentionally NOT pinned here so the
-- bump_view_count() RPC (0006) keeps working.

create or replace function public.guard_listing_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role = 'admin' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.featured    := false;
    new.approved_by := null;
    new.approved_at := null;
    new.status      := 'pending';
    return new;
  end if;

  new.featured    := old.featured;
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  return new;
end $$;

-- Runs before listings_reset_on_edit (alphabetical: guard < reset); both end
-- up forcing non-admin edits to a non-elevated, pending state.
drop trigger if exists listings_guard_privileged on public.listings;
create trigger listings_guard_privileged
  before insert or update on public.listings
  for each row execute function public.guard_listing_privileged_columns();

-- ============================================================
-- 3. broker_directory — safe public view of approved brokers
-- ============================================================
-- Exposes ONLY non-sensitive fields. Owned by postgres, so it reads past the
-- (about-to-be-tightened) profiles RLS while still hiding phone, id_photo_url,
-- prc_id_url, and all subscription/billing/quota columns.

create or replace view public.broker_directory as
  select id, first_name, last_name, email, avatar_url, title, agency,
         license_number, bio, specialties, service_areas, closed_deals_count,
         created_at
  from public.profiles
  where is_approved = true and role = 'broker';

grant select on public.broker_directory to authenticated;

-- ------------------------------------------------------------
-- 3b. The peer-read leak (profiles_select_brokers exposing phone / billing /
-- id-doc paths to any broker) is closed in 0017_restrict_profiles_peer_reads.sql,
-- which drops that policy AFTER the two frontend cross-broker reads (listing-
-- detail contact + chat list) are repointed to this broker_directory view.
-- Apply 0017 after deploying the matching index.html.
-- ------------------------------------------------------------
