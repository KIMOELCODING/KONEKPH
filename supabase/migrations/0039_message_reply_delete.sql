-- ProList — Message reply + soft-delete (Phase D1).
--
-- Additive & idempotent: two nullable columns on public.messages. No changes to
-- existing columns, policies, or triggers.
--   - reply_to_message_id: the message this one replies to (nullable FK; if the
--     original is hard-deleted the reference nulls out rather than cascading).
--   - deleted_at: soft-delete tombstone marker. Sender sets it via the existing
--     messages_owner_update RLS (sender_id = auth.uid()); rendered as a tombstone
--     for BOTH participants (MVP = "delete for everyone", no delete-for-me).
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null,
  add column if not exists deleted_at timestamptz;
