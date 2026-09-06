-- ============================================================
-- Member Dashboard v2: the redesigned member home surfaces a few things
-- that had no store yet — a monthly goal list, a daily work-report log
-- (which also powers the "report streak"), and where each member sits on
-- the rank ladder. "Wallet" reuses the existing
-- income_development_income_entries ledger (0023) — no new table.
--
-- Same shape as the other per-member Training tables: the member owns
-- their rows (RLS keyed on user_id = auth.uid()); Admin / Trainer / Team
-- Leader can read them org-wide for reporting. Rank is the exception —
-- only staff can change it, a member just reads (and may seed) their row.
-- ============================================================

-- ---------- monthly goals ----------
create table member_monthly_goals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  month       text not null,                 -- 'YYYY-MM', the calendar month the goal is for
  title       text not null,
  metric      text,                          -- optional unit label, e.g. "prospects", "classes"
  target      int,                           -- optional numeric target
  progress    int not null default 0,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index member_monthly_goals_user_month_idx on member_monthly_goals (org_id, user_id, month);

alter table member_monthly_goals enable row level security;

create policy "members manage their own monthly goals"
  on member_monthly_goals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "staff read all monthly goals in their org"
  on member_monthly_goals for select
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));

-- ---------- daily work reports ----------
-- One row per member per calendar day. The "streak" on the dashboard is
-- just the run of consecutive days (ending today or yesterday) that have
-- a row here.
create table member_daily_reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  report_on   date not null,
  summary     text not null,
  wins        text,
  blockers    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id, report_on)
);
create index member_daily_reports_user_idx on member_daily_reports (org_id, user_id, report_on desc);

alter table member_daily_reports enable row level security;

create policy "members manage their own daily reports"
  on member_daily_reports for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "staff read all daily reports in their org"
  on member_daily_reports for select
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));

-- ---------- rank ladder position ----------
-- The ladder itself (Prospect -> Newbie -> ...) lives in app code
-- (src/lib/rank.ts); this just records where a member currently sits.
-- A member may read their row and seed it once (defaulting to
-- 'prospect'); only staff move someone up the ladder.
create table member_rank_progress (
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  current_rank  text not null default 'prospect',
  updated_at    timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table member_rank_progress enable row level security;

create policy "members read their own rank"
  on member_rank_progress for select
  using (user_id = auth.uid());

create policy "members seed their own rank row"
  on member_rank_progress for insert
  with check (user_id = auth.uid() and current_rank = 'prospect');

create policy "staff manage ranks in their org"
  on member_rank_progress for all
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']))
  with check (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));

-- ---------- weekly leaderboard rollup ----------
-- The dashboard's "This Week" card needs a cross-member view a plain
-- member's RLS can't produce (they can't read org-mates' contacts or
-- income entries). This security-definer function returns just the three
-- headline names + values, and only to a member of that org.
create or replace function member_weekly_leaderboard(target_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  week_start date := date_trunc('week', now())::date;
  top_earner    jsonb;
  top_producer  jsonb;
  most_improved jsonb;
begin
  if not is_org_member(target_org_id) then
    raise exception 'not a member of this org';
  end if;

  select to_jsonb(t) into top_earner from (
    select p.full_name as name, sum(e.amount)::numeric as value
    from income_development_income_entries e
    join profiles p on p.id = e.user_id
    where e.org_id = target_org_id and e.earned_on >= week_start
    group by p.full_name
    order by value desc
    limit 1
  ) t;

  select to_jsonb(t) into top_producer from (
    select p.full_name as name, count(*)::int as value
    from network_marketing_contacts c
    join profiles p on p.id = c.user_id
    where c.org_id = target_org_id
      and c.stage in ('won_customer', 'won_distributor')
      and c.updated_at >= week_start
    group by p.full_name
    order by value desc
    limit 1
  ) t;

  select to_jsonb(t) into most_improved from (
    select p.full_name as name, count(*)::int as value
    from attempts a
    join profiles p on p.id = a.user_id
    where a.org_id = target_org_id
      and a.status = 'submitted' and a.passed = true
      and a.submitted_at >= week_start
    group by p.full_name
    order by value desc
    limit 1
  ) t;

  return jsonb_build_object(
    'week_start',    week_start,
    'top_earner',    top_earner,
    'top_producer',  top_producer,
    'most_improved', most_improved
  );
end;
$$;

grant execute on function member_weekly_leaderboard(uuid) to authenticated;
