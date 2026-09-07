-- ============================================================
-- 0051 — connected-OS phases 6, 7, 8, 9.
--
--  Phase 6  Office setup wizard  — organizations.setup_dismissed_at
--           (the checklist itself is derived from source data, no table).
--  Phase 7  Office Activity/Pulse — activity_log + a handful of triggers on
--           the meaningful events, scoped RLS reads.
--  Phase 8  Global search — search_office(p_org, q, limit) RPC.
--  Phase 9  Bizzlivo Super Admin — platform_overview() aggregate RPC.
--           (0003 already ships is_platform_admin / admin_list_offices /
--            admin_get_office_detail / admin_set_office_status /
--            admin_set_plan_tier — reused as-is.)
-- ============================================================

-- ============================================================
-- PHASE 6
-- ============================================================
alter table organizations add column if not exists setup_dismissed_at timestamptz;

-- ============================================================
-- PHASE 7 — activity_log
-- ============================================================
create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid references profiles(id) on delete set null,
  verb        text not null,                 -- member_joined | prospect_added | goal_submitted | goal_approved | rank_promoted | freelance_completed | exam_passed
  entity_type text,
  entity_id   uuid,
  summary     text not null,
  created_at  timestamptz not null default now()
);
create index activity_log_org_idx on activity_log (org_id, created_at desc);
create index activity_log_actor_idx on activity_log (actor_id, created_at desc);

alter table activity_log enable row level security;

create policy "members read their own activity"
  on activity_log for select using (actor_id = auth.uid());
create policy "staff read office activity"
  on activity_log for select using (has_org_role(org_id, array['admin', 'trainer']));
create policy "team leaders read their team's activity"
  on activity_log for select using (
    has_org_role(org_id, array['team_leader'])
    and exists (
      select 1 from groups g join group_members gm on gm.group_id = g.id
      where g.org_id = activity_log.org_id and g.leader_id = auth.uid() and gm.user_id = activity_log.actor_id
    )
  );

create or replace function _act_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from profiles where id = p_user), 'Someone');
$$;

-- member joined
create or replace function act_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'member' and new.status = 'active' then
    insert into activity_log (org_id, actor_id, verb, entity_type, entity_id, summary)
    values (new.org_id, new.user_id, 'member_joined', 'membership', new.id,
            _act_name(new.user_id) || ' joined the office');
  end if;
  return new;
end $$;
create trigger activity_membership after insert on memberships
  for each row execute function act_membership();

-- prospect added
create or replace function act_prospect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into activity_log (org_id, actor_id, verb, entity_type, entity_id, summary)
  values (new.org_id, new.user_id, 'prospect_added', 'prospect', new.id,
          _act_name(new.user_id) || ' added a prospect: ' || new.full_name);
  return new;
end $$;
create trigger activity_prospect after insert on network_marketing_contacts
  for each row execute function act_prospect();

-- goal submitted / approved
create or replace function act_goal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status and new.status in ('submitted', 'approved') then
    insert into activity_log (org_id, actor_id, verb, entity_type, entity_id, summary)
    values (new.org_id, new.user_id,
            case new.status when 'submitted' then 'goal_submitted' else 'goal_approved' end,
            'goal', new.id,
            _act_name(new.user_id) || (case new.status when 'submitted' then ' submitted a goal: ' else ' had a goal approved: ' end) || new.title);
  end if;
  return new;
end $$;
create trigger activity_goal after update on member_monthly_goals
  for each row execute function act_goal();

-- rank promoted
create or replace function act_rank() returns trigger
language plpgsql security definer set search_path = public as $$
declare rname text;
begin
  select name into rname from business_path_ranks where id = new.rank_id;
  insert into activity_log (org_id, actor_id, verb, entity_type, entity_id, summary)
  values (new.org_id, new.user_id, 'rank_promoted', 'rank', new.rank_id,
          _act_name(new.user_id) || ' reached ' || coalesce(rname, 'a new rank'));
  return new;
end $$;
create trigger activity_rank after insert on member_rank_history
  for each row execute function act_rank();

-- freelance project completed
create or replace function act_freelance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status and new.status = 'completed' then
    insert into activity_log (org_id, actor_id, verb, entity_type, entity_id, summary)
    values (new.org_id, new.member_id, 'freelance_completed', 'freelance_project', new.id,
            _act_name(new.member_id) || ' completed a freelance order: ' || new.title);
  end if;
  return new;
end $$;
create trigger activity_freelance after update on freelance_projects
  for each row execute function act_freelance();

-- exam passed
create or replace function act_exam() returns trigger
language plpgsql security definer set search_path = public as $$
declare ename text;
begin
  if (old.passed is distinct from new.passed) and new.passed is true and new.is_guest = false then
    select title into ename from exams where id = new.exam_id;
    insert into activity_log (org_id, actor_id, verb, entity_type, entity_id, summary)
    values (new.org_id, new.user_id, 'exam_passed', 'exam', new.exam_id,
            _act_name(new.user_id) || ' passed ' || coalesce(ename, 'an exam'));
  end if;
  return new;
end $$;
create trigger activity_exam after update on attempts
  for each row execute function act_exam();

-- ============================================================
-- PHASE 8 — search_office
-- ============================================================
create or replace function search_office(p_org uuid, q text, p_limit int default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare needle text := '%' || trim(q) || '%'; result jsonb;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;
  if length(trim(coalesce(q, ''))) < 2 then return '[]'::jsonb; end if;

  with hits as (
    (select 'member' as kind, p.id as id, p.full_name as label, m.role::text as sublabel, '/members/' || p.id as route
     from memberships m join profiles p on p.id = m.user_id
     where m.org_id = p_org and m.status = 'active' and p.full_name ilike needle
       and has_org_role(p_org, array['admin', 'trainer', 'team_leader'])
     limit p_limit)
    union all
    (select 'class', c.id, c.title, coalesce(c.area, 'Learning'), '/training/classes/' || c.id
     from classes c where c.org_id = p_org and c.title ilike needle limit p_limit)
    union all
    (select 'event', e.id, e.title, to_char(e.start_at, 'Mon DD'), '/events/' || e.id
     from events e where e.org_id = p_org and e.title ilike needle limit p_limit)
    union all
    (select 'rank', r.id, r.name, 'Business Path rank', '/business-path'
     from business_path_ranks r where r.org_id = p_org and r.name ilike needle limit p_limit)
    union all
    (select 'goal', g.id, g.title, 'Goal · ' || g.month, '/goals'
     from member_monthly_goals g where g.org_id = p_org and g.user_id = auth.uid() and g.title ilike needle limit p_limit)
    union all
    (select 'network_prospect', x.id, x.full_name, 'Network prospect', '/my-team?tab=prospects'
     from network_marketing_contacts x where x.org_id = p_org and x.user_id = auth.uid() and x.full_name ilike needle limit p_limit)
    union all
    (select 'freelance_prospect', fp.id, fp.name, 'Freelance prospect', '/freelance?view=prospects'
     from freelance_prospects fp where fp.org_id = p_org and fp.member_id = auth.uid() and fp.name ilike needle limit p_limit)
    union all
    (select 'freelance_client', fc.id, fc.name, 'Freelance client', '/freelance?view=clients'
     from freelance_clients fc where fc.org_id = p_org and fc.member_id = auth.uid() and fc.name ilike needle limit p_limit)
    union all
    (select 'freelance_project', pj.id, pj.title, 'Freelance project', '/freelance?view=projects'
     from freelance_projects pj where pj.org_id = p_org and pj.member_id = auth.uid() and pj.title ilike needle limit p_limit)
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'label', label, 'sublabel', sublabel, 'route', route)), '[]'::jsonb)
  into result from hits;
  return result;
end $$;
grant execute on function search_office(uuid, text, int) to authenticated;

-- ============================================================
-- PHASE 9 — platform_overview
-- ============================================================
create or replace function platform_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'organizations', (select count(*) from organizations),
    'active_organizations', (select count(*) from organizations where status = 'active'),
    'paid_organizations', (select count(*) from organizations where plan_tier in ('growth', 'business')),
    'free_organizations', (select count(*) from organizations where plan_tier = 'free' or plan_tier is null),
    'total_users', (select count(*) from profiles),
    'active_users_7d', (
      select count(distinct actor_id) from activity_log where created_at >= now() - interval '7 days'
    ),
    'mrr_kobo', (
      select coalesce(sum(pl.price_monthly_kobo), 0)
      from subscriptions s
      join plan_limits pl on pl.plan = s.plan
      where s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    ),
    'ai_usage_month', (
      select count(*) from ai_usage_events where created_at >= date_trunc('month', now())
    ),
    'recent_orgs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'plan', plan_tier, 'status', status, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from (select * from organizations order by created_at desc limit 10) o
    )
  ) into result;
  return result;
exception when others then
  return jsonb_build_object('_error', sqlerrm, '_at', 'platform_overview');
end $$;
grant execute on function platform_overview() to authenticated;
