-- 0006_relax_listing_gate.sql — temporarily defer billing gate on listing INSERT.
-- The original enforce_listing_insert (0001) rejected any subscription_status
-- other than 'trial' or 'paid'. We're shelving the trial/paid/Premium flow
-- until the rest of the app is wired up, so this version only enforces:
--   1) broker is approved by an admin
--   2) within their monthly listing quota
--
-- The subscription_status column is unchanged and still in the schema; once
-- PayMongo + the trial onboarding are wired, restore the original guard
-- (see 0001_initial_schema.sql for the historical version).

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

  select count(*) into month_count
    from public.listings
   where broker_id = new.broker_id
     and created_at >= date_trunc('month', now());

  if month_count >= prof.monthly_listing_quota then
    raise exception 'Monthly listing quota reached (%).', prof.monthly_listing_quota using errcode = 'P0003';
  end if;

  return new;
end $$;
