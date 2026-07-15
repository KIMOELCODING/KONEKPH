-- ProList — Mute chat (Phase E1).
--
-- Wires the dormant conversation_states.is_muted column into the ONE place a chat
-- message produces a notification: the AFTER-INSERT trigger notify_message_recipient
-- (0014). When the recipient has muted that conversation, the trigger skips
-- inserting the type='message' bell notification. Everything else is unchanged.
--
-- This is a trigger-function amendment ONLY: no new columns (is_muted already
-- exists, 0003), no new RLS (conversation_states_owner_all already lets a user
-- read/write their own state). The function body below is copied verbatim from
-- 0014 with a SINGLE mute short-circuit added after the self-notify guard.
--
-- SCOPE: simple on/off via is_muted. Timed mutes (a muted_until timestamptz for
-- 15m/1h/24h) are deferred — would need a new column.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

create or replace function public.notify_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv      record;
  recipient uuid;
  sender_nm text;
  preview   text;
begin
  select participant_a, participant_b
    into conv
    from public.conversations
   where id = new.conversation_id;

  if conv is null then
    return new;
  end if;

  recipient := case
    when new.sender_id = conv.participant_a then conv.participant_b
    else conv.participant_a
  end;

  -- Defence in depth: never notify yourself.
  if recipient is null or recipient = new.sender_id then
    return new;
  end if;

  -- E1 — respect the recipient's per-conversation mute. A missing conversation_states
  -- row means NOT muted (EXISTS is false -> fall through and insert as before).
  if exists (
    select 1 from public.conversation_states
     where user_id = recipient
       and conversation_id = new.conversation_id
       and is_muted = true
  ) then
    return new;               -- muted: skip the bell notification, change nothing else
  end if;

  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), 'New message')
    into sender_nm
    from public.profiles
   where id = new.sender_id;

  preview := left(
    coalesce(nullif(new.body, ''), '[listing inquiry]'),
    80
  );

  insert into public.notifications(user_id, type, title, body)
    values (recipient, 'message', sender_nm, preview);

  return new;
end$$;

-- Re-issue the trigger (identical to 0014) so this migration is self-contained on
-- a fresh DB. create-or-replace-function already preserves the existing binding.
drop trigger if exists messages_notify_recipient on public.messages;
create trigger messages_notify_recipient
  after insert on public.messages
  for each row execute function public.notify_message_recipient();
