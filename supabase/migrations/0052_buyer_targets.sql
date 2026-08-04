-- 0052_buyer_targets.sql  (additive)
-- Property Matching Phase 1 — NOTIFY-AND-FORGET. A broker posts a buyer-target
-- ("client wants [type] in [city], budget up to [X]"); brokers who have an ACTIVE
-- listing in that city are notified via a SECURITY DEFINER trigger and reach out
-- through existing chat. The post row is PRIVATE to the poster (owner + admin
-- SELECT) — matchers never read it; the notification body carries the details.
--
-- The unused `referrals` shell is LEFT IN PLACE (not dropped): it still has RLS
-- policies attached and full read-safety can't be fully proven, so per the safe
-- call we don't touch it. buyer_targets is a brand-new, separate table.
--
-- SECURITY: base table with RLS ENABLED (the floor that neutralizes the default
-- anon/authenticated grant-all). INSERT gated on ownership only — NEVER premium
-- (the referrals shell's premium_insert blocks everyone; not repeated). Single-owner
-- CRUD, so direct DML under RLS is sufficient — no RPC. Direct DML: with_check
-- (from_broker_id = auth.uid()) prevents forging; owner-only update/delete prevents
-- tampering. The only privileged work (reading other brokers' listings + inserting
-- notifications) lives in the SECURITY DEFINER match trigger.

create table public.buyer_targets (
  id             uuid primary key default gen_random_uuid(),
  from_broker_id uuid not null references public.profiles(id) on delete cascade,
  property_type  text,
  target_city    text not null,             -- the match key (matched against listings.city)
  target_region  text,
  budget_min     numeric,
  budget_max     numeric,
  bedrooms       integer,
  buyer_notes    text,
  status         text not null default 'active' check (status in ('active','fulfilled','closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index buyer_targets_city_status_idx on public.buyer_targets(target_city, status);
create index buyer_targets_owner_idx        on public.buyer_targets(from_broker_id, status);

create trigger buyer_targets_set_updated_at before update on public.buyer_targets
  for each row execute function public.set_updated_at();

-- ===== RLS — OWNER-PRIVATE (notify-and-forget) =====
alter table public.buyer_targets enable row level security;
create policy bt_select on public.buyer_targets for select
  using (is_admin() or from_broker_id = auth.uid());
create policy bt_insert on public.buyer_targets for insert
  with check (from_broker_id = auth.uid());            -- ownership only, NO premium
create policy bt_update on public.buyer_targets for update
  using (from_broker_id = auth.uid()) with check (from_broker_id = auth.uid());
create policy bt_delete on public.buyer_targets for delete
  using (from_broker_id = auth.uid());
revoke all on public.buyer_targets from anon;          -- hygiene; RLS is the real floor

-- ===== The match trigger (SECURITY DEFINER, AFTER INSERT) =====
-- City match is case- AND whitespace-insensitive: lower(trim()) on BOTH sides.
-- Self-excluded; DISTINCT broker → ONE notification per matching broker; fires
-- ONCE on INSERT only (no AFTER UPDATE trigger → edits never re-broadcast).
create or replace function public.notify_buyer_target_matches()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select distinct l.broker_id,
         'buyer_match',
         'Buyer match',
         'A broker is looking for ' || coalesce(nullif(trim(new.property_type),''),'a property')
           || ' in ' || new.target_city
           || case when new.budget_max is not null
                   then ' (budget up to ₱' || trim(to_char(new.budget_max,'FM999,999,999,999'))
                   else '' end
           || case when new.budget_max is not null then ')' else '' end
           || ' — you have a matching listing. Reach out to connect.',
         new.from_broker_id::text                          -- link = poster → chat entry
  from public.listings l
  where l.status = 'active'
    and lower(trim(l.city)) = lower(trim(new.target_city))
    and l.broker_id <> new.from_broker_id;
  return new;
end $$;

create trigger buyer_targets_notify_matches
  after insert on public.buyer_targets
  for each row execute function public.notify_buyer_target_matches();
