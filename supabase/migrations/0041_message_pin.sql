-- ProList — Pin messages (Phase D3).
--
-- Conversation-wide pins: either participant can pin ANY message in the
-- conversation (their own or the other party's); both see the same pins;
-- multiple pins allowed. Additive: one nullable column + one RPC. Nothing
-- on existing policies/triggers changes.
--
-- Why an RPC (not a direct UPDATE): messages_owner_update restricts UPDATE to
-- sender_id = auth.uid(), so a participant cannot pin the OTHER party's rows
-- via a plain UPDATE. Rather than loosen that policy (it is exactly what stops
-- a peer editing your body), pinning goes through a SECURITY DEFINER RPC that
-- authorizes on is_conversation_participant() and only ever writes pinned_at.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

alter table public.messages add column if not exists pinned_at timestamptz;

create or replace function public.set_message_pin(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv    uuid;
  v_deleted timestamptz;
begin
  select conversation_id, deleted_at into v_conv, v_deleted
    from public.messages where id = p_message_id;

  if v_conv is null then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if not public.is_conversation_participant(v_conv) then
    raise exception 'Not your conversation' using errcode = 'P0001';
  end if;

  -- Reject pinning a deleted message; unpinning one is still allowed (cleanup).
  if p_pinned and v_deleted is not null then
    raise exception 'Cannot pin a deleted message' using errcode = 'P0001';
  end if;

  update public.messages
     set pinned_at = case when p_pinned then now() else null end
   where id = p_message_id;
end$$;

-- Lock down: only authenticated callers. Supabase default privileges re-grant
-- EXECUTE to anon/authenticated/service_role on new public functions, so revoke
-- anon explicitly too (mirrors set_listing_status / 0037).
revoke execute on function public.set_message_pin(uuid, boolean) from public;
revoke execute on function public.set_message_pin(uuid, boolean) from anon;
grant  execute on function public.set_message_pin(uuid, boolean) to authenticated;
