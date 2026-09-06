-- ============================================================
-- Office Reports (0041) — the aggregation layer behind the new
-- "Reports & Insights" admin workspace. All read-only, all SQL-side
-- aggregation, no new tables (Reports derives from source-of-truth data).
--
-- Every function is SECURITY DEFINER with a fixed search_path and an
-- explicit `has_org_role(p_org, array['admin'])` guard at the top, so a
-- passed org_id is validated, never trusted — an admin can only ever read
-- their own office. Grants are to `authenticated`; the guard does the rest.
--
-- Helpers:
--   report_module_complete(module_id, user_id)  -> bool
--   report_bp_item_complete(item row, user_id, since) -> bool
--   report_bp_progress(p_org) -> table(user_id, rank_id, required_total, required_done)
--
-- RPCs (all take p_org, most take p_start/p_end as a [start,end) window):
--   report_overview       — executive KPIs + rank dist + team rollup + needs-attention counts
--   report_business_path  — per-member progress, promotions in window, pending approvals
--   report_learning       — per-area module completion + assessment rollup + onboarding
--   report_network        — network size, prospect pipeline, follow-up performance
--   report_teams          — per-team members/active/learning/BP/network
--   report_income         — logged income in window + by source + milestones
--   report_member         — one member's consolidated card (for the drill-down drawer)
-- ============================================================

-- ---------- helper: is a learning module fully complete for a member ----------
create or replace function report_module_complete(p_module uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from class_module_items i
    where i.module_id = p_module
      and case i.type
        when 'quiz' then not exists (
          select 1 from attempts a where a.exam_id = i.exam_id and a.user_id = p_user and a.passed is true)
        when 'test' then not exists (
          select 1 from attempts a where a.exam_id = i.exam_id and a.user_id = p_user and a.passed is true)
        when 'assignment' then not exists (
          select 1 from coursework_submissions s
          where s.assignment_id = i.coursework_assignment_id and s.user_id = p_user and s.status = 'approved')
        else not exists (
          select 1 from class_item_progress p
          where p.item_id = i.id and p.user_id = p_user and p.status = 'completed')
      end
  );
$$;

-- ---------- helper: count of completed modules in an area, for a member ----------
create or replace function report_area_modules_done(p_org uuid, p_area text, p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from class_modules m
  join classes c on c.id = m.class_id
  where c.org_id = p_org and c.area = p_area
    and c.status = 'published' and m.status = 'published'
    and report_module_complete(m.id, p_user);
$$;

-- ---------- helper: total published modules in an area ----------
create or replace function report_area_modules_total(p_org uuid, p_area text)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from class_modules m
  join classes c on c.id = m.class_id
  where c.org_id = p_org and c.area = p_area
    and c.status = 'published' and m.status = 'published';
$$;

-- ---------- helper: evaluate a single business_path_items row for a member ----------
create or replace function report_bp_item_complete(
  p_item business_path_items, p_user uuid, p_since timestamptz
) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  amt numeric;
  tgt int := coalesce(p_item.target_count, 1);
begin
  case p_item.kind
    when 'class' then
      return exists (
        select 1 from class_modules m
        where m.class_id = p_item.class_id and m.status = 'published'
      ) and not exists (
        select 1 from class_modules m
        where m.class_id = p_item.class_id and m.status = 'published'
          and not report_module_complete(m.id, p_user)
      );
    when 'exam' then
      return exists (select 1 from attempts a where a.exam_id = p_item.exam_id and a.user_id = p_user and a.passed is true);
    when 'assignment' then
      return exists (select 1 from coursework_submissions s
        where s.assignment_id = p_item.coursework_assignment_id and s.user_id = p_user and s.status = 'approved');
    when 'resource' then return _bp_stored_done(p_item.id, p_user);
    when 'link' then return _bp_stored_done(p_item.id, p_user);
    when 'manual_self' then return _bp_stored_done(p_item.id, p_user);
    when 'manual_admin' then return _bp_stored_done(p_item.id, p_user);
    when 'daily_reports' then
      select count(*) into n from member_daily_reports r
        where r.user_id = p_user and r.org_id = p_item.org_id and r.report_on >= p_since::date;
      return n >= tgt;
    when 'prospects_added' then
      select count(*) into n from network_marketing_contacts x
        where x.user_id = p_user and x.org_id = p_item.org_id and x.created_at >= p_since;
      return n >= tgt;
    when 'followups_logged' then
      select count(*) into n from network_marketing_activities x
        where x.user_id = p_user and x.org_id = p_item.org_id and x.created_at >= p_since;
      return n >= tgt;
    when 'event_attendance' then
      if p_item.event_id is not null then
        return exists (select 1 from event_attendees ea where ea.event_id = p_item.event_id and ea.user_id = p_user);
      end if;
      select count(distinct ea.event_id) into n from event_attendees ea
        join events e on e.id = ea.event_id
        where ea.user_id = p_user and e.org_id = p_item.org_id;
      return n >= tgt;
    when 'income_logged' then
      if p_item.target_amount is not null then
        select coalesce(sum(amount), 0) into amt from income_development_income_entries e
          where e.user_id = p_user and e.org_id = p_item.org_id and e.earned_on >= p_since::date;
        return amt >= p_item.target_amount;
      end if;
      select count(*) into n from income_development_income_entries e
        where e.user_id = p_user and e.org_id = p_item.org_id and e.earned_on >= p_since::date;
      return n >= tgt;
    when 'monthly_goal' then
      return exists (select 1 from member_monthly_goals g
        where g.user_id = p_user and g.org_id = p_item.org_id
          and g.month = to_char(now(), 'YYYY-MM') and g.done);
    when 'profile_completion' then
      return exists (select 1 from profiles p where p.id = p_user
        and p.phone is not null and p.avatar_url is not null
        and (p.sponsor_member_id is not null or p.sponsor_name is not null));
    when 'onboarding_completion' then
      return not exists (
        select 1 from onboarding_step_items si
        where si.org_id = p_item.org_id
          and not exists (select 1 from onboarding_item_progress ip where ip.item_id = si.id and ip.user_id = p_user)
      );
    when 'learning_count' then
      return report_area_modules_done(p_item.org_id, p_item.learning_area, p_user) >= tgt;
    when 'goal_created' then
      return exists (select 1 from member_monthly_goals g where g.user_id = p_user and g.org_id = p_item.org_id);
    when 'three_month_goals' then
      select count(distinct month) into n from member_monthly_goals g
        where g.user_id = p_user and g.org_id = p_item.org_id;
      return n >= 3;
    when 'direct_member_count' then
      select count(*) into n from profiles p
        join memberships m on m.user_id = p.id
        where p.sponsor_member_id = p_user and m.org_id = p_item.org_id and m.status = 'active';
      return n >= tgt;
    else return false;
  end case;
end;
$$;

-- stored-completion check for manual / self / resource / link kinds
create or replace function _bp_stored_done(p_item uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from business_path_item_progress p
    where p.item_id = p_item and p.user_id = p_user and p.status in ('approved', 'complete')
  );
$$;

-- ---------- per-member business path progress across the office ----------
create or replace function report_bp_progress(p_org uuid)
returns table (user_id uuid, rank_id uuid, required_total int, required_done int)
language plpgsql stable security definer set search_path = public as $$
declare
  m record;
  it business_path_items;
  since timestamptz;
  total int;
  done int;
begin
  if not has_org_role(p_org, array['admin']) then
    raise exception 'not authorized';
  end if;

  for m in
    select mp.user_id, mp.current_rank_id, coalesce(mp.started_at, 'epoch'::timestamptz) as started_at
    from member_rank_progress mp
    join memberships ms on ms.user_id = mp.user_id and ms.org_id = p_org and ms.status = 'active'
    where mp.org_id = p_org and mp.current_rank_id is not null
  loop
    total := 0; done := 0; since := m.started_at;
    for it in
      select * from business_path_items
      where org_id = p_org and rank_id = m.current_rank_id and is_required
    loop
      total := total + 1;
      if report_bp_item_complete(it, m.user_id, since) then done := done + 1; end if;
    end loop;
    user_id := m.user_id; rank_id := m.current_rank_id;
    required_total := total; required_done := done;
    return next;
  end loop;
end;
$$;

-- ============================================================
-- report_overview
-- ============================================================
create or replace function report_overview(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
  prev_start timestamptz := p_start - (p_end - p_start);
begin
  if not has_org_role(p_org, array['admin']) then
    raise exception 'not authorized';
  end if;

  with mem as (
    select m.user_id, m.status, m.joined_at
    from memberships m where m.org_id = p_org
  ),
  bp as materialized (select * from report_bp_progress(p_org)),
  ranks as (
    select r.id, r.name, r.order_index
    from business_path_ranks r where r.org_id = p_org and r.is_active
  ),
  recent_activity as (
    select gs.user_id from (
      select user_id from class_item_progress where org_id = p_org and completed_at >= now() - interval '7 days'
      union select user_id from attempts where org_id = p_org and submitted_at >= now() - interval '7 days'
      union select user_id from network_marketing_activities where org_id = p_org and created_at >= now() - interval '7 days'
      union select user_id from member_daily_reports where org_id = p_org and created_at >= now() - interval '7 days'
      union select user_id from business_path_item_progress where org_id = p_org and created_at >= now() - interval '7 days'
    ) gs
  )
  select jsonb_build_object(
    'members_total', (select count(*) from mem where status = 'active'),
    'members_all', (select count(*) from mem),
    'members_new', (select count(*) from mem where joined_at >= p_start and joined_at < p_end),
    'members_new_prev', (select count(*) from mem where joined_at >= prev_start and joined_at < p_start),
    'members_active_7d', (select count(distinct user_id) from recent_activity),
    'bp_avg_percent', (
      select coalesce(round(avg(case when required_total > 0 then required_done::numeric / required_total * 100 else 0 end)), 0)
      from bp
    ),
    'bp_ready', (select count(*) from bp where required_total > 0 and required_done >= required_total),
    'bp_near', (select count(*) from bp where required_total > 0 and required_done < required_total
                 and required_done::numeric / required_total >= 0.75),
    'bp_pending_approvals', (
      select count(*) from business_path_item_progress
      where org_id = p_org and status = 'awaiting_approval'
    ),
    'promotions_in_period', (
      select count(*) from member_rank_history
      where org_id = p_org and achieved_at >= p_start and achieved_at < p_end
    ),
    'rank_distribution', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by order_index), '[]'::jsonb)
      from (
        select r.name, r.order_index, count(mp.user_id) as c
        from ranks r
        left join member_rank_progress mp on mp.current_rank_id = r.id and mp.org_id = p_org
        left join memberships ms on ms.user_id = mp.user_id and ms.org_id = p_org and ms.status = 'active'
        group by r.name, r.order_index
      ) d
    ),
    'income_period', (
      select coalesce(sum(amount), 0) from income_development_income_entries
      where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date
    ),
    'income_period_prev', (
      select coalesce(sum(amount), 0) from income_development_income_entries
      where org_id = p_org and earned_on >= prev_start::date and earned_on < p_start::date
    ),
    'income_earners', (
      select count(distinct user_id) from income_development_income_entries
      where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date
    ),
    'prospects_added', (
      select count(*) from network_marketing_contacts
      where org_id = p_org and created_at >= p_start and created_at < p_end
    ),
    'followups_overdue', (
      select count(*) from network_marketing_contacts
      where org_id = p_org and next_follow_up_at is not null and next_follow_up_at < now()
        and stage not in ('won_customer', 'won_distributor', 'lost')
    ),
    'assignments_pending_review', (
      select count(*) from coursework_submissions where org_id = p_org and status = 'submitted'
    ),
    'onboarding_not_started', (
      select count(*) from memberships ms
      where ms.org_id = p_org and ms.status = 'active'
        and not exists (
          select 1 from onboarding_item_progress ip
          join onboarding_step_items si on si.id = ip.item_id
          where si.org_id = p_org and ip.user_id = ms.user_id
        )
    ),
    'inactive_7d', (
      select count(*) from mem
      where status = 'active' and user_id not in (select user_id from recent_activity)
    ),
    'member_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'total', running) order by d), '[]'::jsonb)
      from (
        select day::date as d,
          (select count(*) from mem where joined_at::date <= day::date) as running
        from generate_series(p_start, p_end - interval '1 day', interval '1 day') as day
      ) g
    ),
    'promotions_series', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', c) order by d), '[]'::jsonb)
      from (
        select date_trunc('day', achieved_at)::date as d, count(*) as c
        from member_rank_history
        where org_id = p_org and achieved_at >= p_start and achieved_at < p_end
        group by 1
      ) g
    ),
    'income_series', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'amount', a) order by d), '[]'::jsonb)
      from (
        select earned_on as d, sum(amount) as a
        from income_development_income_entries
        where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date
        group by 1
      ) g
    )
  ) into result;

  return result;
end;
$$;

-- ============================================================
-- report_business_path — per-member rows + promotion history in window
-- ============================================================
create or replace function report_business_path(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;

  with bp as materialized (select * from report_bp_progress(p_org)),
  rows as (
    select p.id as user_id, p.full_name, r.name as rank_name, r.order_index,
           b.required_total, b.required_done,
           case when b.required_total > 0 then round(b.required_done::numeric / b.required_total * 100) else 0 end as percent
    from bp b
    join profiles p on p.id = b.user_id
    left join business_path_ranks r on r.id = b.rank_id
  )
  select jsonb_build_object(
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'name', full_name, 'rank', rank_name,
        'required_total', required_total, 'required_done', required_done, 'percent', percent
      ) order by percent desc), '[]'::jsonb) from rows
    ),
    'ready', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', full_name, 'rank', rank_name) order by full_name), '[]'::jsonb)
              from rows where required_total > 0 and required_done >= required_total),
    'near', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', full_name, 'rank', rank_name, 'percent', percent) order by percent desc), '[]'::jsonb)
             from rows where required_total > 0 and required_done < required_total and percent >= 75),
    'stalled', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', full_name, 'rank', rank_name, 'percent', percent) order by percent), '[]'::jsonb)
                from rows where required_total > 0 and percent < 34),
    'pending_approvals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', bpp.user_id, 'name', pr.full_name, 'item', it.title, 'submitted_at', bpp.created_at
      ) order by bpp.created_at), '[]'::jsonb)
      from business_path_item_progress bpp
      join business_path_items it on it.id = bpp.item_id
      join profiles pr on pr.id = bpp.user_id
      where bpp.org_id = p_org and bpp.status = 'awaiting_approval'
    ),
    'promotions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', h.user_id, 'name', pr.full_name, 'rank', r.name,
        'achieved_at', h.achieved_at, 'automatic', h.approved_by is null
      ) order by h.achieved_at desc), '[]'::jsonb)
      from member_rank_history h
      join profiles pr on pr.id = h.user_id
      left join business_path_ranks r on r.id = h.rank_id
      where h.org_id = p_org and h.achieved_at >= p_start and h.achieved_at < p_end
    )
  ) into result;
  return result;
end;
$$;

-- ============================================================
-- report_learning
-- ============================================================
create or replace function report_learning(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; area text; areas text[] := array['onboarding','network_marketing','freelancing','personal_development','income_development']; area_json jsonb := '[]'::jsonb;
  actives uuid[];
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;

  select array_agg(user_id) into actives from memberships where org_id = p_org and status = 'active';
  if actives is null then actives := array[]::uuid[]; end if;

  foreach area in array areas[2:5] loop
    area_json := area_json || jsonb_build_object(
      'area', area,
      'modules_total', report_area_modules_total(p_org, area),
      'participants', (
        select count(distinct cip.user_id)
        from class_item_progress cip
        join class_module_items i on i.id = cip.item_id
        join class_modules m on m.id = i.module_id
        join classes c on c.id = m.class_id
        where c.org_id = p_org and c.area = area and cip.status = 'completed'
      ),
      'modules_done', (
        select coalesce(sum(report_area_modules_done(p_org, area, u)), 0) from unnest(actives) u
      )
    );
  end loop;

  select jsonb_build_object(
    'areas', area_json,
    'onboarding', jsonb_build_object(
      'items_total', (select count(*) from onboarding_step_items where org_id = p_org),
      'completed_members', (
        select count(*) from unnest(actives) u
        where (select count(*) from onboarding_step_items where org_id = p_org) > 0
          and not exists (
            select 1 from onboarding_step_items si where si.org_id = p_org
              and not exists (select 1 from onboarding_item_progress ip where ip.item_id = si.id and ip.user_id = u)
          )
      ),
      'in_progress_members', (
        select count(*) from unnest(actives) u
        where exists (select 1 from onboarding_item_progress ip join onboarding_step_items si on si.id = ip.item_id where si.org_id = p_org and ip.user_id = u)
          and exists (select 1 from onboarding_step_items si where si.org_id = p_org
            and not exists (select 1 from onboarding_item_progress ip where ip.item_id = si.id and ip.user_id = u))
      ),
      'not_started_members', (
        select count(*) from unnest(actives) u
        where not exists (select 1 from onboarding_item_progress ip join onboarding_step_items si on si.id = ip.item_id where si.org_id = p_org and ip.user_id = u)
      )
    ),
    'assessments', jsonb_build_object(
      'attempts', (select count(*) from attempts where org_id = p_org and status = 'submitted' and is_guest = false and submitted_at >= p_start and submitted_at < p_end),
      'passed', (select count(*) from attempts where org_id = p_org and status = 'submitted' and is_guest = false and passed is true and submitted_at >= p_start and submitted_at < p_end),
      'avg_score', (select round(avg(score_percent), 1) from attempts where org_id = p_org and status = 'submitted' and is_guest = false and submitted_at >= p_start and submitted_at < p_end),
      'assignments_submitted', (select count(*) from coursework_submissions where org_id = p_org and submitted_at >= p_start and submitted_at < p_end),
      'assignments_pending', (select count(*) from coursework_submissions where org_id = p_org and status = 'submitted'),
      'assignments_approved', (select count(*) from coursework_submissions where org_id = p_org and status = 'approved' and reviewed_at >= p_start and reviewed_at < p_end),
      'per_exam', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'exam_id', e.id, 'title', e.title, 'attempts', x.att, 'passed', x.pas,
          'pass_rate', case when x.att > 0 then round(x.pas::numeric / x.att * 100) else 0 end,
          'avg_score', x.avg
        ) order by x.att desc), '[]'::jsonb)
        from exams e
        join lateral (
          select count(*) as att, count(*) filter (where passed is true) as pas, round(avg(score_percent), 1) as avg
          from attempts a where a.exam_id = e.id and a.status = 'submitted' and a.is_guest = false
        ) x on true
        where e.org_id = p_org and x.att > 0
      )
    ),
    'no_activity_members', (
      select count(*) from unnest(actives) u
      where not exists (select 1 from class_item_progress where org_id = p_org and user_id = u and status = 'completed')
        and not exists (select 1 from attempts where org_id = p_org and user_id = u and status = 'submitted')
        and not exists (select 1 from onboarding_item_progress ip join onboarding_step_items si on si.id = ip.item_id where si.org_id = p_org and ip.user_id = u)
    )
  ) into result;
  return result;
end;
$$;

-- ============================================================
-- report_network
-- ============================================================
create or replace function report_network(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'contacts_total', (select count(*) from network_marketing_contacts where org_id = p_org),
    'by_stage', (
      select coalesce(jsonb_object_agg(stage, c), '{}'::jsonb) from (
        select stage, count(*) c from network_marketing_contacts where org_id = p_org group by stage
      ) s
    ),
    'prospects_added', (select count(*) from network_marketing_contacts where org_id = p_org and created_at >= p_start and created_at < p_end),
    'activities_logged', (select count(*) from network_marketing_activities where org_id = p_org and created_at >= p_start and created_at < p_end),
    'followups_scheduled', (select count(*) from network_marketing_contacts where org_id = p_org and next_follow_up_at is not null),
    'followups_overdue', (select count(*) from network_marketing_contacts where org_id = p_org and next_follow_up_at is not null and next_follow_up_at < now() and stage not in ('won_customer','won_distributor','lost')),
    'no_followup', (select count(*) from network_marketing_contacts where org_id = p_org and next_follow_up_at is null and stage not in ('won_customer','won_distributor','lost')),
    'members_joined_via_sponsor', (
      select count(*) from profiles p
      join memberships m on m.user_id = p.id
      where m.org_id = p_org and m.status = 'active' and p.sponsor_member_id is not null
        and m.joined_at >= p_start and m.joined_at < p_end
    ),
    'top_builders', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'name', name, 'directs', c) order by c desc), '[]'::jsonb)
      from (
        select sp.id as uid, sp.full_name as name, count(*) as c
        from profiles ch
        join profiles sp on sp.id = ch.sponsor_member_id
        join memberships m on m.user_id = ch.id and m.org_id = p_org and m.status = 'active'
        join memberships ms on ms.user_id = sp.id and ms.org_id = p_org and ms.status = 'active'
        group by sp.id, sp.full_name
        order by c desc limit 10
      ) t
    )
  ) into result;
  return result;
end;
$$;

-- ============================================================
-- report_teams
-- ============================================================
create or replace function report_teams(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;

  with bp as materialized (select * from report_bp_progress(p_org))
  select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'team_id', g.id,
      'name', g.name,
      'leader', lp.full_name,
      'members', (select count(*) from group_members gm join memberships m on m.user_id = gm.user_id and m.org_id = p_org and m.status = 'active' where gm.group_id = g.id),
      'bp_avg', (
        select coalesce(round(avg(case when b.required_total > 0 then b.required_done::numeric / b.required_total * 100 else 0 end)), 0)
        from group_members gm join bp b on b.user_id = gm.user_id where gm.group_id = g.id
      ),
      'network_growth', (
        select count(*) from group_members gm
        join profiles ch on ch.sponsor_member_id = gm.user_id
        join memberships m on m.user_id = ch.id and m.org_id = p_org and m.status = 'active'
        where gm.group_id = g.id and m.joined_at >= p_start and m.joined_at < p_end
      ),
      'income', (
        select coalesce(sum(e.amount), 0) from group_members gm
        join income_development_income_entries e on e.user_id = gm.user_id and e.org_id = p_org
        where gm.group_id = g.id and e.earned_on >= p_start::date and e.earned_on < p_end::date
      )
    ) as t
    from groups g
    left join profiles lp on lp.id = g.leader_id
    where g.org_id = p_org
  ) x;
  return result;
end;
$$;

-- ============================================================
-- report_income
-- ============================================================
create or replace function report_income(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'total_period', (select coalesce(sum(amount), 0) from income_development_income_entries where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date),
    'total_all', (select coalesce(sum(amount), 0) from income_development_income_entries where org_id = p_org),
    'entries_period', (select count(*) from income_development_income_entries where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date),
    'earners_period', (select count(distinct user_id) from income_development_income_entries where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', coalesce(source, 'Unspecified'), 'amount', amt) order by amt desc), '[]'::jsonb)
      from (
        select source, sum(amount) amt from income_development_income_entries
        where org_id = p_org and earned_on >= p_start::date and earned_on < p_end::date
        group by source
      ) s
    ),
    'per_member', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'name', name, 'amount', amt) order by amt desc), '[]'::jsonb)
      from (
        select p.id uid, p.full_name name, sum(e.amount) amt
        from income_development_income_entries e join profiles p on p.id = e.user_id
        where e.org_id = p_org and e.earned_on >= p_start::date and e.earned_on < p_end::date
        group by p.id, p.full_name
      ) m
    ),
    'milestones', (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select 'selected_skill' k, count(*) filter (where skill_selected_at is not null) v from income_development_progress where org_id = p_org
        union all select 'portfolio_built', count(*) filter (where portfolio_built_at is not null) from income_development_progress where org_id = p_org
        union all select 'freelancing_started', count(*) filter (where freelancing_started_at is not null) from income_development_progress where org_id = p_org
        union all select 'first_income', count(*) filter (where first_income_at is not null) from income_development_progress where org_id = p_org
        union all select 'consistency', count(*) filter (where consistency_at is not null) from income_development_progress where org_id = p_org
      ) s
    )
  ) into result;
  return result;
end;
$$;

-- ============================================================
-- report_member — one member's consolidated card for the drill-down
-- ============================================================
create or replace function report_member(p_org uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; v_total int; v_done int; v_since timestamptz; it business_path_items; items jsonb := '[]'::jsonb;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user) then
    raise exception 'member not in this office';
  end if;

  select coalesce(started_at, 'epoch'::timestamptz) into v_since
  from member_rank_progress where org_id = p_org and user_id = p_user;

  v_total := 0; v_done := 0;
  for it in
    select bi.* from business_path_items bi
    join member_rank_progress mp on mp.current_rank_id = bi.rank_id and mp.org_id = p_org and mp.user_id = p_user
    where bi.org_id = p_org
    order by bi.section, bi.order_index
  loop
    if it.is_required then v_total := v_total + 1; end if;
    declare c boolean := report_bp_item_complete(it, p_user, coalesce(v_since, 'epoch'::timestamptz));
    begin
      if it.is_required and c then v_done := v_done + 1; end if;
      items := items || jsonb_build_object('title', it.title, 'required', it.is_required, 'complete', c);
    end;
  end loop;

  select jsonb_build_object(
    'name', (select full_name from profiles where id = p_user),
    'rank', (select r.name from member_rank_progress mp left join business_path_ranks r on r.id = mp.current_rank_id where mp.org_id = p_org and mp.user_id = p_user),
    'bp_required_total', v_total,
    'bp_required_done', v_done,
    'bp_percent', case when v_total > 0 then round(v_done::numeric / v_total * 100) else 0 end,
    'bp_items', items,
    'goals_total', (select count(*) from member_monthly_goals where org_id = p_org and user_id = p_user),
    'goals_done', (select count(*) from member_monthly_goals where org_id = p_org and user_id = p_user and done),
    'direct_members', (select count(*) from profiles p join memberships m on m.user_id = p.id where p.sponsor_member_id = p_user and m.org_id = p_org and m.status = 'active'),
    'prospects', (select count(*) from network_marketing_contacts where org_id = p_org and user_id = p_user),
    'income_total', (select coalesce(sum(amount), 0) from income_development_income_entries where org_id = p_org and user_id = p_user),
    'exams_passed', (select count(*) from attempts where org_id = p_org and user_id = p_user and passed is true),
    'joined_at', (select joined_at from memberships where org_id = p_org and user_id = p_user),
    'last_activity', (
      select max(ts) from (
        select max(completed_at) ts from class_item_progress where org_id = p_org and user_id = p_user
        union all select max(submitted_at) from attempts where org_id = p_org and user_id = p_user
        union all select max(created_at) from network_marketing_activities where org_id = p_org and user_id = p_user
        union all select max(created_at) from member_daily_reports where org_id = p_org and user_id = p_user
      ) a
    )
  ) into result;
  return result;
end;
$$;

-- ---------- grants ----------
grant execute on function report_overview(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function report_business_path(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function report_learning(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function report_network(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function report_teams(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function report_income(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function report_member(uuid, uuid) to authenticated;
