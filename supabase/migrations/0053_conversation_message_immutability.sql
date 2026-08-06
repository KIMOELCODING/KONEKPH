-- ============================================================
-- 0053_conversation_message_immutability.sql
-- SECURITY FIX (CRITICAL) — conversation-hijack escalation.
--
-- Found in the security sweep: the `conversations` UPDATE policy
-- (conversations_participant_update) is USING (auth.uid() in (participant_a,
-- participant_b)) with an EMPTY WITH CHECK — which Postgres defaults to the USING
-- expression — and there was NO immutability trigger on the table. Because the
-- attacker stays as one participant, the defaulted WITH CHECK still passes when
-- they rewrite the OTHER participant column. So any authenticated participant A of
-- conversation (A,B) could:
--   update public.conversations set participant_b = C where id = <conv>;
-- replacing B with an arbitrary broker C. Consequences:
--   * C becomes a participant -> messages_participant_select lets C read the
--     ENTIRE prior message history (B's private messages exposed to C).
--   * B is evicted -> B can no longer read/reply (tampering / denial).
-- Proven live (rolled back): participant_a rewrote participant_b to an arbitrary
-- third broker, rows=1, change persisted within the aborted tx.
--
-- Same CLASS as the broker_directory bug (an over-broad write reaching past the
-- intended row-ownership boundary), different mechanism (missing WITH CHECK +
-- missing immutability guard rather than a writable security-definer view).
--
-- FIX: a BEFORE UPDATE trigger that freezes the participant identity columns for
-- non-admin, non-system callers — mirroring lr_guard_immutable and
-- guard_profile_privileged_columns. Participants legitimately never change; the
-- preview/updated_at columns stay mutable (set by triggers / the app), only
-- participant_a + participant_b are pinned.
--
-- NOTE ON THE MESSAGES SIBLING (messages_owner_update): tested live in the same
-- sweep and found ALREADY BLOCKED by existing RLS — repointing a message's
-- conversation_id into a conversation the sender is not part of raises 42501
-- (the resulting row must satisfy the participation predicate), and forging
-- sender_id raises 42501 (WITH CHECK sender_id = auth.uid()). Legit edits
-- (edit_message body/edited_at, soft-delete deleted_at, receipts read_at/
-- delivered_at, pin pinned_at, same-conversation updates) all still pass. No
-- messages guard is added here, to avoid altering working messaging behavior.
-- ============================================================

create or replace function public.guard_conversation_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Trusted paths: SECURITY DEFINER / service-role (auth.uid() is null) and admins
  -- (who may legitimately administer conversations) pass through unchanged.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  -- Everyone else: the participant identity columns are immutable on UPDATE.
  -- Freeze them to their prior values so a participant can never swap the
  -- counterparty (or evict them). All other columns remain mutable.
  new.participant_a := old.participant_a;
  new.participant_b := old.participant_b;
  return new;
end $$;

-- Function-grant hygiene (Supabase re-grants EXECUTE to public/anon on new
-- functions). A trigger function is never called directly; revoke the ambient
-- grants so it cannot be invoked outside the trigger.
revoke all on function public.guard_conversation_participants() from public, anon;

drop trigger if exists conversations_guard_participants on public.conversations;
create trigger conversations_guard_participants
  before update on public.conversations
  for each row execute function public.guard_conversation_participants();
