-- ProList — Marketing curation layer + public website surface
--
-- Adds the third surface (public marketing site) and the marketing team that
-- curates listings for it, WITHOUT giving marketing access to broker PII and
-- WITHOUT letting the anon/public key read raw listing rows.
--
-- Pipeline: broker posts listing -> admin approves (status='active') -> an
-- AFTER trigger auto-queues a marketing_listings row (unpublished) -> marketing
-- enhances copy/photos and Publishes -> the public_listings VIEW (the ONLY thing
-- the anon role can read) exposes it with safe columns only -> public buyers
-- submit the Inquire form which INSERTs a leads row routed to marketing.
--
-- Security model: the trust boundary is Postgres (RLS + grants), not the apps.
--  * Marketing never edits the broker's listings row — only a parallel
--    marketing_listings record. Price/location are read from the joined listing,
--    never duplicated, so facts stay truthful.
--  * Marketing has NO policy on profiles -> broker PII (phone, PRC IDs, billing)
--    is invisible to it.
--  * anon can SELECT public_listings (no street_address, no broker identity) and
--    INSERT leads (column-restricted) — nothing else.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- ============================================================
-- 0. Harden the anon surface (do this first)
-- ============================================================
-- listings_select_active (0001:291) had no role clause, so by Supabase's default
-- grants the anon role could read every active listing raw — including
-- street_address. Restrict it to authenticated; anon now reads ONLY the curated
-- public_listings view created below. Broker + admin apps are always
-- authenticated, so they are unaffected.
drop policy if exists listings_select_active on public.listings;
create policy listings_select_active on public.listings
  for select to authenticated using (status = 'active');

-- ============================================================
-- 1. marketing role + is_marketing() helper
-- ============================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('broker','admin','marketing'));

create or replace function public.is_marketing()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('marketing','admin')
  );
$$;

-- ============================================================
-- 2. marketing_listings — presentation layer (1:1 with a listing)
-- ============================================================
-- Marketing owns/edits these columns. Locked facts (price, location, beds/baths,
-- areas, category) are NOT stored here — the public view reads them from the
-- joined listings row so they can never drift from the broker's truth.
create table if not exists public.marketing_listings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  public_title text,
  public_description text,
  highlights text[] not null default '{}',
  hero_image text,
  gallery text[] not null default '{}',
  tags text[] not null default '{}',
  featured boolean not null default false,
  published boolean not null default false,
  published_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued','published','unpublished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_listings_status_idx
  on public.marketing_listings(status, created_at desc);
create index if not exists marketing_listings_published_idx
  on public.marketing_listings(published);

drop trigger if exists marketing_listings_set_updated_at on public.marketing_listings;
create trigger marketing_listings_set_updated_at before update on public.marketing_listings
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. Auto-queue trigger — approved listing -> marketing queue
-- ============================================================
-- When a listing becomes active and has no marketing_listings row yet, seed one
-- (unpublished) so it appears in marketing's queue. SECURITY DEFINER so the
-- insert isn't blocked by marketing_listings RLS (no INSERT policy exists for
-- marketing — rows are trigger-created only).
create or replace function public.queue_marketing_listing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active'
     and not exists (select 1 from public.marketing_listings where listing_id = new.id) then
    -- Image fields use a uniform "<bucket>/<key>" convention so the marketing app
    -- and the public site can resolve any image with one rule, regardless of
    -- whether it was seeded from the broker's listing-images bucket or later
    -- replaced by a marketing-images upload.
    insert into public.marketing_listings (
      listing_id, public_title, public_description, gallery, hero_image
    ) values (
      new.id,
      new.title,
      new.description,
      coalesce((select array_agg('listing-images/' || img) from unnest(new.images) img), '{}'),
      case when array_length(new.images, 1) >= 1 then 'listing-images/' || new.images[1] else null end
    )
    on conflict (listing_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists listings_queue_marketing on public.listings;
create trigger listings_queue_marketing after insert or update of status on public.listings
  for each row execute function public.queue_marketing_listing();

-- ============================================================
-- 4. leads — public buyer inquiries (routed to marketing)
-- ============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  marketing_listing_id uuid references public.marketing_listings(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  location text check (char_length(location) <= 160),
  email text check (char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  message text check (char_length(message) <= 2000),
  status text not null default 'new'
    check (status in ('new','contacted','forwarded','closed')),
  created_at timestamptz not null default now()
);

create index if not exists leads_status_created_idx
  on public.leads(status, created_at desc);

-- ============================================================
-- 5. public_listings VIEW — the ONLY thing anon reads
-- ============================================================
-- Default view (security_invoker = false) so it reads the base tables with the
-- view owner's privileges — that is what lets anon read THROUGH it while base
-- listings RLS still denies anon on raw rows. Safe columns only: no
-- street_address, no broker_id / broker identity, no internal flags.
create or replace view public.public_listings as
  select
    ml.id                as marketing_listing_id,
    ml.public_title,
    ml.public_description,
    ml.highlights,
    ml.hero_image,
    ml.gallery,
    ml.tags,
    ml.featured,
    ml.published_at,
    l.price,
    l.category,
    l.property_type,
    l.region,
    l.province,
    l.city,
    l.barangay,
    l.bedrooms,
    l.bathrooms,
    l.lot_area_sqm,
    l.floor_area_sqm,
    l.amenities
  from public.marketing_listings ml
  join public.listings l on l.id = ml.listing_id
  where ml.published = true
    and l.status = 'active';

grant select on public.public_listings to anon, authenticated;

-- ============================================================
-- 6. Storage — marketing-images bucket (enhanced public photos)
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('marketing-images','marketing-images',true)
on conflict (id) do nothing;

drop policy if exists "marketing_images public read" on storage.objects;
create policy "marketing_images public read" on storage.objects
  for select using (bucket_id = 'marketing-images');

drop policy if exists "marketing_images write" on storage.objects;
create policy "marketing_images write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marketing-images' and public.is_marketing());

drop policy if exists "marketing_images update" on storage.objects;
create policy "marketing_images update" on storage.objects
  for update to authenticated
  using (bucket_id = 'marketing-images' and public.is_marketing());

drop policy if exists "marketing_images delete" on storage.objects;
create policy "marketing_images delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'marketing-images' and public.is_marketing());

-- ============================================================
-- 7. RLS / isolation
-- ============================================================
alter table public.marketing_listings enable row level security;
alter table public.leads enable row level security;

-- marketing_listings: marketing/admin read + edit. No INSERT policy on purpose —
-- rows are created only by the auto-queue trigger (SECURITY DEFINER). No DELETE.
drop policy if exists marketing_listings_select on public.marketing_listings;
create policy marketing_listings_select on public.marketing_listings
  for select to authenticated using (public.is_marketing());

drop policy if exists marketing_listings_update on public.marketing_listings;
create policy marketing_listings_update on public.marketing_listings
  for update to authenticated using (public.is_marketing()) with check (public.is_marketing());

-- listings: marketing may read the FACTS of active listings (to curate), but has
-- no access to profiles (PII stays hidden — no profiles policy for marketing).
drop policy if exists listings_select_marketing on public.listings;
create policy listings_select_marketing on public.listings
  for select to authenticated using (public.is_marketing() and status = 'active');

-- leads: anon may INSERT only (column-restricted via grant below); marketing/
-- admin may read + update (qualify/forward). Anon gets NO select.
drop policy if exists leads_insert_anon on public.leads;
create policy leads_insert_anon on public.leads
  for insert to anon, authenticated with check (true);

drop policy if exists leads_select_marketing on public.leads;
create policy leads_select_marketing on public.leads
  for select to authenticated using (public.is_marketing());

drop policy if exists leads_update_marketing on public.leads;
create policy leads_update_marketing on public.leads
  for update to authenticated using (public.is_marketing()) with check (public.is_marketing());

-- Column-level INSERT grant: callers can set ONLY these columns, so they cannot
-- forge id / status / created_at. Revoke the default full-table insert first,
-- then grant the narrow column set. (RLS with check passes; column privileges
-- narrow what can be written.)
revoke insert on public.leads from anon, authenticated;
grant insert (marketing_listing_id, name, location, email, phone, message) on public.leads to anon, authenticated;
