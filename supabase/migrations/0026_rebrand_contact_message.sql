-- ProList — Rebrand the chat contact-info guard message (Konek -> ProList).
--
-- 0022_contact_off_platform.sql defined guard_message_contact_info() with four
-- user-facing exception messages reading "...keep communication inside Konek."
-- As part of the Konek -> ProList rebrand, re-create the function with identical
-- detection logic but the rebranded message. Detection regexes are unchanged.
--
-- The client-side mirror toast in index.html was rebranded in the same change
-- ("Keep it on ProList — ...").
--
-- Apply in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.

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
    raise exception 'Contact details can''t be shared in chat — keep communication inside ProList.';
  end if;

  -- Landline: parenthesised area code, e.g. (02) 8123 4567 or (032)-234-5678
  if new.body ~* '\(0?\d{1,2}\)\s?\d{3,4}[\s.-]?\d{4}' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside ProList.';
  end if;

  -- Landline: 7-digit local WITH a separator, e.g. 812-3456 / 812 3456.
  -- Requires the separator so comma-less prices (2500000) don't trip it.
  if new.body ~* '\y\d{3}[\s.-]\d{4}\y' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside ProList.';
  end if;

  -- Email address
  if new.body ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then
    raise exception 'Contact details can''t be shared in chat — keep communication inside ProList.';
  end if;

  return new;
end$$;
