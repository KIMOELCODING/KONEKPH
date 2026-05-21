-- Konek.PH — Phase 1 initial schema
-- Scope: profiles, listings, property_types, psgc lookups, notifications.
-- Per BACKEND_PLAN.md §4–5. Tables for messages/calendar/articles/payments/
-- referrals/saved_listings/conversation_states are deferred to a later migration.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run.

create extension if not exists "pgcrypto";

-- ============================================================
-- Lookup tables
-- ============================================================

create table if not exists public.psgc_regions (
  code text primary key,
  name text not null
);

create table if not exists public.psgc_provinces (
  code text primary key,
  region_code text not null references public.psgc_regions(code),
  name text not null
);

create table if not exists public.psgc_cities (
  code text primary key,
  province_code text not null references public.psgc_provinces(code),
  name text not null
);

create table if not exists public.property_types (
  category text not null,
  type text not null,
  primary key (category, type)
);

-- ============================================================
-- profiles
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  title text default 'Certified Broker',
  agency text,
  license_number text,
  bio text,
  id_photo_url text,
  prc_id_url text,
  tos_accepted_at timestamptz,
  is_approved boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  role text not null default 'broker' check (role in ('broker','admin')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  subscription_status text not null default 'pending_approval'
    check (subscription_status in ('pending_approval','trial','paid','expired')),
  subscription_tier text not null default 'regular'
    check (subscription_tier in ('regular','premium')),
  subscription_started_at timestamptz,
  subscription_ends_at timestamptz,
  monthly_listing_quota int not null default 10,
  service_areas jsonb not null default '[]'::jsonb,
  specialties text[] not null default '{}',
  closed_deals_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_is_approved_idx on public.profiles(is_approved);

-- ============================================================
-- listings
-- ============================================================

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null,
  property_type text,
  price numeric(14,2) not null,
  region text not null,
  province text not null,
  city text not null,
  barangay text,
  street_address text,
  lot_area_sqm numeric(10,2),
  floor_area_sqm numeric(10,2),
  bedrooms int,
  bathrooms int,
  amenities text[] not null default '{}',
  description text,
  images text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','active','archive','rejected')),
  featured boolean not null default false,
  accuracy_agreement_accepted_at timestamptz not null,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listings_broker_status_idx on public.listings(broker_id, status);
create index if not exists listings_status_created_idx on public.listings(status, created_at desc);
create index if not exists listings_region_city_idx on public.listings(region, city);
create index if not exists listings_category_idx on public.listings(category);
create index if not exists listings_broker_created_idx on public.listings(broker_id, created_at desc);

-- ============================================================
-- notifications
-- ============================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_read_created_idx
  on public.notifications(user_id, read_at, created_at desc);

-- ============================================================
-- Helpers / triggers
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

-- Create profile row when a new auth.users row appears.
-- The frontend separately UPDATEs this row with PRC/ID upload paths and ToS
-- timestamp right after signup, so this trigger only seeds the bare minimum.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Listing INSERT guard: broker must be approved + in trial/paid, and within
-- this calendar month's quota. Admins bypass.
create or replace function public.enforce_listing_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prof public.profiles%rowtype;
  month_count int;
begin
  select * into prof from public.profiles where id = new.broker_id;
  if prof.role = 'admin' then return new; end if;

  if not prof.is_approved then
    raise exception 'Account not yet approved by admin.' using errcode = 'P0001';
  end if;
  if prof.subscription_status not in ('trial','paid') then
    raise exception 'Active trial or subscription required to post listings.' using errcode = 'P0002';
  end if;

  select count(*) into month_count
    from public.listings
   where broker_id = new.broker_id
     and created_at >= date_trunc('month', now());

  if month_count >= prof.monthly_listing_quota then
    raise exception 'Monthly listing quota reached (%).', prof.monthly_listing_quota using errcode = 'P0003';
  end if;

  return new;
end $$;

drop trigger if exists listings_enforce_insert on public.listings;
create trigger listings_enforce_insert before insert on public.listings
  for each row execute function public.enforce_listing_insert();

-- Non-admin edits to a listing reset status to 'pending'.
create or replace function public.reset_listing_on_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role is distinct from 'admin' then
    new.status := 'pending';
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end $$;

drop trigger if exists listings_reset_on_edit on public.listings;
create trigger listings_reset_on_edit before update on public.listings
  for each row
  when (old.status is distinct from new.status
        or old.title is distinct from new.title
        or old.price is distinct from new.price
        or old.description is distinct from new.description
        or old.images is distinct from new.images)
  execute function public.reset_listing_on_edit();

-- Apply tier default quota on tier change.
create or replace function public.apply_tier_quota_default()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') or (new.subscription_tier is distinct from old.subscription_tier) then
    if new.subscription_tier = 'premium' then
      new.monthly_listing_quota := 15;
    else
      new.monthly_listing_quota := 10;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_apply_tier_quota on public.profiles;
create trigger profiles_apply_tier_quota before insert or update of subscription_tier on public.profiles
  for each row execute function public.apply_tier_quota_default();

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.notifications enable row level security;
alter table public.psgc_regions enable row level security;
alter table public.psgc_provinces enable row level security;
alter table public.psgc_cities enable row level security;
alter table public.property_types enable row level security;

-- Helper: am I an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles: read own row, read approved brokers (public-ish), admin reads all
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_select_brokers on public.profiles;
create policy profiles_select_brokers on public.profiles
  for select using (is_approved = true);

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id);

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin());

-- listings: public sees active; owner sees own; admin sees all
drop policy if exists listings_select_active on public.listings;
create policy listings_select_active on public.listings
  for select using (status = 'active');

drop policy if exists listings_select_own on public.listings;
create policy listings_select_own on public.listings
  for select using (auth.uid() = broker_id);

drop policy if exists listings_select_admin on public.listings;
create policy listings_select_admin on public.listings
  for select using (public.is_admin());

drop policy if exists listings_insert_own on public.listings;
create policy listings_insert_own on public.listings
  for insert with check (auth.uid() = broker_id);

drop policy if exists listings_update_own on public.listings;
create policy listings_update_own on public.listings
  for update using (auth.uid() = broker_id);

drop policy if exists listings_update_admin on public.listings;
create policy listings_update_admin on public.listings
  for update using (public.is_admin());

-- notifications: owner read/update
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = user_id);

-- Lookups are world-readable (after auth)
drop policy if exists psgc_regions_read on public.psgc_regions;
create policy psgc_regions_read on public.psgc_regions for select using (true);
drop policy if exists psgc_provinces_read on public.psgc_provinces;
create policy psgc_provinces_read on public.psgc_provinces for select using (true);
drop policy if exists psgc_cities_read on public.psgc_cities;
create policy psgc_cities_read on public.psgc_cities for select using (true);
drop policy if exists property_types_read on public.property_types;
create policy property_types_read on public.property_types for select using (true);
