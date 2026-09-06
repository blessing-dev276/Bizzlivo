-- ============================================================
-- 0047 — Bizzlivo pricing v2 + entitlement cleanup.
--
-- Bizzlivo is a digital business office, not an exam/LMS product, so the
-- pricing model stops metering "resources" and "published exams" (they
-- were leftovers from the assessment-first era) and leans on the one
-- constraint that actually tracks office value: TEAM SIZE.
--
--   Free      ₦0            up to 5 members
--   Growth    ₦15,000/mo    ₦150,000/yr   up to 25 members
--   Business  ₦35,000/mo    ₦350,000/yr   up to 100 members
--   (yearly = 10x monthly ≈ 2 months free)
--
-- New enforced entitlements: max_admins, reports_level.
-- Removed enforcement: resource limit, published-exam limit (columns kept
-- nullable/NULL so a future plan could reinstate a cap without a schema
-- change).
--
-- Safe to run against live prices: prod has 0 subscriptions and 0
-- payment_events (Paystack still in test mode) — nobody is grandfathered.
-- plan_limits is the single source of truth for price AND gates, read by
-- the Billing page, get_org_usage(), the enforcement triggers, and the
-- generate-questions Edge Function, so this one migration is the whole
-- change (no Paystack-side edit — charges are one-off inline, amount
-- derived from these rows at checkout).
-- ============================================================

-- ---------- 1. new entitlement columns ----------
alter table plan_limits
  add column if not exists max_admins    integer,                         -- null = unlimited
  add column if not exists reports_level text not null default 'full'
    check (reports_level in ('basic', 'full', 'advanced'));

-- ---------- 2. prices + limits + entitlements ----------
update plan_limits set
  price_monthly_kobo = 0,
  price_yearly_kobo   = 0,
  max_members         = 5,
  max_resources       = null,
  max_published_exams = null,
  max_admins          = 1,
  reports_level       = 'basic',
  removes_badge       = false,
  custom_branding     = false
where plan = 'free';

update plan_limits set
  price_monthly_kobo = 1500000,      -- ₦15,000
  price_yearly_kobo   = 15000000,    -- ₦150,000  (≈ 2 months free)
  max_members         = 25,
  max_resources       = null,
  max_published_exams = null,
  max_admins          = 2,
  reports_level       = 'full',
  removes_badge       = true,
  custom_branding     = false
where plan = 'growth';

update plan_limits set
  price_monthly_kobo = 3500000,      -- ₦35,000
  price_yearly_kobo   = 35000000,    -- ₦350,000  (≈ 2 months free)
  max_members         = 100,
  max_resources       = null,
  max_published_exams = null,
  max_admins          = 5,
  reports_level       = 'advanced',
  removes_badge       = true,
  custom_branding     = true
where plan = 'business';

-- ---------- 3. drop the retired constraints ----------
drop trigger if exists trg_enforce_resource_limit on resources;
drop function if exists public.enforce_resource_limit();
drop trigger if exists trg_enforce_published_exam_limit on exams;
drop function if exists public.enforce_published_exam_limit();

-- ---------- 4. admin-seat enforcement (mirrors enforce_member_limit) ----------
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

create trigger trg_enforce_admin_limit
before insert or update on memberships
for each row execute function public.enforce_admin_limit();

-- ---------- 5. get_org_usage: add admin seats + reports_level ----------
-- Return type changes (new OUT columns) → must drop before recreate.
drop function if exists public.get_org_usage(uuid);

create or replace function public.get_org_usage(target_org_id uuid)
returns table (
  plan                            text,
  status                          text,
  billing_cycle                   text,
  trial_ends_at                   timestamptz,
  current_period_end              timestamptz,
  cancel_at_period_end            boolean,
  amount_kobo                     integer,
  max_members                     integer,
  member_count                    bigint,
  max_admins                      integer,
  admin_count                     bigint,
  max_resources                   integer,
  resource_count                  bigint,
  max_published_exams             integer,
  published_exam_count            bigint,
  ai_exam_generations_per_month   integer,
  ai_exam_generations_used        bigint,
  ai_questions_per_month          integer,
  ai_questions_used               bigint,
  reports_level                   text,
  removes_badge                   boolean,
  custom_branding                 boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.plan_tier,
    s.status,
    s.billing_cycle,
    s.trial_ends_at,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    s.amount_kobo,
    pl.max_members,
    (select count(*) from memberships m where m.org_id = o.id and m.status = 'active'),
    pl.max_admins,
    (select count(*) from memberships m where m.org_id = o.id and m.status = 'active' and m.role = 'admin'),
    pl.max_resources,
    (select count(*) from resources r where r.org_id = o.id),
    pl.max_published_exams,
    (select count(*) from exams e where e.org_id = o.id and e.status = 'published'),
    pl.ai_exam_generations_per_month,
    (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    pl.ai_questions_per_month,
    (select coalesce(sum(u.question_count), 0) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    pl.reports_level,
    pl.removes_badge,
    pl.custom_branding
  from organizations o
  join plan_limits pl on pl.plan = o.plan_tier
  left join subscriptions s on s.org_id = o.id
  where o.id = target_org_id
    and has_org_role(o.id, array['admin', 'trainer', 'team_leader', 'member']);
$$;
grant execute on function get_org_usage(uuid) to authenticated;
