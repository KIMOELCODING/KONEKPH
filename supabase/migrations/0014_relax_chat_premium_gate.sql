-- Konek.PH — Relax Premium gating on chat for dev mode + fan-out message
-- notifications to recipient's bell.
--
-- 0003_messaging_billing.sql shipped triggers that BLOCK conversations and
-- messages unless BOTH participants have subscription_tier='premium'. Per the
-- [[project-billing-gates-deferred]] decision (mirrors 0011_relax_listing_gate),
-- we drop these triggers so chat is usable during development. Re-apply the
-- triggers from 0003 when billing lands.
--
-- Also: when a message is sent, insert a notification for the recipient so the
-- existing bell (k-notifications) pings even when the recipient is on a
-- different page. SECURITY DEFINER so the trigger can write to notifications
-- regardless of the sender's RLS context.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- 1. Drop the Premium-gate triggers (function intentionally left in place so
-- re-enabling is a single `create trigger` apart).
drop trigger if exists conversations_enforce_premium on public.conversations;
drop trigger if exists messages_enforce_premium      on public.messages;

-- 2. Message-recipient notification trigger.
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

drop trigger if exists messages_notify_recipient on public.messages;
create trigger messages_notify_recipient
  after insert on public.messages
  for each row execute function public.notify_message_recipient();
