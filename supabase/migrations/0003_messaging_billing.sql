-- Konek.PH — Phase 2 schema: messaging, calendar, articles, billing, matching, audit
-- Adds the tables deferred from 0001 per BACKEND_PLAN.md §1.3–§1.12.
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run.
-- Idempotent: safe to re-run (all CREATE statements use IF NOT EXISTS / DROP-then-CREATE for policies/triggers).

create extension if not exists "pgcrypto";

-- ============================================================
-- 1.3 saved_listings (bookmarks)
-- ============================================================
create table if not exists public.saved_listings (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists saved_listings_user_created_idx
  on public.saved_listings(user_id, created_at desc);

-- ============================================================
-- 1.4 conversations
-- ============================================================
create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  participant_a         uuid not null references public.profiles(id) on delete cascade,
  participant_b         uuid not null references public.profiles(id) on delete cascade,
  last_message_at       timestamptz,
  last_message_preview  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint conversations_participant_order check (participant_a < participant_b),
  unique (participant_a, participant_b)
);
create index if not exists conversations_a_last_idx on public.conversations(participant_a, last_message_at desc);
create index if not exists conversations_b_last_idx on public.conversations(participant_b, last_message_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ============================================================
-- 1.5 messages
-- ============================================================
create table if not exists public.messages (
  id                      uuid primary key default gen_random_uuid(),
  conversation_id         uuid not null references public.conversations(id) on delete cascade,
  sender_id               uuid not null references public.profiles(id) on delete cascade,
  body                    text,
  attachment_listing_id   uuid references public.listings(id) on delete set null,
  attachment_image_url    text,
  read_at                 timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc);

-- ============================================================
-- 1.6 calendar_events
-- ============================================================
create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  event_date  date not null,
  event_time  time,
  category    text,
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  description text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists calendar_events_user_date_idx
  on public.calendar_events(user_id, event_date);

create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ============================================================
-- 1.7 articles (admin-authored news/announcements/memoranda)
-- ============================================================
create table if not exists public.articles (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references public.profiles(id) on delete restrict,
  type                text not null check (type in ('news','announcement','memorandum')),
  title               text not null,
  body                text not null,
  image_url           text,
  category            text,
  read_time_minutes   int,
  published_at        timestamptz,
  view_count          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists articles_published_idx
  on public.articles(published_at desc nulls last);
create index if not exists articles_type_published_idx
  on public.articles(type, published_at desc nulls last);

create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

-- ============================================================
-- 1.9 payments (PayMongo)
-- ============================================================
create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  paymongo_payment_id   text not null unique,
  amount_centavos       int not null,
  currency              text not null default 'PHP',
  method                text,
  status                text not null check (status in ('pending','paid','failed','refunded')),
  paid_at               timestamptz,
  period_start          timestamptz,
  period_end            timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists payments_user_paid_idx on public.payments(user_id, paid_at desc);

-- ============================================================
-- 1.10 referrals (matching system)
-- ============================================================
create table if not exists public.referrals (
  id                      uuid primary key default gen_random_uuid(),
  from_broker_id          uuid not null references public.profiles(id) on delete cascade,
  to_broker_id            uuid not null references public.profiles(id) on delete cascade,
  buyer_target_region     text,
  buyer_target_province   text,
  buyer_target_city       text,
  buyer_notes             text,
  status                  text not null default 'open' check (status in ('open','accepted','declined','closed')),
  conversation_id         uuid references public.conversations(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists referrals_to_status_idx on public.referrals(to_broker_id, status);
create index if not exists referrals_from_status_idx on public.referrals(from_broker_id, status);

create trigger referrals_set_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

-- ============================================================
-- 1.11 audit_log
-- ============================================================
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_admin_created_idx on public.audit_log(admin_id, created_at desc);
create index if not exists audit_log_target_idx on public.audit_log(target_type, target_id);

-- ============================================================
-- 1.12 conversation_states (per-user chat UI flags)
-- ============================================================
create table if not exists public.conversation_states (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  is_pinned       boolean not null default false,
  is_muted        boolean not null default false,
  is_important    boolean not null default false,
  archived_at     timestamptz,
  last_read_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create trigger conversation_states_set_updated_at
  before update on public.conversation_states
  for each row execute function public.set_updated_at();

-- ============================================================
-- Triggers
-- ============================================================

-- update_conversation_preview: AFTER INSERT on messages
create or replace function public.update_conversation_preview()
returns trigger language plpgsql as $$
begin
  update public.conversations
    set last_message_at = new.created_at,
        last_message_preview = left(coalesce(new.body, '[attachment]'), 140)
  where id = new.conversation_id;
  return new;
end$$;

drop trigger if exists messages_update_conversation_preview on public.messages;
create trigger messages_update_conversation_preview
  after insert on public.messages
  for each row execute function public.update_conversation_preview();

-- enforce_premium_for_chat: BEFORE INSERT on conversations + messages
create or replace function public.enforce_premium_for_chat()
returns trigger language plpgsql as $$
declare
  a_tier text;
  b_tier text;
  conv record;
begin
  if tg_table_name = 'conversations' then
    select subscription_tier into a_tier from public.profiles where id = new.participant_a;
    select subscription_tier into b_tier from public.profiles where id = new.participant_b;
    if a_tier is distinct from 'premium' or b_tier is distinct from 'premium' then
      raise exception 'Chat requires Premium tier on both participants' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'messages' then
    select participant_a, participant_b into conv from public.conversations where id = new.conversation_id;
    select subscription_tier into a_tier from public.profiles where id = conv.participant_a;
    select subscription_tier into b_tier from public.profiles where id = conv.participant_b;
    if a_tier is distinct from 'premium' or b_tier is distinct from 'premium' then
      raise exception 'Sending requires Premium tier on both participants' using errcode = 'P0001';
    end if;
  end if;
  return new;
end$$;

drop trigger if exists conversations_enforce_premium on public.conversations;
create trigger conversations_enforce_premium
  before insert on public.conversations
  for each row execute function public.enforce_premium_for_chat();

drop trigger if exists messages_enforce_premium on public.messages;
create trigger messages_enforce_premium
  before insert on public.messages
  for each row execute function public.enforce_premium_for_chat();

-- upsert_conversation_state: AFTER INSERT on messages
-- Initialises a row for the recipient (so unread count works) and refreshes
-- the sender's last_read_at to now() (they've effectively just read their own thread).
create or replace function public.upsert_conversation_state()
returns trigger language plpgsql as $$
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

-- ============================================================
-- RLS
-- ============================================================
alter table public.saved_listings      enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.calendar_events     enable row level security;
alter table public.articles            enable row level security;
alter table public.payments            enable row level security;
alter table public.referrals           enable row level security;
alter table public.audit_log           enable row level security;
alter table public.conversation_states enable row level security;

-- saved_listings: owner only
drop policy if exists saved_listings_owner_all on public.saved_listings;
create policy saved_listings_owner_all on public.saved_listings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- conversations: participants only (RLS guards SELECT/INSERT/UPDATE/DELETE).
-- The Premium gate is enforced by the trigger above as defence in depth.
drop policy if exists conversations_participant_select on public.conversations;
create policy conversations_participant_select on public.conversations
  for select to authenticated
  using (auth.uid() in (participant_a, participant_b) or public.is_admin());

drop policy if exists conversations_participant_insert on public.conversations;
create policy conversations_participant_insert on public.conversations
  for insert to authenticated
  with check (auth.uid() in (participant_a, participant_b));

drop policy if exists conversations_participant_update on public.conversations;
create policy conversations_participant_update on public.conversations
  for update to authenticated
  using (auth.uid() in (participant_a, participant_b));

-- messages: only conversation participants
drop policy if exists messages_participant_select on public.messages;
create policy messages_participant_select on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (auth.uid() in (c.participant_a, c.participant_b) or public.is_admin())
  ));

drop policy if exists messages_participant_insert on public.messages;
create policy messages_participant_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  );

drop policy if exists messages_owner_update on public.messages;
create policy messages_owner_update on public.messages
  for update to authenticated
  using (sender_id = auth.uid());

-- calendar_events: owner only
drop policy if exists calendar_events_owner_all on public.calendar_events;
create policy calendar_events_owner_all on public.calendar_events
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- articles: published readable to all auth users; admin can write
drop policy if exists articles_published_select on public.articles;
create policy articles_published_select on public.articles
  for select to authenticated
  using (published_at is not null or public.is_admin());

drop policy if exists articles_admin_write on public.articles;
create policy articles_admin_write on public.articles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- payments: owner SELECT only; INSERT/UPDATE via service-role (webhook)
drop policy if exists payments_owner_select on public.payments;
create policy payments_owner_select on public.payments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- referrals: any Premium broker can read; participants update
drop policy if exists referrals_premium_select on public.referrals;
create policy referrals_premium_select on public.referrals
  for select to authenticated
  using (
    public.is_admin()
    or auth.uid() in (from_broker_id, to_broker_id)
  );

drop policy if exists referrals_premium_insert on public.referrals;
create policy referrals_premium_insert on public.referrals
  for insert to authenticated
  with check (
    from_broker_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and subscription_tier = 'premium')
  );

drop policy if exists referrals_participant_update on public.referrals;
create policy referrals_participant_update on public.referrals
  for update to authenticated
  using (auth.uid() in (from_broker_id, to_broker_id) or public.is_admin());

-- audit_log: admin SELECT only; INSERT via service-role
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- conversation_states: owner only
drop policy if exists conversation_states_owner_all on public.conversation_states;
create policy conversation_states_owner_all on public.conversation_states
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
-- Add messages to the realtime publication so the broker frontend can subscribe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end$$;
