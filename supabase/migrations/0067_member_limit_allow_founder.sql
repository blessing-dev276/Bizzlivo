-- ============================================================
-- 0067 — the member seat limit must never block an office's first member
-- ============================================================
-- Same class of bug as 0066, on the sibling trigger. A brand-new
-- office is on plan_tier 'free', whose plan_limits.max_members is 0
-- (0061), so enforce_member_limit() rejects the founding member:
--
--   Member limit reached for this plan (0 of 0).
--
-- create_office_for_signup() inserts that membership inside its
-- transaction, so office creation rolls back and a just-confirmed
-- signup lands on "No office found".
--
-- Fix: every office gets at least one member seat regardless of plan;
-- the cap applies to member #2 onward.

create or replace function public.enforce_member_limit()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare
  max_allowed integer;
  current_count integer;
begin
  if new.status != 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;

  select pl.max_members into max_allowed
  from organizations o join plan_limits pl on pl.plan = o.plan_tier
  where o.id = new.org_id;

  if max_allowed is not null then
    -- Every office keeps at least one member seat, even on 'free' /
    -- 'expired' (max_members 0) — otherwise it could never be founded.
    max_allowed := greatest(max_allowed, 1);

    select count(*) into current_count
    from memberships where org_id = new.org_id and status = 'active';
    if current_count >= max_allowed then
      raise exception 'Member limit reached for this plan (% of %). Upgrade to add more team members.', current_count, max_allowed;
    end if;
  end if;
  return new;
end;
$$;
