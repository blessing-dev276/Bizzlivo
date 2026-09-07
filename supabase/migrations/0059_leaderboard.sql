-- ============================================================
-- 0059 — Bizzlivo Performance Points (Leaderboard)
-- ============================================================
-- A real performance leaderboard driven by an append-only point
-- ledger. Points are written ONLY by SECURITY DEFINER triggers on
-- the systems that already record a trustworthy, verified event
-- (learning completion, admin-reviewed goals/assignments, Business
-- Path promotions, admin-created finance orders, verified
-- recruitment). Members can never insert point events.
--
-- Design decisions (see report):
--   * Rule changes are FORWARD-ONLY. Historical ledger rows keep the
--     `points` value frozen at creation. `leaderboard_recalculate()`
--     is an explicit, admin-triggered restatement of a period.
--   * Idempotent scoring: every scored event has a unique key of
--     (org, user, event_type, source_type, source_id, milestone).
--     The same qualifying event scores at most once.
--   * Points are flat — never proportional to money.
--   * Admin duty actions (creating courses, reviewing goals,
--     verifying finance) are never wired to the award helper, so an
--     admin only scores from their own genuine member activity.
--   * Network category = verified recruitment only. Member-typed
--     prospect stages are not a trustworthy source and score nothing.
--   * Events category ships disabled — there is no confirmed
--     attendance signal yet (event_attendees is self-join only).
-- ============================================================

-- ---------- tables ----------

create table leaderboard_settings (
  org_id                uuid primary key references organizations(id) on delete cascade,
  enabled               boolean not null default true,
  include_learning      boolean not null default true,
  include_business_path boolean not null default true,
  include_goals         boolean not null default true,
  include_network       boolean not null default true,
  include_freelance     boolean not null default true,
  include_events        boolean not null default false,
  default_period        text not null default 'month' check (default_period in ('week', 'month', 'all')),
  team_board_enabled    boolean not null default true,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references profiles(id) on delete set null
);

create table leaderboard_point_rules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  event_type  text not null,
  category    text not null check (category in
                ('learning', 'business_path', 'goals', 'network', 'freelance', 'events')),
  label       text not null,
  points      integer not null check (points >= 0),
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null,
  unique (org_id, event_type)
);
create index leaderboard_point_rules_org_idx on leaderboard_point_rules (org_id);

create table leaderboard_point_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  category     text not null check (category in
                 ('learning', 'business_path', 'goals', 'network', 'freelance', 'events', 'adjustment')),
  event_type   text not null,
  source_type  text not null,
  source_id    uuid not null,
  milestone    text not null default '',
  points       integer not null,
  rule_id      uuid references leaderboard_point_rules(id) on delete set null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb,
  created_by   uuid references profiles(id) on delete set null,  -- manual adjustments only
  reason       text                                              -- manual adjustments only
);

-- idempotency: one qualifying event scores once
create unique index leaderboard_point_events_idem
  on leaderboard_point_events (org_id, user_id, event_type, source_type, source_id, milestone);
create index leaderboard_point_events_org_time  on leaderboard_point_events (org_id, occurred_at);
create index leaderboard_point_events_user_time on leaderboard_point_events (org_id, user_id, occurred_at);
create index leaderboard_point_events_cat_time  on leaderboard_point_events (org_id, category, occurred_at);

-- ---------- RLS ----------

alter table leaderboard_settings     enable row level security;
alter table leaderboard_point_rules  enable row level security;
alter table leaderboard_point_events enable row level security;

create policy "lb settings: org members read"
  on leaderboard_settings for select using (is_org_member(org_id));
create policy "lb settings: admin manages"
  on leaderboard_settings for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

create policy "lb rules: org members read"
  on leaderboard_point_rules for select using (is_org_member(org_id));
create policy "lb rules: admin manages"
  on leaderboard_point_rules for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- point events: NO insert/update/delete policy — only SECURITY DEFINER
-- functions write here. Reads are self + office staff + team leader.
create policy "lb events: self or staff read"
  on leaderboard_point_events for select
  using (user_id = auth.uid() or has_org_role(org_id, array['admin', 'trainer']));
create policy "lb events: team leader reads their team"
  on leaderboard_point_events for select
  using (
    has_org_role(org_id, array['team_leader'])
    and exists (
      select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.org_id = leaderboard_point_events.org_id
        and g.leader_id = auth.uid()
        and gm.user_id = leaderboard_point_events.user_id
    )
  );

-- audit_log has RLS on with only a goal-scoped read policy today; let
-- office admins read the leaderboard's own audit rows (manual
-- adjustments, recalculations).
create policy "read leaderboard audit entries"
  on audit_log for select
  using (
    action in ('leaderboard.adjust', 'leaderboard.recalculate')
    and has_org_role(org_id, array['admin'])
  );

-- ============================================================
-- Seeding — defaults per office
-- ============================================================

create or replace function _lb_seed_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into leaderboard_settings (org_id) values (p_org)
  on conflict (org_id) do nothing;

  -- event.attended ships inactive: there is no confirmed-attendance
  -- signal yet, so nothing awards it until an admin turns it on.
  insert into leaderboard_point_rules (org_id, event_type, category, label, points, active) values
    (p_org, 'learning.module_completed',     'learning',      'Learning module completed',          5,  true),
    (p_org, 'learning.onboarding_completed', 'learning',      'Onboarding module completed',        5,  true),
    (p_org, 'assessment.passed',             'learning',      'Assessment passed',                  10,  true),
    (p_org, 'assignment.approved',           'learning',      'Assignment approved',                10,  true),
    (p_org, 'business_path.item_completed',  'business_path', 'Business Path requirement completed', 10, true),
    (p_org, 'business_path.rank_promoted',   'business_path', 'Rank promotion',                     50,  true),
    (p_org, 'goal.approved',                 'goals',         'Goal approved',                      15,  true),
    (p_org, 'goal.all_monthly_completed',    'goals',         'All monthly goals completed',        30,  true),
    (p_org, 'network.member_recruited',      'network',       'Verified recruitment',               25,  true),
    (p_org, 'freelance.order_verified',      'freelance',     'Verified freelance / business order', 20, true),
    (p_org, 'freelance.project_completed',   'freelance',     'Freelance project completed',        10,  true),
    (p_org, 'event.attended',                'events',        'Event attendance',                   5,  false)
  on conflict (org_id, event_type) do nothing;
end $$;

select _lb_seed_org(id) from organizations;

create or replace function _lb_on_new_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _lb_seed_org(new.id);
  return new;
end $$;
create trigger lb_seed_new_org after insert on organizations
  for each row execute function _lb_on_new_org();

-- ============================================================
-- Award helper — the ONLY path that writes a scored ledger row
-- ============================================================

create or replace function _lb_award(
  p_org uuid, p_user uuid, p_event_type text,
  p_source_type text, p_source_id uuid, p_milestone text,
  p_occurred_at timestamptz, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s leaderboard_settings%rowtype;
  r leaderboard_point_rules%rowtype;
  included boolean;
begin
  if p_user is null then return; end if;

  select * into s from leaderboard_settings where org_id = p_org;
  if not found or not s.enabled then return; end if;

  select * into r from leaderboard_point_rules
    where org_id = p_org and event_type = p_event_type and active;
  if not found or r.points <= 0 then return; end if;

  included := case r.category
    when 'learning'      then s.include_learning
    when 'business_path' then s.include_business_path
    when 'goals'         then s.include_goals
    when 'network'       then s.include_network
    when 'freelance'     then s.include_freelance
    when 'events'        then s.include_events
    else true
  end;
  if not included then return; end if;

  insert into leaderboard_point_events
    (org_id, user_id, category, event_type, source_type, source_id, milestone,
     points, rule_id, occurred_at, metadata)
  values
    (p_org, p_user, r.category, p_event_type, p_source_type, p_source_id, coalesce(p_milestone, ''),
     r.points, r.id, coalesce(p_occurred_at, now()), coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing;
end $$;

-- best-effort milestone notification (never aborts the scoring txn)
create or replace function _lb_notify(p_org uuid, p_user uuid, p_text text, p_dedupe text) returns void
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform notify(p_org, p_user, 'business', 'leaderboard', p_text, '/leaderboard', p_dedupe);
  exception when others then
    null;
  end;
end $$;

-- ============================================================
-- Integration triggers  (forward-only; each keyed for idempotency)
-- ============================================================

-- Learning: class / skill module item completed
create or replace function _lb_trg_class_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform _lb_award(new.org_id, new.user_id, 'learning.module_completed',
      'class_item_progress', new.id, '', coalesce(new.completed_at, now()));
  end if;
  return new;
end $$;
create trigger lb_class_item after insert or update on class_item_progress
  for each row execute function _lb_trg_class_item();

-- Learning: onboarding item completed
create or replace function _lb_trg_onboarding_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _lb_award(new.org_id, new.user_id, 'learning.onboarding_completed',
    'onboarding_item_progress', new.id, '', coalesce(new.completed_at, now()));
  return new;
end $$;
create trigger lb_onboarding_item after insert on onboarding_item_progress
  for each row execute function _lb_trg_onboarding_item();

-- Learning: assessment passed (first pass of an exam only, real member)
create or replace function _lb_trg_attempt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.passed is true and (old.passed is distinct from true) and new.is_guest = false then
    perform _lb_award(new.org_id, new.user_id, 'assessment.passed',
      'attempts_exam', new.exam_id, '', coalesce(new.submitted_at, now()));
  end if;
  return new;
end $$;
create trigger lb_attempt after update on attempts
  for each row execute function _lb_trg_attempt();

-- Learning: assignment submission approved by a reviewer
create or replace function _lb_trg_coursework() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    perform _lb_award(new.org_id, new.user_id, 'assignment.approved',
      'coursework_submissions', new.id, '', coalesce(new.reviewed_at, now()));
  end if;
  return new;
end $$;
create trigger lb_coursework after insert or update on coursework_submissions
  for each row execute function _lb_trg_coursework();

-- Business Path: manual / self-confirm requirement completed
create or replace function _lb_trg_bp_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _lb_award(new.org_id, new.user_id, 'business_path.item_completed',
    'business_path_item_progress', new.id, '', coalesce(new.completed_at, now()));
  return new;
end $$;
create trigger lb_bp_item after insert on business_path_item_progress
  for each row execute function _lb_trg_bp_item();

-- Business Path: rank promotion (one score per distinct rank)
create or replace function _lb_trg_rank() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_slug text; v_name text;
begin
  select slug, name into v_slug, v_name from business_path_ranks where id = new.rank_id;
  perform _lb_award(new.org_id, new.user_id, 'business_path.rank_promoted',
    'member_rank_history', new.rank_id, coalesce(v_slug, new.rank_id::text),
    coalesce(new.achieved_at, now()));
  perform _lb_notify(new.org_id, new.user_id,
    'You earned points for reaching ' || coalesce(v_name, 'a new rank') || '.',
    'lb-rank-' || new.rank_id::text);
  return new;
end $$;
create trigger lb_rank after insert on member_rank_history
  for each row execute function _lb_trg_rank();

-- Goals: approved (admin review is the gate) + all-monthly bonus
create or replace function _lb_trg_goal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_open int; v_approved int;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform _lb_award(new.org_id, new.user_id, 'goal.approved',
      'member_monthly_goals', new.id, '', coalesce(new.reviewed_at, now()));

    if new.month is not null and coalesce(new.period_type, 'monthly') = 'monthly' then
      select
        count(*) filter (where status in ('draft', 'active', 'submitted', 'changes_requested')),
        count(*) filter (where status = 'approved')
        into v_open, v_approved
      from member_monthly_goals
      where org_id = new.org_id and user_id = new.user_id
        and month = new.month and coalesce(period_type, 'monthly') = 'monthly';

      if v_open = 0 and v_approved >= 1 then
        perform _lb_award(new.org_id, new.user_id, 'goal.all_monthly_completed',
          'member_monthly_goals_month', new.user_id, new.month,
          coalesce(new.reviewed_at, now()));
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger lb_goal after update on member_monthly_goals
  for each row execute function _lb_trg_goal();

-- Freelance: project completed
create or replace function _lb_trg_freelance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform _lb_award(new.org_id, new.member_id, 'freelance.project_completed',
      'freelance_projects', new.id, '', now());
  end if;
  return new;
end $$;
create trigger lb_freelance after update on freelance_projects
  for each row execute function _lb_trg_freelance();

-- Finance: an admin-created verified order (flat points, amount ignored)
create or replace function _lb_trg_finance_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _lb_award(new.org_id, new.member_id, 'freelance.order_verified',
    'finance_orders', new.id, '',
    coalesce(new.order_date::timestamptz, now()),
    jsonb_build_object('amount', new.gross_amount, 'currency', new.currency, 'platform', new.platform));
  return new;
end $$;
create trigger lb_finance_order after insert on finance_orders
  for each row execute function _lb_trg_finance_order();

-- Network: verified recruitment — a real membership tied to a sponsor.
-- Fires both when the recruit joins and when a sponsor is set later.
create or replace function _lb_recruit(p_recruit uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_sponsor uuid; m record;
begin
  select sponsor_member_id into v_sponsor from profiles where id = p_recruit;
  if v_sponsor is null or v_sponsor = p_recruit then return; end if;

  for m in
    select org_id, id, joined_at from memberships
    where user_id = p_recruit and status = 'active' and role in ('member', 'team_leader')
  loop
    if exists (
      select 1 from memberships s
      where s.org_id = m.org_id and s.user_id = v_sponsor and s.status = 'active'
    ) then
      perform _lb_award(m.org_id, v_sponsor, 'network.member_recruited',
        'memberships', m.id, '', coalesce(p_at, m.joined_at, now()),
        jsonb_build_object('recruit', p_recruit));
    end if;
  end loop;
end $$;

create or replace function _lb_trg_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('member', 'team_leader') and new.status = 'active' then
    perform _lb_recruit(new.user_id, coalesce(new.joined_at, now()));
  end if;
  return new;
end $$;
create trigger lb_membership after insert on memberships
  for each row execute function _lb_trg_membership();

create or replace function _lb_trg_profile_sponsor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sponsor_member_id is distinct from old.sponsor_member_id
     and new.sponsor_member_id is not null then
    perform _lb_recruit(new.id, now());
  end if;
  return new;
end $$;
create trigger lb_profile_sponsor after update on profiles
  for each row execute function _lb_trg_profile_sponsor();

-- ============================================================
-- One-time backfill of verified history into the ledger
-- ============================================================
-- Idempotent (on conflict do nothing). Uses each row's real
-- completion / approval timestamp so period buckets stay honest.

-- Learning: module completions
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select cip.org_id, cip.user_id, 'learning', 'learning.module_completed',
       'class_item_progress', cip.id, '', r.points, r.id,
       coalesce(cip.completed_at, cip.created_at, now())
from class_item_progress cip
join leaderboard_point_rules r on r.org_id = cip.org_id and r.event_type = 'learning.module_completed' and r.active
join leaderboard_settings s on s.org_id = cip.org_id and s.enabled and s.include_learning
where cip.status = 'completed'
on conflict do nothing;

-- Learning: onboarding item completions
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select oip.org_id, oip.user_id, 'learning', 'learning.onboarding_completed',
       'onboarding_item_progress', oip.id, '', r.points, r.id,
       coalesce(oip.completed_at, oip.created_at, now())
from onboarding_item_progress oip
join leaderboard_point_rules r on r.org_id = oip.org_id and r.event_type = 'learning.onboarding_completed' and r.active
join leaderboard_settings s on s.org_id = oip.org_id and s.enabled and s.include_learning
on conflict do nothing;

-- Learning: assessments passed (first pass per exam)
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select distinct on (a.org_id, a.user_id, a.exam_id)
       a.org_id, a.user_id, 'learning', 'assessment.passed',
       'attempts_exam', a.exam_id, '', r.points, r.id,
       coalesce(a.submitted_at, a.started_at, now())
from attempts a
join leaderboard_point_rules r on r.org_id = a.org_id and r.event_type = 'assessment.passed' and r.active
join leaderboard_settings s on s.org_id = a.org_id and s.enabled and s.include_learning
where a.passed is true and a.is_guest = false
order by a.org_id, a.user_id, a.exam_id, a.submitted_at nulls last
on conflict do nothing;

-- Learning: assignments approved
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select cs.org_id, cs.user_id, 'learning', 'assignment.approved',
       'coursework_submissions', cs.id, '', r.points, r.id,
       coalesce(cs.reviewed_at, cs.submitted_at, now())
from coursework_submissions cs
join leaderboard_point_rules r on r.org_id = cs.org_id and r.event_type = 'assignment.approved' and r.active
join leaderboard_settings s on s.org_id = cs.org_id and s.enabled and s.include_learning
where cs.status = 'approved'
on conflict do nothing;

-- Business Path: requirement completions
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select bpip.org_id, bpip.user_id, 'business_path', 'business_path.item_completed',
       'business_path_item_progress', bpip.id, '', r.points, r.id,
       coalesce(bpip.completed_at, bpip.created_at, now())
from business_path_item_progress bpip
join leaderboard_point_rules r on r.org_id = bpip.org_id and r.event_type = 'business_path.item_completed' and r.active
join leaderboard_settings s on s.org_id = bpip.org_id and s.enabled and s.include_business_path
on conflict do nothing;

-- Business Path: rank promotions
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select distinct on (mrh.org_id, mrh.user_id, mrh.rank_id)
       mrh.org_id, mrh.user_id, 'business_path', 'business_path.rank_promoted',
       'member_rank_history', mrh.rank_id,
       coalesce((select slug from business_path_ranks where id = mrh.rank_id), mrh.rank_id::text),
       r.points, r.id, coalesce(mrh.achieved_at, mrh.created_at, now())
from member_rank_history mrh
join leaderboard_point_rules r on r.org_id = mrh.org_id and r.event_type = 'business_path.rank_promoted' and r.active
join leaderboard_settings s on s.org_id = mrh.org_id and s.enabled and s.include_business_path
order by mrh.org_id, mrh.user_id, mrh.rank_id, mrh.achieved_at
on conflict do nothing;

-- Goals: approved
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select g.org_id, g.user_id, 'goals', 'goal.approved',
       'member_monthly_goals', g.id, '', r.points, r.id,
       coalesce(g.reviewed_at, g.updated_at, g.created_at, now())
from member_monthly_goals g
join leaderboard_point_rules r on r.org_id = g.org_id and r.event_type = 'goal.approved' and r.active
join leaderboard_settings s on s.org_id = g.org_id and s.enabled and s.include_goals
where g.status = 'approved'
on conflict do nothing;

-- Goals: all-monthly bonus (every monthly goal that month is approved)
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select x.org_id, x.user_id, 'goals', 'goal.all_monthly_completed',
       'member_monthly_goals_month', x.user_id, x.month, r.points, r.id, x.last_at
from (
  select org_id, user_id, month,
         max(coalesce(reviewed_at, updated_at, created_at)) as last_at,
         count(*) filter (where status = 'approved') as approved_ct,
         count(*) filter (where status not in ('approved', 'rejected', 'month_closed_incomplete', 'cancelled')) as open_ct
  from member_monthly_goals
  where month is not null and coalesce(period_type, 'monthly') = 'monthly'
  group by org_id, user_id, month
) x
join leaderboard_point_rules r on r.org_id = x.org_id and r.event_type = 'goal.all_monthly_completed' and r.active
join leaderboard_settings s on s.org_id = x.org_id and s.enabled and s.include_goals
where x.approved_ct >= 1 and x.open_ct = 0
on conflict do nothing;

-- Freelance: projects completed
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at)
select fp.org_id, fp.member_id, 'freelance', 'freelance.project_completed',
       'freelance_projects', fp.id, '', r.points, r.id, coalesce(fp.due_date::timestamptz, now())
from freelance_projects fp
join leaderboard_point_rules r on r.org_id = fp.org_id and r.event_type = 'freelance.project_completed' and r.active
join leaderboard_settings s on s.org_id = fp.org_id and s.enabled and s.include_freelance
where fp.status = 'completed'
on conflict do nothing;

-- Finance: verified orders
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at, metadata)
select fo.org_id, fo.member_id, 'freelance', 'freelance.order_verified',
       'finance_orders', fo.id, '', r.points, r.id,
       coalesce(fo.order_date::timestamptz, fo.created_at, now()),
       jsonb_build_object('amount', fo.gross_amount, 'currency', fo.currency, 'platform', fo.platform)
from finance_orders fo
join leaderboard_point_rules r on r.org_id = fo.org_id and r.event_type = 'freelance.order_verified' and r.active
join leaderboard_settings s on s.org_id = fo.org_id and s.enabled and s.include_freelance
on conflict do nothing;

-- Network: verified recruitment
insert into leaderboard_point_events
  (org_id, user_id, category, event_type, source_type, source_id, milestone, points, rule_id, occurred_at, metadata)
select m.org_id, p.sponsor_member_id, 'network', 'network.member_recruited',
       'memberships', m.id, '', r.points, r.id, coalesce(m.joined_at, now()),
       jsonb_build_object('recruit', m.user_id)
from memberships m
join profiles p on p.id = m.user_id
join memberships sp on sp.org_id = m.org_id and sp.user_id = p.sponsor_member_id and sp.status = 'active'
join leaderboard_point_rules r on r.org_id = m.org_id and r.event_type = 'network.member_recruited' and r.active
join leaderboard_settings s on s.org_id = m.org_id and s.enabled and s.include_network
where m.status = 'active'
  and m.role in ('member', 'team_leader')
  and p.sponsor_member_id is not null
  and p.sponsor_member_id <> m.user_id
on conflict do nothing;

-- ============================================================
-- Read RPCs
-- ============================================================

create or replace function _lb_period_start(p_period text) returns timestamptz
language sql stable as $$
  select case p_period
    when 'week'  then date_trunc('week', now())
    when 'month' then date_trunc('month', now())
    else '-infinity'::timestamptz
  end;
$$;

-- Full ranked board for a period / category (+ optional team filter)
create or replace function get_leaderboard(
  p_org uuid, p_period text default 'month',
  p_category text default 'overall', p_group uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start timestamptz; v_result jsonb;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;
  v_start := _lb_period_start(p_period);

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.total desc, t.full_name), '[]'::jsonb)
  into v_result
  from (
    select
      m.user_id,
      p.full_name,
      p.avatar_url,
      coalesce(br.name, 'Prospect') as business_rank,
      (select g.name from group_members gm
         join groups g on g.id = gm.group_id
         where gm.user_id = m.user_id and g.org_id = m.org_id
         order by g.name limit 1) as team,
      coalesce(sum(e.points) filter (where e.category = 'learning'), 0)      as learning,
      coalesce(sum(e.points) filter (where e.category = 'business_path'), 0) as business_path,
      coalesce(sum(e.points) filter (where e.category = 'network'), 0)       as network,
      coalesce(sum(e.points) filter (where e.category = 'freelance'), 0)     as freelance,
      coalesce(sum(e.points) filter (where e.category = 'goals'), 0)         as goals,
      coalesce(sum(e.points) filter (where e.category = 'events'), 0)        as events,
      coalesce(sum(e.points) filter (where e.category = 'adjustment'), 0)    as adjustment,
      coalesce(sum(
        case when p_category = 'overall' then e.points
             when e.category = p_category then e.points
             else 0 end), 0) as total
    from memberships m
    join profiles p on p.id = m.user_id
    left join member_rank_progress mrp on mrp.org_id = m.org_id and mrp.user_id = m.user_id
    left join business_path_ranks br on br.id = mrp.current_rank_id
    left join leaderboard_point_events e
      on e.org_id = m.org_id and e.user_id = m.user_id and e.occurred_at >= v_start
    where m.org_id = p_org
      and m.status = 'active'
      and m.role in ('member', 'team_leader', 'admin', 'trainer')
      and (p_group is null or exists (
        select 1 from group_members gm2 where gm2.user_id = m.user_id and gm2.group_id = p_group))
    group by m.user_id, p.full_name, p.avatar_url, br.name
  ) t;

  return v_result;
end $$;

-- One member's total + position + movement vs the previous like period
create or replace function get_member_points(p_org uuid, p_user uuid, p_period text default 'month')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_total bigint;
  v_position int;
  v_count int;
  v_prev_position int;
  v_prev_has boolean;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;
  if p_user <> auth.uid()
     and not has_org_role(p_org, array['admin', 'trainer'])
     and not exists (
       select 1 from groups g join group_members gm on gm.group_id = g.id
       where g.org_id = p_org and g.leader_id = auth.uid() and gm.user_id = p_user)
  then
    raise exception 'not permitted';
  end if;

  v_start := _lb_period_start(p_period);

  with totals as (
    select m.user_id, coalesce(sum(e.points), 0) as total
    from memberships m
    left join leaderboard_point_events e
      on e.org_id = m.org_id and e.user_id = m.user_id and e.occurred_at >= v_start
    where m.org_id = p_org and m.status = 'active'
      and m.role in ('member', 'team_leader', 'admin', 'trainer')
    group by m.user_id
  ), ranked as (
    select user_id, total, rank() over (order by total desc) as pos, count(*) over () as ct
    from totals
  )
  select total, pos, ct into v_total, v_position, v_count from ranked where user_id = p_user;

  v_prev_has := false;
  if p_period in ('week', 'month') then
    v_prev_start := case p_period when 'week' then date_trunc('week', now()) - interval '1 week'
                                  else date_trunc('month', now()) - interval '1 month' end;
    v_prev_end := v_start;

    with totals as (
      select m.user_id, coalesce(sum(e.points), 0) as total,
             count(e.id) as ev
      from memberships m
      left join leaderboard_point_events e
        on e.org_id = m.org_id and e.user_id = m.user_id
        and e.occurred_at >= v_prev_start and e.occurred_at < v_prev_end
      where m.org_id = p_org and m.status = 'active'
        and m.role in ('member', 'team_leader', 'admin', 'trainer')
      group by m.user_id
    ), ranked as (
      select user_id, total, ev, rank() over (order by total desc) as pos,
             sum(ev) over () as total_ev
      from totals
    )
    select pos, (total_ev > 0) into v_prev_position, v_prev_has from ranked where user_id = p_user;
  end if;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'position', v_position,
    'member_count', v_count,
    'movement', case when v_prev_has and v_prev_position is not null and v_position is not null
                     then v_prev_position - v_position else null end
  );
end $$;

-- Category totals + recent ledger rows for one member
create or replace function get_point_breakdown(p_org uuid, p_user uuid, p_period text default 'month')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start timestamptz;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;
  if p_user <> auth.uid()
     and not has_org_role(p_org, array['admin', 'trainer'])
     and not exists (
       select 1 from groups g join group_members gm on gm.group_id = g.id
       where g.org_id = p_org and g.leader_id = auth.uid() and gm.user_id = p_user)
  then
    raise exception 'not permitted';
  end if;

  v_start := _lb_period_start(p_period);

  return jsonb_build_object(
    'categories', (
      select coalesce(jsonb_object_agg(category, s), '{}'::jsonb)
      from (
        select category, sum(points)::int as s
        from leaderboard_point_events
        where org_id = p_org and user_id = p_user and occurred_at >= v_start
        group by category
      ) c
    ),
    'recent', (
      select coalesce(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
      from (
        select e.points, e.occurred_at, e.category, e.reason,
               coalesce(ru.label, e.event_type) as label
        from leaderboard_point_events e
        left join leaderboard_point_rules ru on ru.id = e.rule_id
        where e.org_id = p_org and e.user_id = p_user and e.occurred_at >= v_start
        order by e.occurred_at desc
        limit 20
      ) r
    )
  );
end $$;

-- Team board — aggregated member points per group
create or replace function get_team_leaderboard(p_org uuid, p_period text default 'month')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start timestamptz;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;
  if not exists (select 1 from leaderboard_settings where org_id = p_org and team_board_enabled) then
    return '[]'::jsonb;
  end if;
  v_start := _lb_period_start(p_period);

  return (
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.total desc, t.name), '[]'::jsonb)
    from (
      select g.id as group_id, g.name,
             count(distinct gm.user_id) as member_count,
             coalesce(sum(e.points), 0) as total
      from groups g
      join group_members gm on gm.group_id = g.id
      left join leaderboard_point_events e
        on e.org_id = g.org_id and e.user_id = gm.user_id and e.occurred_at >= v_start
      where g.org_id = p_org
      group by g.id, g.name
    ) t
  );
end $$;

-- ============================================================
-- Admin write RPCs
-- ============================================================

-- Manual, auditable point adjustment
create or replace function leaderboard_adjust(p_org uuid, p_user uuid, p_points int, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_clean text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not permitted'; end if;
  if v_clean is null then raise exception 'a reason is required'; end if;
  if p_points = 0 then raise exception 'points must be non-zero'; end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user and status = 'active') then
    raise exception 'target is not an active member';
  end if;

  insert into leaderboard_point_events
    (org_id, user_id, category, event_type, source_type, source_id, milestone,
     points, occurred_at, created_by, reason)
  values
    (p_org, p_user, 'adjustment', 'manual.adjustment', 'manual', gen_random_uuid(), '',
     p_points, now(), auth.uid(), v_clean);

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'leaderboard.adjust', 'profile', p_user,
          jsonb_build_object('points', p_points, 'reason', v_clean));
end $$;

-- Explicit, forward-safe restatement of a period against current rules.
-- Prunes now-excluded categories/inactive rules and re-freezes points
-- to the current rule value. Does NOT retro-award missed events.
create or replace function leaderboard_recalculate(p_org uuid, p_scope text default 'month')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_pruned int; v_restated int;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not permitted'; end if;
  v_start := case p_scope when 'month' then date_trunc('month', now())
                          when 'week'  then date_trunc('week', now())
                          else '-infinity'::timestamptz end;

  with s as (select * from leaderboard_settings where org_id = p_org),
  del as (
    delete from leaderboard_point_events e
    using s
    where e.org_id = p_org and e.category <> 'adjustment' and e.occurred_at >= v_start
      and (
        not s.enabled
        or not exists (select 1 from leaderboard_point_rules r
                       where r.org_id = p_org and r.event_type = e.event_type and r.active)
        or (e.category = 'learning'      and not s.include_learning)
        or (e.category = 'business_path' and not s.include_business_path)
        or (e.category = 'goals'         and not s.include_goals)
        or (e.category = 'network'       and not s.include_network)
        or (e.category = 'freelance'     and not s.include_freelance)
        or (e.category = 'events'        and not s.include_events)
      )
    returning 1
  )
  select count(*) into v_pruned from del;

  with upd as (
    update leaderboard_point_events e
    set points = r.points, rule_id = r.id
    from leaderboard_point_rules r
    where e.org_id = p_org and r.org_id = p_org
      and r.event_type = e.event_type and r.active
      and e.category <> 'adjustment' and e.occurred_at >= v_start
      and e.points <> r.points
    returning 1
  )
  select count(*) into v_restated from upd;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'leaderboard.recalculate', 'organization', p_org,
          jsonb_build_object('scope', p_scope, 'pruned', v_pruned, 'restated', v_restated));

  return jsonb_build_object('pruned', v_pruned, 'restated', v_restated);
end $$;

-- Re-seed missing default rules (used by admin "Reset to defaults")
create or replace function leaderboard_reset_rules(p_org uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not permitted'; end if;
  perform _lb_seed_org(p_org);
end $$;

grant execute on function get_leaderboard(uuid, text, text, uuid)        to authenticated;
grant execute on function get_member_points(uuid, uuid, text)            to authenticated;
grant execute on function get_point_breakdown(uuid, uuid, text)          to authenticated;
grant execute on function get_team_leaderboard(uuid, text)               to authenticated;
grant execute on function leaderboard_adjust(uuid, uuid, int, text)      to authenticated;
grant execute on function leaderboard_recalculate(uuid, text)            to authenticated;
grant execute on function leaderboard_reset_rules(uuid)                  to authenticated;
