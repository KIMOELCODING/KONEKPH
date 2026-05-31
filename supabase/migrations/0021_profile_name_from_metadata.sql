-- ============================================================
-- 0021 — Populate profile name from auth metadata
-- ============================================================
-- handle_new_user (0001) seeded only (id, email). Signup stores first_name /
-- last_name / phone in the auth user's metadata, so profiles.first_name stayed
-- '' — which surfaced as a fallback name ('Broker') in the header chip, and as
-- empty/placeholder names in chat and listing-agent cards. Copy the metadata on
-- insert, and backfill existing rows from auth.users.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name',  ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Backfill profiles missing a name/email, pulling from auth.users metadata.
update public.profiles p
set first_name = coalesce(nullif(p.first_name, ''), u.raw_user_meta_data->>'first_name', ''),
    last_name  = coalesce(nullif(p.last_name,  ''), u.raw_user_meta_data->>'last_name',  ''),
    email      = coalesce(nullif(p.email,      ''), u.email)
from auth.users u
where u.id = p.id
  and (coalesce(p.first_name, '') = ''
       or coalesce(p.last_name, '') = ''
       or coalesce(p.email, '') = '');
