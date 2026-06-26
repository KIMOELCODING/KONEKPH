-- Konek.PH (ProList) — MOA e-signature
--
-- Adds a reusable broker e-signature (captured at signup) and a per-listing
-- Memorandum of Agreement (MOA) sign-off flow between the broker and ProList.
--
-- Flow: broker submits listing -> admin "Send MOA" (moa edge fn: generate)
--   -> broker reviews + "Sign" (moa edge fn: sign, auto-stamps saved signature)
--   -> admin reviews signed MOA + Approve. Approve is gated on status='signed'
--   in the admin UI.
--
-- The signature PNG itself reuses the existing private `id-documents` bucket at
-- `{user_id}/signature.png` (its policies already allow owner write + owner/admin
-- read), so this migration only adds the profile columns, the agreements table,
-- and a private `moa-documents` bucket for the generated PDFs.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- ============================================================
-- 1. profiles — reusable e-signature columns (self-editable at signup)
-- ============================================================
-- Deliberately NOT added to guard_profile_privileged_columns (0016): brokers
-- must be able to write these on the post-OTP profiles.upsert at signup.

alter table public.profiles add column if not exists signature_url text;
alter table public.profiles add column if not exists signature_captured_at timestamptz;

-- ============================================================
-- 2. moa_agreements — one MOA per listing
-- ============================================================

create table if not exists public.moa_agreements (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  broker_id  uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','sent','signed','declined')),
  pdf_path text,                -- base MOA: {broker_id}/{id}/moa.pdf
  signed_pdf_path text,         -- signed:   {broker_id}/{id}/moa_signed.pdf
  sent_by uuid references public.profiles(id),
  sent_at timestamptz,
  broker_signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active MOA per listing; "Send MOA" upserts on this.
create unique index if not exists moa_agreements_listing_uniq
  on public.moa_agreements(listing_id);
create index if not exists moa_agreements_broker_status_idx
  on public.moa_agreements(broker_id, status);

drop trigger if exists moa_agreements_set_updated_at on public.moa_agreements;
create trigger moa_agreements_set_updated_at before update on public.moa_agreements
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. moa_agreements — guard: non-admin (broker) may only DECLINE
-- ============================================================
-- The 'sent' and 'signed' transitions are service-role only (the moa edge fn,
-- where auth.uid() is null). A broker's own UPDATE is frozen to its prior values
-- EXCEPT a pending/sent -> declined transition (+ decline_reason / declined_at).

create or replace function public.guard_moa_agreement_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service-role / SECURITY DEFINER paths (edge function): trusted, allow as-is.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- Non-admin: only the owning broker, and only to record a decline.
  if new.broker_id is distinct from auth.uid() then
    raise exception 'Not your MOA.' using errcode = 'P0001';
  end if;

  -- Freeze everything the broker must not touch.
  new.listing_id       := old.listing_id;
  new.broker_id        := old.broker_id;
  new.pdf_path         := old.pdf_path;
  new.signed_pdf_path  := old.signed_pdf_path;
  new.sent_by          := old.sent_by;
  new.sent_at          := old.sent_at;
  new.broker_signed_at := old.broker_signed_at;

  if new.status = 'declined' then
    if old.status not in ('pending','sent') then
      raise exception 'MOA can no longer be declined.' using errcode = 'P0001';
    end if;
    if new.declined_at is null then
      new.declined_at := now();
    end if;
  else
    -- Any other status value from a broker is rejected -> pin to prior.
    new.status      := old.status;
    new.declined_at := old.declined_at;
  end if;

  return new;
end $$;

drop trigger if exists moa_guard_columns on public.moa_agreements;
create trigger moa_guard_columns
  before update on public.moa_agreements
  for each row execute function public.guard_moa_agreement_columns();

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.moa_agreements enable row level security;

-- Broker reads own; admin reads all.
drop policy if exists moa_select_own on public.moa_agreements;
create policy moa_select_own on public.moa_agreements
  for select using (auth.uid() = broker_id);

drop policy if exists moa_select_admin on public.moa_agreements;
create policy moa_select_admin on public.moa_agreements
  for select using (public.is_admin());

-- Broker may UPDATE own row (guard trigger restricts to the decline transition);
-- admin may update any. No client INSERT policy: rows are created by the moa
-- edge function via the service role (which bypasses RLS).
drop policy if exists moa_update_own on public.moa_agreements;
create policy moa_update_own on public.moa_agreements
  for update using (auth.uid() = broker_id);

drop policy if exists moa_update_admin on public.moa_agreements;
create policy moa_update_admin on public.moa_agreements
  for update using (public.is_admin());

-- ============================================================
-- 5. moa-documents storage bucket (private)
-- ============================================================
-- Path layout: {broker_id}/{agreement_id}/moa.pdf + moa_signed.pdf
-- Pre-set ProList signatory PNG lives at _assets/prolist_signatory.png
-- (admin-only, since its first path segment is not a uid).

insert into storage.buckets (id, name, public) values
  ('moa-documents', 'moa-documents', false)
on conflict (id) do nothing;

-- read: owner of the {broker_id}/... folder OR admin (cross-party access).
drop policy if exists "moa owner+admin read" on storage.objects;
create policy "moa owner+admin read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'moa-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- write/update: admin only (the edge function uses the service role and bypasses
-- RLS; admins may also upload the _assets/ ProList signatory).
drop policy if exists "moa admin write" on storage.objects;
create policy "moa admin write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'moa-documents' and public.is_admin());

drop policy if exists "moa admin update" on storage.objects;
create policy "moa admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'moa-documents' and public.is_admin());
