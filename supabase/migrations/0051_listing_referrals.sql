-- 0051_listing_referrals.sql  (additive)
-- Direct Referrals Phase 1 — a broker hands a specific LISTING to another broker
-- with a commission split; recipient accepts/declines; sender tracks to
-- completed / closed_lost. Self-contained (does NOT write to deals). SEPARATE from
-- the buyer-target `referrals` shell (untouched — that stays for Property Matching).
--
-- SECURITY MODEL (the lesson from broker_directory): this is a base TABLE with RLS
-- ENABLED, which neutralizes the default anon/authenticated grant-all. All writes go
-- through SECURITY DEFINER RPCs; direct INSERT/UPDATE/DELETE are REVOKED from
-- anon+authenticated (defense-in-depth). NO premium gate (billing dormant — a
-- premium gate blocks everyone, the shell's bug). The financial split
-- (commission_pct) and participants are IMMUTABLE after insert via a trigger, so
-- immutability holds regardless of write path.

create table public.listing_referrals (
  id             uuid primary key default gen_random_uuid(),
  from_broker_id uuid not null references public.profiles(id) on delete cascade,
  to_broker_id   uuid not null references public.profiles(id) on delete cascade,
  listing_id     uuid not null references public.listings(id) on delete cascade,
  commission_pct numeric not null check (commission_pct > 0 and commission_pct <= 100),
  client_note    text,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','cancelled','completed','closed_lost')),
  responded_at   timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (from_broker_id <> to_broker_id)
);
create index listing_referrals_to_status_idx   on public.listing_referrals(to_broker_id, status);
create index listing_referrals_from_status_idx on public.listing_referrals(from_broker_id, status);

create trigger listing_referrals_set_updated_at before update on public.listing_referrals
  for each row execute function public.set_updated_at();

-- Immutability of participants + financial split after insert (data-layer invariant).
create or replace function public.lr_guard_immutable()
returns trigger language plpgsql as $$
begin
  if new.from_broker_id is distinct from old.from_broker_id
     or new.to_broker_id is distinct from old.to_broker_id
     or new.listing_id   is distinct from old.listing_id
     or new.commission_pct is distinct from old.commission_pct then
    raise exception 'referral participants and commission are immutable' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger listing_referrals_immutable before update on public.listing_referrals
  for each row execute function public.lr_guard_immutable();

-- ===== RLS (the security floor) =====
alter table public.listing_referrals enable row level security;

create policy lr_select on public.listing_referrals for select
  using (is_admin() or auth.uid() = from_broker_id or auth.uid() = to_broker_id);

-- INSERT backstop (RPC also enforces): self is sender, sender owns the listing,
-- from<>to. NO premium clause.
create policy lr_insert on public.listing_referrals for insert
  with check (
    from_broker_id = auth.uid()
    and from_broker_id <> to_broker_id
    and exists (select 1 from public.listings l where l.id = listing_id and l.broker_id = auth.uid())
  );

-- UPDATE backstop: participant-only (valid transitions enforced in the RPCs).
create policy lr_update on public.listing_referrals for update
  using      (is_admin() or auth.uid() = from_broker_id or auth.uid() = to_broker_id)
  with check (is_admin() or auth.uid() = from_broker_id or auth.uid() = to_broker_id);

-- Defense-in-depth: writes only via the SECURITY DEFINER RPCs below.
revoke insert, update, delete, truncate on public.listing_referrals from anon, authenticated;
revoke select on public.listing_referrals from anon;             -- anon has no referral use
grant  select on public.listing_referrals to authenticated;      -- RLS-filtered floor

-- ===== RPCs (the guarded write path) =====

create or replace function public.send_listing_referral(
  p_listing_id uuid, p_to_broker uuid, p_commission_pct numeric, p_note text default null)
returns public.listing_referrals
language plpgsql security definer set search_path to 'public' as $$
declare v_from uuid := auth.uid(); v_owner uuid; r public.listing_referrals;
begin
  if v_from is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  if p_to_broker = v_from then raise exception 'Cannot refer to yourself' using errcode='P0001'; end if;
  if p_commission_pct is null or p_commission_pct <= 0 or p_commission_pct > 100 then
    raise exception 'Commission must be greater than 0 and at most 100' using errcode='P0001'; end if;
  select broker_id into v_owner from public.listings where id = p_listing_id;
  if v_owner is null then raise exception 'Listing not found' using errcode='P0002'; end if;
  if v_owner <> v_from then raise exception 'Not your listing' using errcode='P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_to_broker and role='broker' and is_approved) then
    raise exception 'Recipient is not an approved broker' using errcode='P0001'; end if;
  -- CONTACTS-ONLY (data-layer): sender and recipient must share a conversation.
  if not exists (
    select 1 from public.conversations c
    where (c.participant_a = v_from and c.participant_b = p_to_broker)
       or (c.participant_a = p_to_broker and c.participant_b = v_from)) then
    raise exception 'You can only refer to brokers you have a conversation with' using errcode='P0001'; end if;
  insert into public.listing_referrals(from_broker_id,to_broker_id,listing_id,commission_pct,client_note,status)
    values (v_from, p_to_broker, p_listing_id, p_commission_pct, nullif(trim(p_note),''), 'pending')
    returning * into r;
  insert into public.notifications(user_id,type,title,body,link)
    values (p_to_broker,'referral_received','New listing referral',
            'A broker referred a listing to you — review it in Referrals.', r.id::text);
  return r;
end $$;

create or replace function public.respond_listing_referral(p_referral_id uuid, p_accept boolean)
returns public.listing_referrals
language plpgsql security definer set search_path to 'public' as $$
declare v uuid := auth.uid(); r public.listing_referrals;
begin
  select * into r from public.listing_referrals where id = p_referral_id for update;
  if r.id is null then raise exception 'Referral not found' using errcode='P0002'; end if;
  if r.to_broker_id <> v then raise exception 'Only the recipient can respond' using errcode='P0001'; end if;
  if r.status <> 'pending' then raise exception 'Referral is not pending' using errcode='P0001'; end if;
  update public.listing_referrals
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_referral_id returning * into r;
  insert into public.notifications(user_id,type,title,body,link)
    values (r.from_broker_id,
            case when p_accept then 'referral_accepted' else 'referral_declined' end,
            case when p_accept then 'Referral accepted' else 'Referral declined' end,
            null, r.id::text);
  return r;
end $$;

create or replace function public.complete_listing_referral(p_referral_id uuid, p_won boolean)
returns public.listing_referrals
language plpgsql security definer set search_path to 'public' as $$
declare v uuid := auth.uid(); r public.listing_referrals;
begin
  select * into r from public.listing_referrals where id = p_referral_id for update;
  if r.id is null then raise exception 'Referral not found' using errcode='P0002'; end if;
  if r.from_broker_id <> v then raise exception 'Only the sender can close a referral' using errcode='P0001'; end if;
  if r.status <> 'accepted' then raise exception 'Only accepted referrals can be closed' using errcode='P0001'; end if;
  update public.listing_referrals
     set status = case when p_won then 'completed' else 'closed_lost' end, completed_at = now()
   where id = p_referral_id returning * into r;
  insert into public.notifications(user_id,type,title,body,link)
    values (r.to_broker_id,
            case when p_won then 'referral_completed' else 'referral_closed_lost' end,
            case when p_won then 'Referral marked completed' else 'Referral marked lost' end,
            null, r.id::text);
  return r;
end $$;

create or replace function public.cancel_listing_referral(p_referral_id uuid)
returns public.listing_referrals
language plpgsql security definer set search_path to 'public' as $$
declare v uuid := auth.uid(); r public.listing_referrals;
begin
  select * into r from public.listing_referrals where id = p_referral_id for update;
  if r.id is null then raise exception 'Referral not found' using errcode='P0002'; end if;
  if r.from_broker_id <> v then raise exception 'Only the sender can cancel' using errcode='P0001'; end if;
  if r.status <> 'pending' then raise exception 'Only pending referrals can be cancelled' using errcode='P0001'; end if;
  update public.listing_referrals set status='cancelled' where id = p_referral_id returning * into r;
  insert into public.notifications(user_id,type,title,body,link)
    values (r.to_broker_id,'referral_cancelled','Referral cancelled', null, r.id::text);
  return r;
end $$;

-- Read path (enriched): returns the caller's referrals with listing + broker basics.
-- SECURITY DEFINER so a recipient can see a referred listing's title/price/image
-- even when the listing is not 'active' (listings_select_active would hide it).
create or replace function public.get_my_listing_referrals()
returns table(
  id uuid, direction text, status text, commission_pct numeric, client_note text,
  from_broker_id uuid, to_broker_id uuid, listing_id uuid,
  from_name text, to_name text,
  listing_title text, listing_price numeric, listing_image text,
  responded_at timestamptz, completed_at timestamptz, created_at timestamptz)
language sql security definer set search_path to 'public' as $$
  select r.id,
         case when r.from_broker_id = auth.uid() then 'sent' else 'received' end,
         r.status, r.commission_pct, r.client_note,
         r.from_broker_id, r.to_broker_id, r.listing_id,
         coalesce(nullif(trim(coalesce(fp.first_name,'')||' '||coalesce(fp.last_name,'')),''),'Broker'),
         coalesce(nullif(trim(coalesce(tp.first_name,'')||' '||coalesce(tp.last_name,'')),''),'Broker'),
         l.title, l.price,
         case when l.images is not null and array_length(l.images,1) > 0 then l.images[1] else null end,
         r.responded_at, r.completed_at, r.created_at
  from public.listing_referrals r
  join public.profiles fp on fp.id = r.from_broker_id
  join public.profiles tp on tp.id = r.to_broker_id
  left join public.listings l on l.id = r.listing_id
  where auth.uid() in (r.from_broker_id, r.to_broker_id)
  order by r.created_at desc;
$$;

-- Contacts-only picker source: brokers the caller shares a conversation with.
create or replace function public.get_referral_candidates()
returns table(broker_id uuid, name text, agency text)
language sql security definer set search_path to 'public' as $$
  select distinct on (bd.id) bd.id,
         coalesce(nullif(trim(coalesce(bd.first_name,'')||' '||coalesce(bd.last_name,'')),''),'Broker'),
         bd.agency
  from public.conversations c
  join public.broker_directory bd
    on bd.id = case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
  where auth.uid() in (c.participant_a, c.participant_b)
  order by bd.id;
$$;

-- Function grants — Supabase re-grants EXECUTE to public/anon on new functions;
-- revoke both, grant authenticated only (the 0047 discipline).
revoke all on function public.send_listing_referral(uuid,uuid,numeric,text)   from public, anon;
revoke all on function public.respond_listing_referral(uuid,boolean)          from public, anon;
revoke all on function public.complete_listing_referral(uuid,boolean)         from public, anon;
revoke all on function public.cancel_listing_referral(uuid)                   from public, anon;
revoke all on function public.get_my_listing_referrals()                      from public, anon;
revoke all on function public.get_referral_candidates()                       from public, anon;
grant execute on function public.send_listing_referral(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.respond_listing_referral(uuid,boolean)        to authenticated;
grant execute on function public.complete_listing_referral(uuid,boolean)       to authenticated;
grant execute on function public.cancel_listing_referral(uuid)                 to authenticated;
grant execute on function public.get_my_listing_referrals()                    to authenticated;
grant execute on function public.get_referral_candidates()                     to authenticated;
