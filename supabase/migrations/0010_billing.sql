-- ============================================================
-- HQ360 — Billing: Free / Growth / Business subscription plans,
-- billed via Paystack (monthly or yearly). Prices stored in
-- kobo (NGN minor unit) to avoid float rounding on money.
--
-- plan_limits is the single source of truth for both what a plan
-- costs and what it gates — the pricing cards on the Billing page
-- and the enforcement checks in Resources/ExamSettings/
-- generate-questions all read the same row, so a price or limit
-- change is one UPDATE, not a redeploy.
-- ============================================================

create table plan_limits (
  plan                            text primary key check (plan in ('free', 'growth', 'business')),
  price_monthly_kobo              integer not null,
  price_yearly_kobo               integer not null,
  max_members                     integer,            -- null = unlimited
  max_resources                   integer,            -- null = unlimited
  max_published_exams             integer,            -- null = unlimited
  ai_exam_generations_per_month   integer not null,
  ai_questions_per_month          integer not null,
  removes_badge                   boolean not null default false,
  custom_branding                 boolean not null default false
);

insert into plan_limits (plan, price_monthly_kobo, price_yearly_kobo, max_members, max_resources, max_published_exams, ai_exam_generations_per_month, ai_questions_per_month, removes_badge, custom_branding)
values
  ('free',     0,        0,         5,   3,    1,    3,  30,  false, false),
  ('growth',   500000,   5000000,   20,  null, null, 10, 150, true,  false),
  ('business', 1200000,  12000000, 50,  null, null, 25, 250, true,  true);

alter table organizations
  add constraint organizations_plan_tier_check check (plan_tier in ('free', 'growth', 'business'));

-- ============================================================
-- BILLING (extends the Phase 1 schema-only subscriptions/payment_events)
-- ============================================================

-- provider already defaults to 'paystack' from the Phase 1 schema-only
-- table (migration 0001) — nothing to change here.
alter table subscriptions
  add column billing_cycle          text check (billing_cycle in ('monthly', 'yearly')),
  add column current_period_start   timestamptz,
  add column trial_ends_at          timestamptz,
  add column cancel_at_period_end   boolean not null default false,
  add column provider_subscription_id text,
  add column provider_plan_code     text,
  add column amount_kobo            integer,
  add constraint subscriptions_org_id_unique unique (org_id),
  add constraint subscriptions_plan_check check (plan in ('free', 'growth', 'business')),
  add constraint subscriptions_status_check check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired'));

-- One row per generate-questions call. Monthly usage against a plan's
-- ai_exam_generations_per_month / ai_questions_per_month caps is a rolling
-- count/sum over this table rather than a manually-incremented counter —
-- no separate reset job needed, and it doubles as a usage audit trail.
create table ai_usage_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  exam_id         uuid references exams(id) on delete set null,
  question_count  integer not null default 0,
  created_at      timestamptz not null default now()
);
create index ai_usage_events_org_month_idx on ai_usage_events (org_id, created_at);

alter table plan_limits enable row level security;
alter table ai_usage_events enable row level security;

create policy "plan limits are public"
  on plan_limits for select
  using (true);

create policy "org admins read their org's subscription"
  on subscriptions for select
  using (has_org_role(org_id, array['owner', 'admin']));

create policy "org admins read their org's payment events"
  on payment_events for select
  using (has_org_role(org_id, array['owner', 'admin']));

create policy "org admins read their org's AI usage"
  on ai_usage_events for select
  using (has_org_role(org_id, array['owner', 'admin', 'instructor']));

-- subscriptions/payment_events/ai_usage_events get no client insert/update
-- policies: subscriptions and payment_events are only ever written by the
-- Paystack webhook and verify-transaction Edge Functions (service role,
-- bypasses RLS) or the security-definer functions below; ai_usage_events is
-- only written by generate-questions (also service role).

-- ============================================================
-- Trial lifecycle
--
-- A brand-new office gets 14 days of Growth-tier access with no card
-- required. organizations.plan_tier is set to 'growth' directly (rather
-- than adding a separate "trial" plan tier) so every existing plan_tier
-- check across the app — RESOURCE_LIMIT, publish gate, AI usage — just
-- works; subscriptions.status = 'trialing' is what actually marks it as a
-- trial and drives the "N days left" banner and the auto-downgrade below.
-- ============================================================

create or replace function public.start_trial(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['owner']) then
    raise exception 'Not authorized.';
  end if;

  -- Idempotent: safe to call more than once (mirrors completeOfficeSignup's
  -- resumability — a dropped connection between org creation and this call
  -- shouldn't be able to grant a second trial on retry).
  if exists (select 1 from subscriptions where org_id = target_org_id) then
    return;
  end if;

  insert into subscriptions (org_id, plan, status, provider, trial_ends_at)
  values (target_org_id, 'growth', 'trialing', 'paystack', now() + interval '14 days');

  update organizations set plan_tier = 'growth' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'trial_started', 'organizations', target_org_id);
end;
$$;
grant execute on function start_trial(uuid) to authenticated;

-- Called opportunistically (on app load) rather than on a cron schedule —
-- there's no pg_cron wired up yet, and a lazy check on next login/visit is
-- accurate enough for lapses measured in days, not minutes. Covers two
-- lapses with the same "fell back to Free" outcome: a trial that ran out,
-- and a paid period that ended without the admin checking out again
-- (Paystack's inline checkout here is a one-off charge per cycle, not
-- their auto-recurring Plans/subscriptions product — see README for why).
create or replace function public.sync_subscription_status(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['owner', 'admin', 'instructor', 'member']) then
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
  set plan_tier = 'free'
  where id = target_org_id
    and plan_tier != 'free'
    and exists (
      select 1 from subscriptions
      where org_id = target_org_id and status = 'expired'
    );
end;
$$;
grant execute on function sync_subscription_status(uuid) to authenticated;

-- Admin-initiated: don't auto-renew past the period already paid for.
-- Access/limits are untouched until current_period_end actually passes —
-- sync_subscription_status() is what performs the eventual downgrade.
create or replace function public.request_cancel_subscription(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['owner', 'admin']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions set cancel_at_period_end = true where org_id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'subscription_cancel_requested', 'organizations', target_org_id);
end;
$$;
grant execute on function request_cancel_subscription(uuid) to authenticated;

-- Immediate, admin-initiated downgrade — skips waiting for current_period_end.
-- Same soft-downgrade outcome as a lapse: nothing already created is
-- deleted, new usage is simply gated to the Free ceiling going forward.
create or replace function public.downgrade_to_free_now(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['owner', 'admin']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions set status = 'canceled', cancel_at_period_end = true where org_id = target_org_id;
  update organizations set plan_tier = 'free' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'downgraded_to_free', 'organizations', target_org_id);
end;
$$;
grant execute on function downgrade_to_free_now(uuid) to authenticated;

-- Single read used by the Billing page and every limit-gated screen: current
-- plan, trial/subscription state, and usage-vs-limit for every metered
-- resource, in one round trip. security definer + the has_org_role check
-- inside means members don't need direct RLS access to subscriptions or
-- plan_limits internals to see their own org's numbers.
create or replace function public.get_org_usage(target_org_id uuid)
returns table (
  plan                            text,
  status                          text,
  billing_cycle                   text,
  trial_ends_at                   timestamptz,
  current_period_end              timestamptz,
  cancel_at_period_end            boolean,
  max_members                     integer,
  member_count                    bigint,
  max_resources                   integer,
  resource_count                  bigint,
  max_published_exams             integer,
  published_exam_count            bigint,
  ai_exam_generations_per_month   integer,
  ai_exam_generations_used        bigint,
  ai_questions_per_month          integer,
  ai_questions_used               bigint,
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
    pl.max_members,
    (select count(*) from memberships m where m.org_id = o.id and m.status = 'active'),
    pl.max_resources,
    (select count(*) from resources r where r.org_id = o.id),
    pl.max_published_exams,
    (select count(*) from exams e where e.org_id = o.id and e.status = 'published'),
    pl.ai_exam_generations_per_month,
    (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    pl.ai_questions_per_month,
    (select coalesce(sum(u.question_count), 0) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    pl.removes_badge,
    pl.custom_branding
  from organizations o
  join plan_limits pl on pl.plan = o.plan_tier
  left join subscriptions s on s.org_id = o.id
  where o.id = target_org_id
    and has_org_role(o.id, array['owner', 'admin', 'instructor', 'member']);
$$;
grant execute on function get_org_usage(uuid) to authenticated;

-- ============================================================
-- Server-side enforcement. The Resources/ExamSettings screens check
-- get_org_usage() first so the UI reads as a quiet meter rather than a
-- surprise failure, but that's UX only — a browser devtools call straight
-- to the table would bypass it. These triggers are the actual gate, at the
-- one layer nothing else can get around.
-- ============================================================

create or replace function public.enforce_resource_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  max_allowed integer;
  current_count integer;
begin
  select pl.max_resources into max_allowed
  from organizations o join plan_limits pl on pl.plan = o.plan_tier
  where o.id = new.org_id;

  if max_allowed is not null then
    select count(*) into current_count from resources where org_id = new.org_id;
    if current_count >= max_allowed then
      raise exception 'Resource limit reached for this plan (% of %). Upgrade to add more.', current_count, max_allowed;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_resource_limit
before insert on resources
for each row execute function enforce_resource_limit();

create or replace function public.enforce_published_exam_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  max_allowed integer;
  current_count integer;
begin
  if new.status != 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;

  select pl.max_published_exams into max_allowed
  from organizations o join plan_limits pl on pl.plan = o.plan_tier
  where o.id = new.org_id;

  if max_allowed is not null then
    select count(*) into current_count from exams where org_id = new.org_id and status = 'published';
    if current_count >= max_allowed then
      raise exception 'Published exam limit reached for this plan (% of %). Upgrade to publish more.', current_count, max_allowed;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_published_exam_limit
before insert or update on exams
for each row execute function enforce_published_exam_limit();

create or replace function public.enforce_member_limit()
returns trigger
language plpgsql
set search_path = public
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
    select count(*) into current_count from memberships where org_id = new.org_id and status = 'active';
    if current_count >= max_allowed then
      raise exception 'Member limit reached for this plan (% of %). Upgrade to add more team members.', current_count, max_allowed;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_member_limit
before insert or update on memberships
for each row execute function enforce_member_limit();
