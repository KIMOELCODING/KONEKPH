-- ProList — Edit message (Phase D4).
--
-- A sender may edit their own message within 30 minutes of sending. Additive:
-- one nullable column + one RPC. Nothing on existing policies/triggers changes.
--
-- Why an RPC (not a direct UPDATE): the 30-minute window is enforced HERE, in
-- edit_message. messages_owner_update RLS is `sender_id = auth.uid()` with NO
-- WITH CHECK, so a sender can already rewrite their own body via the raw API
-- forever — that direct-UPDATE hole is a KNOWN, ACCEPTED gap for now (D1's
-- soft-delete depends on messages_owner_update, so we do not tighten it). The
-- app's edit path goes through this RPC, which is where the window lives.
--
-- Off-platform contact-info is NOT re-checked here: the INSERT-time trigger
-- guard_message_contact_info (0022) already vetted the stored body, and the app
-- edit path re-runs the identical client-side __konekHasContactInfo() before
-- calling this RPC. Since messages_owner_update is open, an RPC-level regex would
-- protect nothing a raw UPDATE cannot bypass more cheaply. IMPORTANT: if
-- messages_owner_update is ever tightened to exclude `body` from what a sender
-- may UPDATE, then the 0022 contact regexes MUST be inlined into edit_message at
-- the same time — those two changes only make sense together (otherwise the app
-- edit path becomes the only unguarded way to smuggle contact info in).
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender  uuid;
  v_created timestamptz;
  v_deleted timestamptz;
begin
  select sender_id, created_at, deleted_at into v_sender, v_created, v_deleted
    from public.messages where id = p_message_id;

  if v_sender is null then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  -- Only the SENDER may edit their own message.
  if v_sender <> auth.uid() then
    raise exception 'Not your message' using errcode = 'P0001';
  end if;

  -- Can't edit a deleted message (if they want it gone, that's Delete).
  if v_deleted is not null then
    raise exception 'Cannot edit a deleted message' using errcode = 'P0001';
  end if;

  -- THE enforcement: the 30-minute edit window.
  if now() - v_created >= interval '30 minutes' then
    raise exception 'Edit window expired' using errcode = 'P0001';
  end if;

  -- An edit can't blank the message (empty = Delete, not Edit).
  if p_body is null or btrim(p_body) = '' then
    raise exception 'Message cannot be empty' using errcode = 'P0001';
  end if;

  -- Same length cap as the composer.
  if char_length(p_body) > 2000 then
    raise exception 'Message is too long' using errcode = 'P0001';
  end if;

  update public.messages
     set body = p_body, edited_at = now()
   where id = p_message_id;
end$$;

-- Lock down: only authenticated callers. Supabase default privileges re-grant
-- EXECUTE to anon/authenticated/service_role on new public functions, so revoke
-- anon explicitly too (mirrors set_message_pin / 0041).
revoke execute on function public.edit_message(uuid, text) from public;
revoke execute on function public.edit_message(uuid, text) from anon;
grant  execute on function public.edit_message(uuid, text) to authenticated;
