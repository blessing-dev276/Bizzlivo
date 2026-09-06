-- ============================================================
-- 0045 — Goals v2 integrations:
--   * one-time legacy grace: current-month goals already marked `done`
--     when 0044 shipped are auto-approved so no member's Business Path
--     `monthly_goal` requirement regresses. reviewed_by IS NULL + an
--     explicit review_note make it clear this was automatic, not an admin.
--   * report_bp_item_complete.monthly_goal now keys on status='approved'
--     (matches the frontend evaluator updated in src/lib/businessPath.ts).
--   * the goal notification RPCs now write {text, link, ...} payloads so
--     the notification bell renders + deep-links them.
--   * report_goals(p_org, start, end) for the Reports & Insights Goals tab.
-- ============================================================

-- ---------- 1. legacy grace ----------
update member_monthly_goals
set status = 'approved',
    reviewed_at = now(),
    review_note = 'Auto-approved during the goals-review rollout — this goal was already marked complete.',
    updated_at = now()
where status = 'active'
  and done = true
  and (month || '-01')::date >= date_trunc('month', now())::date;

-- ---------- 2. BP evaluator: monthly_goal -> approved ----------
create or replace function report_bp_item_complete(
  p_item business_path_items, p_user uuid, p_since timestamptz
) returns boolean language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  n int;
  amt numeric;
  tgt int := coalesce(p_item.target_count, 1);
begin
  case p_item.kind
    when 'class' then
      return exists (select 1 from class_modules m where m.class_id = p_item.class_id and m.status = 'published')
        and not exists (select 1 from class_modules m
          where m.class_id = p_item.class_id and m.status = 'published' and not report_module_complete(m.id, p_user));
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
      select count(*) into n from member_daily_reports r where r.user_id = p_user and r.org_id = p_item.org_id and r.report_on >= p_since::date;
      return n >= tgt;
    when 'prospects_added' then
      select count(*) into n from network_marketing_contacts x where x.user_id = p_user and x.org_id = p_item.org_id and x.created_at >= p_since;
      return n >= tgt;
    when 'followups_logged' then
      select count(*) into n from network_marketing_activities x where x.user_id = p_user and x.org_id = p_item.org_id and x.created_at >= p_since;
      return n >= tgt;
    when 'event_attendance' then
      if p_item.event_id is not null then
        return exists (select 1 from event_attendees ea where ea.event_id = p_item.event_id and ea.user_id = p_user);
      end if;
      select count(distinct ea.event_id) into n from event_attendees ea
        join events e on e.id = ea.event_id where ea.user_id = p_user and e.org_id = p_item.org_id;
      return n >= tgt;
    when 'income_logged' then
      if p_item.target_amount is not null then
        select coalesce(sum(e.amount), 0) into amt from income_development_income_entries e
          where e.user_id = p_user and e.org_id = p_item.org_id and e.earned_on >= p_since::date;
        return amt >= p_item.target_amount;
      end if;
      select count(*) into n from income_development_income_entries e
        where e.user_id = p_user and e.org_id = p_item.org_id and e.earned_on >= p_since::date;
      return n >= tgt;
    when 'monthly_goal' then
      return exists (select 1 from member_monthly_goals g
        where g.user_id = p_user and g.org_id = p_item.org_id
          and g.month = to_char(now(), 'YYYY-MM') and g.status = 'approved');
    when 'profile_completion' then
      return exists (select 1 from profiles p where p.id = p_user
        and p.phone is not null and p.avatar_url is not null
        and (p.sponsor_member_id is not null or p.sponsor_name is not null));
    when 'onboarding_completion' then
      return not exists (select 1 from onboarding_step_items si where si.org_id = p_item.org_id
        and not exists (select 1 from onboarding_item_progress ip where ip.item_id = si.id and ip.user_id = p_user));
    when 'learning_count' then
      return report_area_modules_done(p_item.org_id, p_item.learning_area, p_user) >= tgt;
    when 'goal_created' then
      return exists (select 1 from member_monthly_goals g where g.user_id = p_user and g.org_id = p_item.org_id
        and g.month = to_char(now(), 'YYYY-MM'));
    when 'three_month_goals' then
      return exists (select 1 from member_monthly_goals g
        where g.user_id = p_user and g.org_id = p_item.org_id and g.period_type = 'quarter'
          and g.period_start <= current_date and g.period_end >= current_date);
    when 'direct_member_count' then
      select count(*) into n from profiles p join memberships m on m.user_id = p.id
        where p.sponsor_member_id = p_user and m.org_id = p_item.org_id and m.status = 'active';
      return n >= tgt;
    else return false;
  end case;
end;
$$;

-- ---------- 3. goal notifications: {text, link} payloads ----------
create or replace function goal_submit(p_goal uuid, p_note text default null, p_evidence text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g member_monthly_goals; who text;
begin
  select * into g from member_monthly_goals where id = p_goal;
  if g.id is null then raise exception 'goal not found'; end if;
  if g.user_id <> auth.uid() then raise exception 'not your goal'; end if;
  if g.status not in ('draft', 'active', 'changes_requested') then
    raise exception 'goal cannot be submitted from status %', g.status;
  end if;

  update member_monthly_goals
  set status = 'submitted', submitted_at = now(),
      submission_note = nullif(trim(coalesce(p_note, '')), ''),
      evidence_url = nullif(trim(coalesce(p_evidence, '')), ''),
      review_note = null, updated_at = now()
  where id = p_goal;

  select full_name into who from profiles where id = g.user_id;
  insert into notifications (org_id, user_id, type, channel, payload)
  select g.org_id, m.user_id, 'goal_submitted', 'in_app',
         jsonb_build_object('text', coalesce(who, 'A member') || ' submitted a goal for review: "' || g.title || '"',
                            'link', '/goals/review', 'goal_id', g.id)
  from memberships m
  where m.org_id = g.org_id and m.status = 'active' and m.role = 'admin';
end;
$$;

create or replace function goal_review(p_goal uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  g member_monthly_goals;
  new_status text;
  may_review boolean;
  msg text;
begin
  select * into g from member_monthly_goals where id = p_goal;
  if g.id is null then raise exception 'goal not found'; end if;
  if g.status <> 'submitted' then raise exception 'goal is not awaiting review'; end if;

  may_review := has_org_role(g.org_id, array['admin'])
    or (has_org_role(g.org_id, array['team_leader']) and exists (
      select 1 from groups grp
      join group_members gm on gm.group_id = grp.id
      where grp.org_id = g.org_id and grp.leader_id = auth.uid() and gm.user_id = g.user_id
    ));
  if not may_review then raise exception 'not permitted to review this goal'; end if;
  if g.user_id = auth.uid() then raise exception 'cannot review your own goal'; end if;

  new_status := case p_decision
    when 'approve' then 'approved'
    when 'changes' then 'changes_requested'
    when 'reject'  then 'rejected'
    else null end;
  if new_status is null then raise exception 'invalid decision %', p_decision; end if;

  update member_monthly_goals
  set status = new_status,
      reviewed_at = now(), reviewed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      done = (new_status = 'approved') or done,
      updated_at = now()
  where id = p_goal;

  msg := case p_decision
    when 'approve' then 'Your goal "' || g.title || '" was approved'
    when 'changes' then 'Changes requested on your goal "' || g.title || '"'
    else 'Your goal "' || g.title || '" was not approved' end;

  insert into notifications (org_id, user_id, type, channel, payload)
  values (g.org_id, g.user_id,
          case p_decision when 'approve' then 'goal_approved' when 'changes' then 'goal_changes_requested' else 'goal_rejected' end,
          'in_app',
          jsonb_build_object('text', msg, 'link', '/goals', 'goal_id', g.id,
                             'note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;

create or replace function close_month_goals(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; lbl text;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;

  for r in
    select * from member_monthly_goals
    where org_id = p_org and status = 'active' and period_end is not null and period_end < current_date
    for update skip locked
  loop
    if (r.goal_type = 'binary' and r.done)
       or (r.target_value is not null and r.progress_value >= r.target_value) then
      update member_monthly_goals
      set status = 'submitted', submitted_at = coalesce(submitted_at, now()), closed_at = now(), updated_at = now()
      where id = r.id;
    else
      update member_monthly_goals
      set status = 'month_closed_incomplete', closed_at = now(), updated_at = now()
      where id = r.id;
    end if;
    n := n + 1;

    if not exists (
      select 1 from notifications
      where user_id = r.user_id and type = 'goal_month_closed' and payload->>'period' = r.month
    ) then
      lbl := to_char((r.month || '-01')::date, 'FMMonth YYYY');
      insert into notifications (org_id, user_id, type, channel, payload)
      values (p_org, r.user_id, 'goal_month_closed', 'in_app',
              jsonb_build_object('text', lbl || ' goals closed — review your summary and plan next month',
                                 'link', '/goals', 'period', r.month));
    end if;
  end loop;

  return n;
end;
$$;

create or replace function goal_setup_reminder(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare this_month text := to_char(now(), 'YYYY-MM'); lbl text := to_char(now(), 'FMMonth');
begin
  if not is_org_member(p_org) then return; end if;
  if exists (select 1 from member_monthly_goals where org_id = p_org and user_id = auth.uid() and month = this_month) then
    return;
  end if;
  if exists (
    select 1 from notifications
    where org_id = p_org and user_id = auth.uid() and type = 'goal_setup_reminder' and payload->>'period' = this_month
  ) then
    return;
  end if;
  insert into notifications (org_id, user_id, type, channel, payload)
  values (p_org, auth.uid(), 'goal_setup_reminder', 'in_app',
          jsonb_build_object('text', 'Set your ' || lbl || ' goals', 'link', '/goals', 'period', this_month));
end;
$$;

-- ---------- 4. report_goals for Reports & Insights ----------
create or replace function report_goals(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare result jsonb; this_month text := to_char(now(), 'YYYY-MM');
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'not authorized'; end if;

  with actives as (
    select user_id from memberships where org_id = p_org and status = 'active'
  ),
  month_goals as (
    select * from member_monthly_goals where org_id = p_org and period_type = 'monthly' and month = this_month
  ),
  window_goals as (
    select * from member_monthly_goals where org_id = p_org and created_at >= p_start and created_at < p_end
  )
  select jsonb_build_object(
    'members', (select count(*) from actives),
    'members_with_goals', (select count(distinct user_id) from month_goals where user_id in (select user_id from actives)),
    'members_missing', (select count(*) from actives a where not exists (select 1 from month_goals g where g.user_id = a.user_id)),
    'quarter_plans', (select count(distinct user_id) from member_monthly_goals
                      where org_id = p_org and period_type = 'quarter' and period_end >= current_date),
    'created_in_window', (select count(*) from window_goals),
    'submitted_in_window', (select count(*) from member_monthly_goals where org_id = p_org and submitted_at >= p_start and submitted_at < p_end),
    'approved_in_window', (select count(*) from member_monthly_goals where org_id = p_org and status = 'approved' and reviewed_at >= p_start and reviewed_at < p_end),
    'rejected_in_window', (select count(*) from member_monthly_goals where org_id = p_org and status = 'rejected' and reviewed_at >= p_start and reviewed_at < p_end),
    'awaiting_review', (select count(*) from member_monthly_goals where org_id = p_org and status = 'submitted'),
    'this_month_status', (
      select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (
        select status, count(*) c from month_goals group by status
      ) s
    ),
    'this_month_avg_percent', (
      select coalesce(round(avg(
        case
          when goal_type = 'binary' then case when done then 100 else 0 end
          when target_value is null or target_value <= 0 then case when done then 100 else 0 end
          else least(100, round(progress_value / target_value * 100))
        end
      )), 0)
      from month_goals
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(category, 'other'), 'goals', c, 'avg_percent', ap) order by c desc), '[]'::jsonb)
      from (
        select category, count(*) c,
          round(avg(case
            when goal_type = 'binary' then case when done then 100 else 0 end
            when target_value is null or target_value <= 0 then case when done then 100 else 0 end
            else least(100, round(progress_value / target_value * 100)) end)) ap
        from month_goals group by category
      ) s
    ),
    'by_team', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'team', g.name,
        'members', (select count(*) from group_members gm join actives a on a.user_id = gm.user_id where gm.group_id = g.id),
        'with_goals', (select count(distinct gm.user_id) from group_members gm join month_goals mg on mg.user_id = gm.user_id where gm.group_id = g.id),
        'approved', (select count(*) from group_members gm join month_goals mg on mg.user_id = gm.user_id where gm.group_id = g.id and mg.status = 'approved')
      ) order by g.name), '[]'::jsonb)
      from groups g where g.org_id = p_org
    )
  ) into result;
  return result;
exception when others then
  return jsonb_build_object('_error', sqlerrm, '_at', 'report_goals');
end;
$$;

grant execute on function report_goals(uuid, timestamptz, timestamptz) to authenticated;
