-- Konek.PH — Home content for the broker app
-- Scope: editorial articles (News/Announcement/Memorandum) + paid carousel slides.
-- Both are admin-authored from the admin portal.
--
-- Note: public.articles was first created by 0003_messaging_billing.sql with a
-- narrower shape (author_id + body NOT NULL, no is_trending). This migration
-- ALTERs that table to add the columns the admin Home-content UI needs, and
-- introduces the new promoted_slides table from scratch.

-- ============================================================
-- articles — extend existing table
-- ============================================================
alter table public.articles add column if not exists is_trending boolean not null default false;
alter table public.articles add column if not exists created_by  uuid references public.profiles(id);
alter table public.articles alter column body      drop not null;
alter table public.articles alter column author_id drop not null;

create index if not exists articles_type_pub_idx on public.articles(type, published_at desc);
create index if not exists articles_trending_idx on public.articles(is_trending, published_at desc);

-- Admin needs full CRUD; the existing articles_admin_write only covers writes.
drop policy if exists articles_admin_all on public.articles;
create policy articles_admin_all on public.articles
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- promoted_slides — new table
-- ============================================================
create table if not exists public.promoted_slides (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_name text,
  image_url text not null,
  body text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists slides_active_sort_idx on public.promoted_slides(is_active, sort_order);

drop trigger if exists slides_set_updated_at on public.promoted_slides;
create trigger slides_set_updated_at before update on public.promoted_slides
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — promoted_slides
-- ============================================================
alter table public.promoted_slides enable row level security;

drop policy if exists slides_select_active on public.promoted_slides;
create policy slides_select_active on public.promoted_slides
  for select using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

drop policy if exists slides_admin_all on public.promoted_slides;
create policy slides_admin_all on public.promoted_slides
  for all using (public.is_admin()) with check (public.is_admin());
