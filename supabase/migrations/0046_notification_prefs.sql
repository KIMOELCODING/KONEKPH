-- 0046_notification_prefs.sql — per-user in-app notification gating (Settings S2)
--
-- A single BEFORE INSERT trigger on notifications that skips the insert when the
-- RECIPIENT (new.user_id) has explicitly disabled that notification type in
-- profiles.preferences (S1's jsonb bag). Only the 4 real broker-facing types are
-- gateable; everything else — account notifications (broker_approved/rejected),
-- the admin fan-out types (broker_signup/new_listing/moa_signed/…), and any
-- future/unknown type — passes through UNCONDITIONALLY and can never be
-- suppressed. Default ON: an absent key, absent prefs row, or true ⇒ insert.
--
-- Composition with 0043 mute: notify_message_recipient checks conversation_states
-- .is_muted and returns BEFORE its insert, so a muted conversation never reaches
-- this trigger. This trigger acts AT the insert (the global "New Messages" pref).
-- The two suppress independently — do not duplicate mute logic here.
--
-- SECURITY DEFINER + fixed search_path so it reads profiles.preferences regardless
-- of the caller's RLS context (message trigger = definer, admin app = admin,
-- moa/notify-broker = service role). No schema or RLS change. Idempotent.
--
-- Pref keys (must match the k-settings toggles exactly):
--   notif_message → New Messages   (type: message)
--   notif_listing → Listing Updates(types: listing_approved, listing_rejected)
--   notif_moa     → MOA Ready       (type: moa_sent)

create or replace function public.gate_notification_by_pref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text;
  v_prefs jsonb;
begin
  -- ALLOWLIST: map ONLY the gateable types to a pref key.
  v_key := case new.type
    when 'message'          then 'notif_message'
    when 'listing_approved' then 'notif_listing'
    when 'listing_rejected' then 'notif_listing'
    when 'moa_sent'         then 'notif_moa'
    else null
  end;

  -- SAFETY: any non-gated / unknown type is inserted unconditionally.
  if v_key is null then
    return new;
  end if;

  select preferences into v_prefs from public.profiles where id = new.user_id;

  -- Skip ONLY when the key is explicitly false. Absent key / absent prefs / null
  -- / true all fall through to the insert (default ON).
  if v_prefs is not null and (v_prefs ->> v_key) = 'false' then
    return null;
  end if;

  return new;
end $$;

drop trigger if exists notifications_gate_by_pref on public.notifications;
create trigger notifications_gate_by_pref
  before insert on public.notifications
  for each row execute function public.gate_notification_by_pref();
