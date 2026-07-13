-- ProList — Chat attachments backend (Phase B1).
--
-- Enables image + file (jpg/png/webp + pdf/docx/xlsx) attachments on chat
-- messages, stored PRIVATELY and readable only by the two participants of the
-- conversation (plus admins, for Report-User moderation — consistent with the
-- moa-documents / id-documents private buckets).
--
-- Additive & idempotent: new nullable columns, a new private bucket, a new
-- SECURITY DEFINER participant helper, and new storage.objects RLS policies.
-- Nothing existing (columns / policies / data) is altered.
--
-- Frontend (composer attach UI, buildBubble image/file bubbles, signed-URL
-- rendering) is Phase B2 — NOT in this migration.
--
-- NOTE: the bucket is PRIVATE (public=false), so getPublicUrl (window.__plImg)
-- will NOT authorize reads — B2 must render attachments via createSignedUrl
-- (the pattern used for moa-documents).
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- ============================================================
-- 1. Schema — new nullable attachment columns on public.messages
-- ============================================================
alter table public.messages
  add column if not exists attachment_type text,   -- 'image' | 'file'
  add column if not exists attachment_path text,    -- generic storage key: {conversation_id}/{filename}
  add column if not exists file_name       text,
  add column if not exists file_size       bigint,
  add column if not exists mime_type        text;

-- CHECK constraint on attachment_type (idempotent add).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_attachment_type_chk'
  ) then
    alter table public.messages
      add constraint messages_attachment_type_chk
      check (attachment_type is null or attachment_type in ('image','file'));
  end if;
end$$;

-- ============================================================
-- 2. Private bucket + size/MIME allow-list (0018-style config)
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

update storage.buckets
   set file_size_limit    = 10485760,  -- 10 MB
       allowed_mime_types = array[
         'image/jpeg','image/png','image/webp',
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  -- docx
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'         -- xlsx
       ]
 where id = 'message-attachments';

-- ============================================================
-- 3. Participant helper — SECURITY DEFINER to avoid RLS recursion into
--    conversations. Uses the SAME two participant columns the existing
--    messages_participant_select policy uses (0003).
-- ============================================================
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and auth.uid() in (c.participant_a, c.participant_b)
  );
$$;

revoke execute on function public.is_conversation_participant(uuid) from public;
grant  execute on function public.is_conversation_participant(uuid) to authenticated;

-- ============================================================
-- 4. Storage RLS on message-attachments — folder = {conversation_id}/{file}
--    The first path segment is the conversation id.
-- ============================================================

-- SELECT (read): participants OR admin (moderation). This is the critical
-- policy — a non-participant, non-admin must NOT read another conversation's file.
drop policy if exists "message_attachments participant read" on storage.objects;
create policy "message_attachments participant read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      public.is_conversation_participant(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

-- INSERT (write): participants only — a sender can only upload into a
-- conversation they belong to. No admin arm.
drop policy if exists "message_attachments participant write" on storage.objects;
create policy "message_attachments participant write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant(((storage.foldername(name))[1])::uuid)
  );

-- DELETE: participants only — no admin arm. (No UPDATE policy: objects are
-- immutable; uploads use upsert:false.)
drop policy if exists "message_attachments participant delete" on storage.objects;
create policy "message_attachments participant delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant(((storage.foldername(name))[1])::uuid)
  );
