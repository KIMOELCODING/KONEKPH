-- 0005_deals.sql — broker-tracked deals (commission income).
-- amount = broker commission in PHP, not full property sale price.

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  client_name text,
  amount numeric(14,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','completed','cancelled')),
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deals_broker_status_idx
  on public.deals(broker_id, status, created_at desc);

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();

alter table public.deals enable row level security;

drop policy if exists deals_owner_select on public.deals;
create policy deals_owner_select on public.deals
  for select using (auth.uid() = broker_id or public.is_admin());

drop policy if exists deals_owner_insert on public.deals;
create policy deals_owner_insert on public.deals
  for insert with check (auth.uid() = broker_id);

drop policy if exists deals_owner_update on public.deals;
create policy deals_owner_update on public.deals
  for update using (auth.uid() = broker_id) with check (auth.uid() = broker_id);

drop policy if exists deals_owner_delete on public.deals;
create policy deals_owner_delete on public.deals
  for delete using (auth.uid() = broker_id);
