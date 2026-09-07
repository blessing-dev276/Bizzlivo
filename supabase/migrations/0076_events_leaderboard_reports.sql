-- ============================================================
-- 0076 — Events Phase E: attendance -> leaderboard + report RPC
-- ============================================================
-- There is now a trustworthy confirmed-attendance signal (event_attendance,
-- status = 'present', written by an admin or a windowed self check-in), so
-- the leaderboard's Events category is switched on and wired to it.
-- Nothing scores from RSVP / viewing / clicking Join.

-- Turn the rule on for existing orgs + include it in scoring by default
-- (still toggleable per org in Leaderboard settings).
update leaderboard_point_rules set active = true where event_type = 'event.attended';
update leaderboard_settings set include_events = true where include_events = false;

-- New orgs seed the rule active.
create or replace function _lb_seed_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into leaderboard_settings (org_id) values (p_org)
  on conflict (org_id) do nothing;

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
    (p_org, 'event.attended',                'events',        'Event attendance',                   5,  true)
  on conflict (org_id, event_type) do nothing;
end $$;

-- Award on confirmed presence. Idempotent: one award per (member,
-- occurrence) via the existing leaderboard_point_events unique index
-- (source_id = occurrence id, milestone = ''). Forward-only — a later
-- change to 'absent' does not claw the point back.
create or replace function _lb_trg_event_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'present' then
    perform _lb_award(
      new.org_id, new.user_id, 'event.attended',
      'event_occurrence', new.occurrence_id, '', now(),
      jsonb_build_object('method', new.method)
    );
  end if;
  return new;
end $$;

drop trigger if exists lb_event_attendance on event_attendance;
create trigger lb_event_attendance
  after insert or update of status on event_attendance
  for each row execute function _lb_trg_event_attendance();

-- ---------- report RPC ----------
-- Sessions HELD (past, non-cancelled occurrences) and attendance in a
-- window. Future occurrences are never counted as held. Admin/trainer only.
create or replace function public.get_event_report(
  p_org  uuid,
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  event_id           uuid,
  series_title       text,
  is_recurring       boolean,
  sessions_held      bigint,
  attendance_marked  bigint,
  present_count      bigint,
  distinct_attendees bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.id,
    e.title,
    e.is_recurring,
    count(distinct o.id) filter (where o.status <> 'cancelled' and o.end_at < now()),
    count(a.*),
    count(a.*) filter (where a.status = 'present'),
    count(distinct a.user_id) filter (where a.status = 'present')
  from events e
  left join event_occurrences o
    on o.event_id = e.id and o.start_at >= p_from and o.start_at < p_to
  left join event_attendance a on a.occurrence_id = o.id
  where e.org_id = p_org
    and has_org_role(p_org, array['admin', 'trainer'])
  group by e.id, e.title, e.is_recurring
  having count(distinct o.id) filter (where o.status <> 'cancelled' and o.end_at < now()) > 0
  order by e.title;
$$;
grant execute on function public.get_event_report(uuid, timestamptz, timestamptz) to authenticated;
