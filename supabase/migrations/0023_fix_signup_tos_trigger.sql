-- Konek.PH — Fix "Database error saving new user" on signup.
--
-- ROOT CAUSE: 0013_enforce_tos_acceptance added a BEFORE INSERT trigger on
-- profiles that raises when role='broker' AND tos_accepted_at IS NULL. But the
-- signup path creates the profile row via the SECURITY DEFINER handle_new_user()
-- trigger (fired by auth.users INSERT during sb.auth.signUp), which seeds only
-- (id, email, first_name, last_name, phone) — tos_accepted_at is NULL at that
-- moment and is only set LATER, at OTP-verify time (index.html upsert). So 0013
-- rejected the signup trigger's own insert, rolling back the auth user and
-- surfacing as GoTrue "Database error saving new user".
--
-- FIX: skip the ToS check when auth.uid() is null — i.e. trusted SECURITY
-- DEFINER / service-role contexts (the signup trigger, edge functions). This
-- mirrors guard_profile_privileged_columns() in 0016. A real scripted client
-- POST still runs with auth.uid() set, so the ToS gate still applies to it.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

create or replace function public.enforce_broker_tos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted signup trigger / service-role path: profile is seeded here and the
  -- ToS timestamp is written at OTP-verify. Don't block it.
  if auth.uid() is null then
    return new;
  end if;

  if new.role = 'broker' and new.tos_accepted_at is null then
    raise exception 'Terms of Service acceptance required (tos_accepted_at is null) for broker profiles'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- Trigger definition unchanged (0013); recreate idempotently in case it was
-- dropped while debugging.
drop trigger if exists profiles_enforce_tos on public.profiles;
create trigger profiles_enforce_tos
  before insert on public.profiles
  for each row execute function public.enforce_broker_tos();
