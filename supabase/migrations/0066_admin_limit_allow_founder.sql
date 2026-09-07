-- ============================================================
-- 0066 — the admin seat limit must never block an office's first admin
-- ============================================================
-- enforce_admin_limit() (0047) compares the count of *other* active
-- admins against plan_limits.max_admins. A brand-new office is on
-- plan_tier 'free', whose max_admins is 0 (0061), so the founding
-- admin — the org's first member — is rejected:
--
--   Admin seat limit reached for this plan (0 of 0).
--
-- create_office_for_signup() inserts that admin membership inside its
-- transaction, so the whole office creation rolls back and a
-- just-confirmed signup lands on "No office found". The trial that
-- would lift the limit is only started afterwards.
--
-- Fix: an office always gets at least one admin seat regardless of
-- plan. The cap still applies to the 2nd admin onward (free/expired =
-- exactly 1, starter = 2, growth = 6, business = unlimited).

create or replace function public.enforce_admin_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  max_allowed   integer;
  current_count integer;
begin
  -- Only care about a row that is *becoming* an active admin.
  if new.role <> 'admin' or new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role = 'admin' and old.status = 'active' then
    return new;  -- already counted
  end if;

  select pl.max_admins into max_allowed
  from organizations o join plan_limits pl on pl.plan = o.plan_tier
  where o.id = new.org_id;

  if max_allowed is not null then
    -- Every office keeps at least one admin seat, even on 'free' /
    -- 'expired' (max_admins 0) — otherwise it could never be founded
    -- and a lapsed office would lose its last admin.
    max_allowed := greatest(max_allowed, 1);

    select count(*) into current_count
    from memberships
    where org_id = new.org_id and status = 'active' and role = 'admin'
      and id <> new.id;
    if current_count >= max_allowed then
      raise exception 'Admin seat limit reached for this plan (% of %). Upgrade to add more admins.', current_count, max_allowed;
    end if;
  end if;
  return new;
end;
$$;
