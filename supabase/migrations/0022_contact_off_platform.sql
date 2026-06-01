-- Konek.PH — Keep broker communication on-platform.
--
-- Policy: all broker-to-broker communication must stay inside the web app.
-- Brokers may negotiate a referral cut IN CHAT, but must not exchange off-
-- platform contact details (mobile, landline, email) to move the conversation
-- elsewhere. Two enforcement layers:
--   1a. BEFORE-INSERT trigger on messages — rejects bodies carrying contact
--       details even if someone hits the PostgREST API / devtools directly.
--       (The frontend in index.html blocks the same patterns first, for UX.)
--   1b. broker_directory view — stop returning a peer broker's email to the
--       client at all (previously selected in 0016, exposed to every broker).
--
-- The mobile/landline/email regexes here are the single source of truth; the
-- client-side __konekHasContactInfo() in index.html mirrors them.
--
-- False-positive guard: detection is anchored on the 09/+639 mobile prefix and
-- the (area-code) landline shape — NOT "any long digit run" — so prices
-- (₱2,500,000), areas (150 sqm), and unit counts (3BR) pass through.
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

-- ============================================================
-- 1a. Message contact-info guard
-- ============================================================
create or replace function public.guard_message_contact_info()
returns trigger
language plpgsql
as $$
begin
  if new.body is null then
    return new;
  end if;

  -- PH mobile: 09xx xxx xxxx / +639xx... (separators optional)
  if new.body ~* '(\+?63|0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside Konek.';
  end if;

  -- Landline: parenthesised area code, e.g. (02) 8123 4567 or (032)-234-5678
  if new.body ~* '\(0?\d{1,2}\)\s?\d{3,4}[\s.-]?\d{4}' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside Konek.';
  end if;

  -- Landline: 7-digit local WITH a separator, e.g. 812-3456 / 812 3456.
  -- Requires the separator so comma-less prices (2500000) don't trip it.
  if new.body ~* '\y\d{3}[\s.-]\d{4}\y' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside Konek.';
  end if;

  -- Email address
  if new.body ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside Konek.';
  end if;

  return new;
end$$;

drop trigger if exists messages_block_contact_info on public.messages;
create trigger messages_block_contact_info
  before insert on public.messages
  for each row execute function public.guard_message_contact_info();

-- ============================================================
-- 1b. broker_directory — drop email so peers never receive it
-- ============================================================
-- Identical to the 0016 view MINUS the `email` column. Self-reads of one's own
-- email still work via profiles_select_own (Settings page is unaffected).
--
-- NOTE: `create or replace view` cannot DROP a column (Postgres 42P16), and the
-- 0016 view still has `email`, so we DROP then CREATE. No other object depends
-- on this view, so a plain drop (no cascade) is safe.
drop view if exists public.broker_directory;
create view public.broker_directory as
  select id, first_name, last_name, avatar_url, title, agency,
         license_number, bio, specialties, service_areas, closed_deals_count,
         created_at
  from public.profiles
  where is_approved = true and role = 'broker';

grant select on public.broker_directory to authenticated;
