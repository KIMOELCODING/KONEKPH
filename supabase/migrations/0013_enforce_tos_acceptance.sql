-- Konek.PH — Enforce ToS acceptance for brokers at the DB level.
-- The signup UI already requires the ToS checkbox, but RLS doesn't, so a
-- scripted client could POST a broker profile with NULL tos_accepted_at.
--
-- Trigger approach (instead of a CHECK constraint) so existing admin rows and
-- in-progress signups aren't broken — only NEW broker INSERTs are gated.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

create or replace function public.enforce_broker_tos()
returns trigger language plpgsql as $$
begin
  if new.role = 'broker' and new.tos_accepted_at is null then
    raise exception 'Terms of Service acceptance required (tos_accepted_at is null) for broker profiles'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profiles_enforce_tos on public.profiles;
create trigger profiles_enforce_tos
  before insert on public.profiles
  for each row execute function public.enforce_broker_tos();
