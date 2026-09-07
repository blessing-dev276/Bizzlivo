-- ============================================================
-- 0061 — Pricing v3: three paid packages, 30-day trial, no Free tier
-- ============================================================
-- The model becomes: every office gets a 30-day trial, then the admin
-- MUST pick one of three PAID packages. There is no perpetual Free plan
-- anymore. Every platform feature is available on every package — the
-- only differences are price, member/admin seats and monthly AI quota.
--
--   Starter   ₦7,000/mo    ₦70,000/yr    up to 10 members,  2 admin seats
--   Growth    ₦15,000/mo   ₦150,000/yr   up to 50 members,  6 admin seats   (recommended)
--   Business  ₦25,000/mo   ₦250,000/yr   50+ members (unlimited), unlimited admins
--   (yearly = 10× monthly ≈ 2 months free)
--
-- When a trial or a paid period lapses, the org is parked in a
-- `plan_tier = 'expired'` state and the app hard-locks (admins can still
-- reach Billing to choose a package; see the frontend PlanGate).
--
-- Prod has 0 subscriptions / 0 payments (Paystack still test mode) so no
-- one is grandfathered — safe to restate prices in place.

-- ---------- 1. widen the plan / status check constraints ----------
alter table plan_limits drop constraint if exists plan_limits_plan_check;
alter table plan_limits
  add constraint plan_limits_plan_check check (plan in ('free', 'expired', 'starter', 'growth', 'business'));

alter table organizations drop constraint if exists organizations_plan_tier_check;
alter table organizations
  add constraint organizations_plan_tier_check
  check (plan_tier in ('free', 'starter', 'growth', 'business', 'expired'));

alter table subscriptions drop constraint if exists subscriptions_plan_check;
alter table subscriptions
  add constraint subscriptions_plan_check check (plan in ('free', 'starter', 'growth', 'business'));

-- ---------- 2. AI quota columns become nullable (null = unlimited) ----------
alter table plan_limits alter column ai_exam_generations_per_month drop not null;
alter table plan_limits alter column ai_questions_per_month drop not null;

-- ---------- 3. package definitions ----------
-- `free` and `expired` are inert 0/0 rows: nothing can subscribe to them,
-- but get_org_usage() INNER JOINs plan_limits on organizations.plan_tier,
-- so a row must exist for every plan_tier value an org can hold —
-- including 'expired' (a lapsed trial / period) and legacy 'free'.
update plan_limits set
  price_monthly_kobo = 0, price_yearly_kobo = 0,
  max_members = 0, max_admins = 0,
  max_resources = null, max_published_exams = null,
  ai_exam_generations_per_month = 0, ai_questions_per_month = 0,
  reports_level = 'basic', removes_badge = false, custom_branding = false
where plan = 'free';

insert into plan_limits (
  plan, price_monthly_kobo, price_yearly_kobo, max_members, max_resources,
  max_published_exams, ai_exam_generations_per_month, ai_questions_per_month,
  removes_badge, custom_branding, max_admins, reports_level
) values
  ('expired', 0, 0, 0, null, null, 0, 0, false, false, 0, 'basic')
on conflict (plan) do nothing;

insert into plan_limits (
  plan, price_monthly_kobo, price_yearly_kobo, max_members, max_resources,
  max_published_exams, ai_exam_generations_per_month, ai_questions_per_month,
  removes_badge, custom_branding, max_admins, reports_level
) values
  ('starter', 700000, 7000000, 10, null, null, 15, 400, true, true, 2, 'advanced')
on conflict (plan) do update set
  price_monthly_kobo = excluded.price_monthly_kobo,
  price_yearly_kobo  = excluded.price_yearly_kobo,
  max_members        = excluded.max_members,
  max_admins         = excluded.max_admins,
  ai_exam_generations_per_month = excluded.ai_exam_generations_per_month,
  ai_questions_per_month        = excluded.ai_questions_per_month,
  reports_level      = excluded.reports_level,
  removes_badge      = excluded.removes_badge,
  custom_branding    = excluded.custom_branding;

update plan_limits set
  price_monthly_kobo = 1500000,     -- ₦15,000
  price_yearly_kobo   = 15000000,   -- ₦150,000
  max_members         = 50,
  max_admins          = 6,
  max_resources       = null,
  max_published_exams = null,
  ai_exam_generations_per_month = 40,
  ai_questions_per_month        = 1200,
  reports_level       = 'advanced',
  removes_badge       = true,
  custom_branding     = true
where plan = 'growth';

update plan_limits set
  price_monthly_kobo = 2500000,     -- ₦25,000
  price_yearly_kobo   = 25000000,   -- ₦250,000
  max_members         = null,       -- 50+ / unlimited
  max_admins          = null,       -- unlimited
  max_resources       = null,
  max_published_exams = null,
  ai_exam_generations_per_month = null,   -- unlimited
  ai_questions_per_month        = null,   -- unlimited
  reports_level       = 'advanced',
  removes_badge       = true,
  custom_branding     = true
where plan = 'business';

-- ---------- 4. 30-day trial (was 14) ----------
create or replace function public.start_trial(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  if exists (select 1 from subscriptions where org_id = target_org_id) then
    return;
  end if;

  insert into subscriptions (org_id, plan, status, provider, trial_ends_at)
  values (target_org_id, 'growth', 'trialing', 'paystack', now() + interval '30 days');

  update organizations set plan_tier = 'growth' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'trial_started', 'organizations', target_org_id);
end;
$$;

-- ---------- 5. lapse -> 'expired' (was -> 'free') ----------
create or replace function public.sync_subscription_status(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin', 'trainer', 'team_leader', 'member']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions
  set status = 'expired'
  where org_id = target_org_id
    and status = 'trialing'
    and trial_ends_at < now();

  update subscriptions
  set status = 'expired'
  where org_id = target_org_id
    and status = 'active'
    and current_period_end < now();

  update organizations
  set plan_tier = 'expired'
  where id = target_org_id
    and plan_tier not in ('expired')
    and exists (
      select 1 from subscriptions
      where org_id = target_org_id and status = 'expired'
    );
end;
$$;

-- ---------- 6. "downgrade to free" is now "cancel now -> locked" ----------
-- Same name + grant so the frontend call site is unchanged; there is no
-- Free plan to fall back to, so an immediate cancel parks the office in
-- the expired/locked state until a package is chosen.
create or replace function public.downgrade_to_free_now(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions set status = 'canceled', cancel_at_period_end = true where org_id = target_org_id;
  update organizations set plan_tier = 'expired' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'subscription_canceled_now', 'organizations', target_org_id);
end;
$$;

-- ---------- 7. platform plan override accepts 'starter' ----------
create or replace function platform_set_plan_override(p_org uuid, p_plan text, p_reason text, p_expires timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not is_platform_super_admin() then raise exception 'not authorized'; end if;
  if p_plan not in ('starter','growth','business') then raise exception 'invalid plan'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select plan_tier into cur from organizations where id = p_org;

  insert into plan_overrides (org_id, original_plan, override_plan, reason, created_by, expires_at)
  values (p_org, cur, p_plan, p_reason, auth.uid(), p_expires)
  on conflict (org_id) do update set override_plan = excluded.override_plan, reason = excluded.reason,
    created_by = excluded.created_by, created_at = now(), expires_at = excluded.expires_at;

  update organizations set plan_tier = p_plan where id = p_org;
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.plan_override', 'organization', p_org,
          jsonb_build_object('before', cur, 'after', p_plan, 'reason', p_reason, 'expires_at', p_expires));
end;
$$;
