-- 0035_support_tickets.sql
-- User support tickets submitted from the Help & Support contact form, plus the
-- admin workflow (status changes). Mirrors the listing_reports (0028) shape:
-- uuid PK, text+check status, FK -> profiles(id), shared set_updated_at() trigger,
-- is_admin()-gated RLS (predicate-only, no per-role scoping -- same as 0028).
--
-- category is deliberately FREE TEXT (no check constraint): the fixed category
-- list is enforced by the UI dropdown, so categories can change without a
-- migration. reference_no is a human-friendly, server-generated code
-- (PL-YYYY-NNNNNN) -- the trigger always sets it, so clients can't spoof it.

create sequence if not exists public.support_ticket_seq;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,                 -- UI-enforced dropdown label
  subject  text not null,
  message  text not null,
  status text not null default 'open'
    check (status in ('open','in_progress','resolved','closed')),
  reference_no text unique,               -- server-generated: PL-YYYY-NNNNNN
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_created_idx
  on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id);

-- Reference number generated server-side on insert (client value ignored).
create or replace function public.set_support_ticket_ref()
returns trigger language plpgsql as $$
begin
  new.reference_no := 'PL-' || to_char(now(),'YYYY') || '-' ||
                      lpad(nextval('public.support_ticket_seq')::text, 6, '0');
  return new;
end $$;

drop trigger if exists support_tickets_set_ref on public.support_tickets;
create trigger support_tickets_set_ref before insert on public.support_tickets
  for each row execute function public.set_support_ticket_ref();

-- updated_at auto-touch (shared helper, same as every other table).
drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;

-- A user may INSERT only as themselves.
drop policy if exists support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own on public.support_tickets
  for insert with check (user_id = auth.uid());

-- A user may read only their own tickets.
drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  for select using (user_id = auth.uid());

-- Admins may read all tickets.
drop policy if exists support_tickets_admin_select on public.support_tickets;
create policy support_tickets_admin_select on public.support_tickets
  for select using (public.is_admin());

-- Admins may update all tickets (status workflow).
drop policy if exists support_tickets_admin_update on public.support_tickets;
create policy support_tickets_admin_update on public.support_tickets
  for update using (public.is_admin()) with check (public.is_admin());
