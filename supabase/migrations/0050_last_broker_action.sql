-- 0050_last_broker_action.sql  (additive)
-- Reminders R2a — the inactivity SIGNAL. Adds last_broker_action_at to listings:
-- "the timestamp the listing's OWN broker last did something to it." This is the
-- foundation R2b's inactivity sweep needs.
--
-- WHY: listings.updated_at is NOT an inactivity signal — bump_view_count() does
-- `update listings set view_count = view_count + 1` on every view, and the
-- unconditional set_updated_at() trigger moves updated_at each time. So a
-- viewed-but-untouched listing looks perpetually fresh. last_broker_action_at is
-- immune to views (and to admin/system writes) by design.
--
-- DISCRIMINATOR (the (d) vs (e) problem): admin approve/reject and a broker's own
-- inactive/restore BOTH change `status`. We separate them by ACTOR, not by column:
-- the bump fires only when auth.uid() = the listing's broker_id. So:
--   * broker content edit (owner)                  -> bump
--   * broker inactive/restore via set_listing_status (owner, auth.uid preserved
--     through SECURITY DEFINER) -> bump
--   * admin approve/reject (auth.uid = admin <> broker_id) -> NO bump
--   * view bump / system / service-role writes (auth.uid() <> broker_id or null) -> NO bump
--
-- Additive only. Does NOT touch bump_view_count, set_updated_at,
-- reset_listing_on_edit, guard_listing_privileged_columns, or the 0047/0048
-- broker_directory lockdown.

-- 1. Column + INSERT default. New listings get now() at creation (no trigger needed).
alter table public.listings
  add column if not exists last_broker_action_at timestamptz not null default now();

-- 2. Backfill existing rows to created_at — a sensible "last action" baseline.
--    NOT updated_at (view-polluted).
update public.listings set last_broker_action_at = created_at;

-- 3. WHITELIST bump: only the listing's own broker, and only when a broker-editable
--    column (content) or status actually changed. Views (view_count only) and admin
--    status changes (actor <> broker_id) never match.
create or replace function public.set_last_broker_action()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not distinct from new.broker_id
     and (
       new.title          is distinct from old.title          or
       new.price          is distinct from old.price          or
       new.description    is distinct from old.description    or
       new.images         is distinct from old.images         or
       new.category       is distinct from old.category       or
       new.property_type  is distinct from old.property_type  or
       new.region         is distinct from old.region         or
       new.province       is distinct from old.province       or
       new.city           is distinct from old.city           or
       new.barangay       is distinct from old.barangay       or
       new.street_address is distinct from old.street_address or
       new.lot_area_sqm   is distinct from old.lot_area_sqm   or
       new.floor_area_sqm is distinct from old.floor_area_sqm or
       new.bedrooms       is distinct from old.bedrooms       or
       new.bathrooms      is distinct from old.bathrooms      or
       new.amenities      is distinct from old.amenities      or
       new.details        is distinct from old.details        or
       new.status         is distinct from old.status
     )
  then
    new.last_broker_action_at := now();
  end if;
  return new;
end $$;

drop trigger if exists listings_set_broker_action on public.listings;
create trigger listings_set_broker_action
  before update on public.listings
  for each row execute function public.set_last_broker_action();
