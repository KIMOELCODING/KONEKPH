-- Konek.PH — Fix "new row violates RLS policy for conversation_states" on send.
--
-- ROOT CAUSE: messages_upsert_conversation_state (0003) fires AFTER INSERT on
-- messages and seeds a conversation_states row for the RECIPIENT (user_id =
-- the other participant) so their unread count works. But upsert_conversation_state()
-- was defined WITHOUT security definer, so it runs as the message SENDER. The
-- conversation_states policy is `with check (user_id = auth.uid())`, so the
-- recipient-row insert (user_id != auth.uid()) is rejected with 42501 — which
-- rolls back the whole message insert and surfaces as a 403 on send.
--
-- Every other cross-user trigger in the schema (handle_new_user,
-- notify_message_recipient, guard_*) is security definer; this one was missed.
--
-- FIX: recreate the function as SECURITY DEFINER (search_path pinned) so it can
-- seed the recipient's state row. The logic is unchanged and still only writes
-- rows for the two participants of the message's own conversation.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

create or replace function public.upsert_conversation_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv record;
  recipient uuid;
begin
  select participant_a, participant_b into conv from public.conversations where id = new.conversation_id;
  recipient := case when new.sender_id = conv.participant_a then conv.participant_b else conv.participant_a end;

  insert into public.conversation_states(user_id, conversation_id)
    values (recipient, new.conversation_id)
    on conflict (user_id, conversation_id) do nothing;

  insert into public.conversation_states(user_id, conversation_id, last_read_at)
    values (new.sender_id, new.conversation_id, now())
    on conflict (user_id, conversation_id)
    do update set last_read_at = now();

  return new;
end$$;

drop trigger if exists messages_upsert_conversation_state on public.messages;
create trigger messages_upsert_conversation_state
  after insert on public.messages
  for each row execute function public.upsert_conversation_state();
