-- 0006_bump_view_count.sql — SECURITY DEFINER RPC to increment listings.view_count
-- from any authenticated viewer (without granting general UPDATE on listings).
-- Called from the broker frontend in openDetail(id) when a listing detail page opens.

create or replace function public.bump_view_count(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only count active listings so view inflation can't happen on pending/archived rows.
  update public.listings
     set view_count = view_count + 1
   where id = p_listing_id
     and status = 'active';
end;
$$;

revoke all on function public.bump_view_count(uuid) from public;
grant execute on function public.bump_view_count(uuid) to authenticated;
