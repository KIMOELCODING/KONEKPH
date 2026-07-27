-- 0049_listing_reminders.sql
-- Reminders R1 — event-driven listing reminders (NO scheduler, NO pg_cron; purely
-- INSERT/UPDATE-triggered). Two OWNER-ONLY reminders delivered as notifications
-- rows via a SECURITY DEFINER trigger — the only path that satisfies notifications'
-- is_admin()-only INSERT RLS (mirrors notify_message_recipient):
--
--   * reminder_created — confirmation when a broker creates a listing. Status-aware
--     copy (pending -> "submitted for review"; active -> "is live"). INSERT only,
--     once. Never implies anything is wrong.
--   * reminder_photos  — an OPTIONAL suggestion to add more photos when a listing
--     has FEWER THAN 5. A brokermay deliberately list with 3-4 photos, so the copy
--     is a suggestion ("consider adding a few more"), NEVER a deficiency claim.
--     Delivered AT MOST ONCE per listing, ever.
--
-- Both are NEW notification `type` values that PASS THROUGH S2's
-- gate_notification_by_pref unchanged (not in its allowlist -> delivered by
-- default). No new preference gating in R1.
--
-- DEDUPE (no new column): once-per-listing is an EXISTS check for ANY prior
-- reminder_photos for the listing (read OR unread) — so reading/dismissing the
-- nudge never re-arms it. The photos nudge is re-evaluated on image-changing edits
-- (a listing edited down to <5 photos should still get the one-time suggestion),
-- but the UPDATE trigger's WHEN guard (old.images IS DISTINCT FROM new.images)
-- keeps view-count bumps and every non-image edit from firing it.

create or replace function public.notify_listing_reminders()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Creation confirmation — INSERT only, once. Reflects the real status flow.
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.broker_id,
      'reminder_created',
      case when new.status = 'active'
           then 'Your listing is live'
           else 'Listing submitted for review' end,
      new.title,
      new.id::text
    );
  end if;

  -- Photo suggestion — fewer than 5 photos, at most once per listing (read OR
  -- unread). OPTIONAL nudge, never a deficiency claim.
  if coalesce(array_length(new.images, 1), 0) < 5
     and not exists (
       select 1 from public.notifications
       where type = 'reminder_photos'
         and link = new.id::text
     ) then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.broker_id,
      'reminder_photos',
      'A tip to get more interest',
      'Listings with more photos tend to get more interest — consider adding a few more to "'
        || left(coalesce(new.title, 'your listing'), 60) || '".',
      new.id::text
    );
  end if;

  return new;
end $$;

-- INSERT: always evaluate both reminders.
drop trigger if exists listings_notify_reminders_ins on public.listings;
create trigger listings_notify_reminders_ins
  after insert on public.listings
  for each row execute function public.notify_listing_reminders();

-- UPDATE: only when the images array actually changes (never on view-count bumps
-- or other edits). tg_op='UPDATE' skips reminder_created; only the photos nudge
-- (guarded by its once-per-listing EXISTS check) can fire.
drop trigger if exists listings_notify_reminders_upd on public.listings;
create trigger listings_notify_reminders_upd
  after update on public.listings
  for each row when (old.images is distinct from new.images)
  execute function public.notify_listing_reminders();
