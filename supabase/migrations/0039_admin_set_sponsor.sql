-- ============================================================
-- Let an org admin set another member's sponsor.
--
-- profiles UPDATE is locked to `id = auth.uid()` (0001), so members set
-- their own sponsor on the Profile page and nobody else can touch it.
-- This SECURITY DEFINER RPC is the narrow exception: an admin can write
-- ONLY the two sponsor columns on a profile that shares an org with them.
-- ============================================================

create or replace function public.admin_set_sponsor(
  target_user_id uuid,
  new_sponsor_member_id uuid,
  new_sponsor_name text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Caller must be an admin in an org the target is an active member of.
  if not exists (
    select 1 from memberships t
    where t.user_id = target_user_id
      and t.status = 'active'
      and has_org_role(t.org_id, array['admin'])
  ) then
    raise exception 'not authorized to set this member''s sponsor';
  end if;

  if new_sponsor_member_id is not null and new_sponsor_name is not null then
    raise exception 'pass a sponsor member or a name, not both';
  end if;
  if new_sponsor_member_id = target_user_id then
    raise exception 'a member cannot be their own sponsor';
  end if;

  update profiles
  set sponsor_member_id = new_sponsor_member_id,
      sponsor_name = case when new_sponsor_member_id is null then new_sponsor_name else null end
  where id = target_user_id;
end;
$$;

grant execute on function public.admin_set_sponsor(uuid, uuid, text) to authenticated;
