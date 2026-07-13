-- ProList — Message reactions (Phase D2).
--
-- One reaction per user per message (Like / Love / Happy / Celebrate / Sad),
-- stored as stable string keys (rendered to unicode client-side). Additive:
-- new table + RLS + publication only; nothing on messages changes.
--
-- RLS join-through: reactions carry message_id (not conversation_id), so every
-- policy resolves the reacted message's conversation and reuses the existing
-- is_conversation_participant() SECURITY DEFINER helper (from B1 / 0038).
--
-- replica identity full: so a reaction-removal DELETE carries message_id/user_id
-- in the realtime payload.old (default PK-only identity would not let the client
-- map the delete back to a message).
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

create table if not exists public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null check (emoji in ('like','love','happy','celebrate','sad')),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id)
);
create index if not exists message_reactions_message_idx on public.message_reactions(message_id);

alter table public.message_reactions enable row level security;
alter table public.message_reactions replica identity full;

-- SELECT: any participant of the reacted message's conversation.
drop policy if exists message_reactions_participant_select on public.message_reactions;
create policy message_reactions_participant_select on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

-- INSERT: only your OWN reaction, on a message in a conversation you're in.
drop policy if exists message_reactions_owner_insert on public.message_reactions;
create policy message_reactions_owner_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

-- UPDATE: only your OWN reaction (enables upsert emoji-switch via ON CONFLICT).
drop policy if exists message_reactions_owner_update on public.message_reactions;
create policy message_reactions_owner_update on public.message_reactions
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

-- DELETE: only your OWN reaction, on a message in a conversation you're in.
drop policy if exists message_reactions_owner_delete on public.message_reactions;
create policy message_reactions_owner_delete on public.message_reactions
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

-- Realtime publication (guarded add).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.message_reactions';
  end if;
end$$;
