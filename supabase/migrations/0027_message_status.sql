-- ProList — Message delivery/read status (Sent / Delivered / Seen).
--
-- The chat already had messages.read_at but nothing set it (markRead only
-- upserted conversation_states.last_read_at), and the messages_owner_update
-- RLS policy lets ONLY the sender update a row — so a recipient can't mark the
-- sender's message delivered/read. This migration adds:
--   1. messages.delivered_at — set when the recipient's client receives the
--      message (realtime) but hasn't opened the conversation yet.
--   2. Two SECURITY DEFINER RPCs the recipient calls; they bypass the
--      sender-only UPDATE policy but only ever touch delivered_at / read_at on
--      messages the caller did NOT send, and only for conversations the caller
--      participates in. No broad UPDATE policy (which would also expose body).
--
-- Sender reads read_at/delivered_at via the existing participant SELECT policy,
-- and gets live changes through a postgres_changes UPDATE subscription.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

alter table public.messages
  add column if not exists delivered_at timestamptz;

-- Recipient acks receipt (Delivered ✓✓). Marks every message in the
-- conversation NOT sent by the caller whose delivered_at is still null.
create or replace function public.mark_conversation_delivered(p_conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conv
       and auth.uid() in (c.participant_a, c.participant_b)
  ) then
    return; -- not a participant: silently no-op
  end if;

  update public.messages
     set delivered_at = now()
   where conversation_id = p_conv
     and sender_id <> auth.uid()
     and delivered_at is null;
end$$;

-- Recipient opened the conversation (Seen). Sets read_at (and back-fills
-- delivered_at if it was skipped, e.g. message arrived while offline).
create or replace function public.mark_conversation_seen(p_conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conv
       and auth.uid() in (c.participant_a, c.participant_b)
  ) then
    return;
  end if;

  update public.messages
     set read_at      = now(),
         delivered_at = coalesce(delivered_at, now())
   where conversation_id = p_conv
     and sender_id <> auth.uid()
     and read_at is null;
end$$;

grant execute on function public.mark_conversation_delivered(uuid) to authenticated;
grant execute on function public.mark_conversation_seen(uuid)      to authenticated;
