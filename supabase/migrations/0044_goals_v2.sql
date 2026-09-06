-- ============================================================
-- Goals v2 (0044) — turns member_monthly_goals from a personal checklist
-- into a planning + review + accountability system, WITHOUT a new table
-- (every consumer — the two Business Path evaluators, the report RPCs, and
-- both dashboards — keeps reading member_monthly_goals with the same
-- `month` key). Nothing is dropped; the legacy `target` / `progress` /
-- `done` / `metric` columns stay for rollback and are kept in sync.
--
-- Lifecycle: draft -> active -> submitted -> approved
--            submitted -> changes_requested -> active (resubmit)
--            active -> month_closed_incomplete   (month ended, target missed)
--            active -> submitted                 (month ended, target met — auto)
--            submitted/active -> rejected | cancelled
--            legacy_completed = migrated `done` rows from a past month
--
-- State transitions run through SECURITY DEFINER RPCs (goal_submit /
-- goal_withdraw / goal_review / goal_carry_forward / close_month_goals);
-- direct client writes are limited by RLS to the open states.
-- ============================================================

-- ---------- new columns ----------
alter table member_monthly_goals
  add column if not exists description     text,
  add column if not exists category        text,
  add column if not exists goal_type       text not null default 'number',
  add column if not exists unit            text,
  add column if not exists target_value    numeric(14, 2),
  add column if not exists progress_value  numeric(14, 2) not null default 0,
  add column if not exists priority        text not null default 'normal',
  add column if not exists due_date        date,
  add column if not exists status          text not null default 'active',
  add column if not exists period_type     text not null default 'monthly',
  add column if not exists period_start    date,
  add column if not exists period_end      date,
  add column if not exists parent_goal_id  uuid references member_monthly_goals(id) on delete set null,
  add column if not exists progress_mode   text not null default 'manual',
  add column if not exists submitted_at    timestamptz,
  add column if not exists submission_note text,
  add column if not exists evidence_url    text,
  add column if not exists reviewed_at     timestamptz,
  add column if not exists reviewed_by     uuid references profiles(id) on delete set null,
  add column if not exists review_note     text,
  add column if not exists closed_at       timestamptz;

alter table member_monthly_goals
  add constraint member_monthly_goals_goal_type_check
    check (goal_type in ('binary', 'number', 'currency', 'percent')),
  add constraint member_monthly_goals_priority_check
    check (priority in ('low', 'normal', 'high')),
  add constraint member_monthly_goals_period_type_check
    check (period_type in ('monthly', 'quarter')),
  add constraint member_monthly_goals_progress_mode_check
    check (progress_mode in ('manual', 'auto')),
  add constraint member_monthly_goals_category_check
    check (category is null or category in
      ('learning', 'network', 'income', 'personal_development', 'business_path', 'team', 'other')),
  add constraint member_monthly_goals_status_check
    check (status in
      ('draft', 'active', 'submitted', 'changes_requested', 'approved',
       'rejected', 'month_closed_incomplete', 'cancelled', 'legacy_completed'));

-- ---------- backfill existing rows ----------
update member_monthly_goals
set
  period_type   = 'monthly',
  period_start  = (month || '-01')::date,
  period_end    = ((month || '-01')::date + interval '1 month' - interval '1 day')::date,
  goal_type     = case when target is not null then 'number' else 'binary' end,
  target_value  = target,
  progress_value = progress,
  unit          = metric,
  status = case
    when done  and (month || '-01')::date < date_trunc('month', now())::date then 'legacy_completed'
    when       (month || '-01')::date < date_trunc('month', now())::date then 'month_closed_incomplete'
    else 'active'
  end
where period_start is null;

create index if not exists member_monthly_goals_org_status_idx on member_monthly_goals (org_id, status);
create index if not exists member_monthly_goals_period_idx on member_monthly_goals (org_id, period_end);
create index if not exists member_monthly_goals_org_user_type_idx on member_monthly_goals (org_id, user_id, period_type, month);

-- ---------- RLS: replace the blanket staff-read ----------
drop policy if exists "staff read all monthly goals in their org" on member_monthly_goals;
drop policy if exists "members manage their own monthly goals" on member_monthly_goals;

create policy "members read their own goals"
  on member_monthly_goals for select using (user_id = auth.uid());

create policy "members create their own goals"
  on member_monthly_goals for insert
  with check (user_id = auth.uid() and status in ('draft', 'active'));

create policy "members edit their own open goals"
  on member_monthly_goals for update
  using (user_id = auth.uid() and status in ('draft', 'active', 'changes_requested'))
  with check (user_id = auth.uid() and status in ('draft', 'active', 'changes_requested'));

create policy "members delete their own draft goals"
  on member_monthly_goals for delete
  using (user_id = auth.uid() and status = 'draft');

create policy "admins read all goals in their org"
  on member_monthly_goals for select
  using (has_org_role(org_id, array['admin']));

create policy "team leaders read their team's goals"
  on member_monthly_goals for select
  using (
    has_org_role(org_id, array['team_leader'])
    and exists (
      select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.org_id = member_monthly_goals.org_id
        and g.leader_id = auth.uid()
        and gm.user_id = member_monthly_goals.user_id
    )
  );

-- ============================================================
-- Transition RPCs
-- ============================================================
create or replace function goal_submit(p_goal uuid, p_note text default null, p_evidence text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g member_monthly_goals;
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

  insert into notifications (org_id, user_id, type, channel, payload)
  select g.org_id, m.user_id, 'goal_submitted', 'in_app',
         jsonb_build_object('goal_id', g.id, 'goal', g.title, 'member', (select full_name from profiles where id = g.user_id))
  from memberships m
  where m.org_id = g.org_id and m.status = 'active' and m.role = 'admin';
end;
$$;

create or replace function goal_withdraw(p_goal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g member_monthly_goals;
begin
  select * into g from member_monthly_goals where id = p_goal;
  if g.id is null or g.user_id <> auth.uid() then raise exception 'not permitted'; end if;
  if g.status <> 'submitted' then raise exception 'goal is not awaiting review'; end if;
  update member_monthly_goals
  set status = 'active', submitted_at = null, updated_at = now()
  where id = p_goal;
end;
$$;

create or replace function goal_review(p_goal uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  g member_monthly_goals;
  new_status text;
  may_review boolean;
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

  insert into notifications (org_id, user_id, type, channel, payload)
  values (g.org_id, g.user_id,
          case p_decision when 'approve' then 'goal_approved' when 'changes' then 'goal_changes_requested' else 'goal_rejected' end,
          'in_app',
          jsonb_build_object('goal_id', g.id, 'goal', g.title, 'note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;

create or replace function goal_carry_forward(p_goal uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g member_monthly_goals;
  next_month text;
  ps date;
  new_id uuid;
begin
  select * into g from member_monthly_goals where id = p_goal;
  if g.id is null or g.user_id <> auth.uid() then raise exception 'not your goal'; end if;
  if g.status not in ('month_closed_incomplete', 'rejected', 'changes_requested') then
    raise exception 'only an unfinished goal can be carried forward';
  end if;

  ps := ((g.month || '-01')::date + interval '1 month')::date;
  next_month := to_char(ps, 'YYYY-MM');

  insert into member_monthly_goals
    (org_id, user_id, month, title, description, category, goal_type, unit, metric,
     target, target_value, progress, progress_value, done, priority, due_date,
     status, period_type, period_start, period_end, parent_goal_id, progress_mode)
  values
    (g.org_id, g.user_id, next_month, g.title, g.description, g.category, g.goal_type, g.unit, g.metric,
     g.target, g.target_value, 0, 0, false, g.priority, null,
     'draft', 'monthly', ps, (ps + interval '1 month' - interval '1 day')::date, g.id, g.progress_mode)
  returning id into new_id;

  return new_id;
end;
$$;

-- Lazy month close — idempotent (only ever touches status='active' rows
-- whose period has ended). Safe to call from any org member's page load.
create or replace function close_month_goals(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
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

    -- one month-end summary notification per member per closed period
    if not exists (
      select 1 from notifications
      where user_id = r.user_id and type = 'goal_month_closed' and payload->>'period' = r.month
    ) then
      insert into notifications (org_id, user_id, type, channel, payload)
      values (p_org, r.user_id, 'goal_month_closed', 'in_app', jsonb_build_object('period', r.month));
    end if;
  end loop;

  return n;
end;
$$;

-- Start-of-month reminder — one per member per period, no spam.
create or replace function goal_setup_reminder(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare this_month text := to_char(now(), 'YYYY-MM');
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
          jsonb_build_object('period', this_month,
                             'label', to_char(now(), 'FMMonth YYYY')));
end;
$$;

grant execute on function goal_submit(uuid, text, text) to authenticated;
grant execute on function goal_withdraw(uuid) to authenticated;
grant execute on function goal_review(uuid, text, text) to authenticated;
grant execute on function goal_carry_forward(uuid) to authenticated;
grant execute on function close_month_goals(uuid) to authenticated;
grant execute on function goal_setup_reminder(uuid) to authenticated;
