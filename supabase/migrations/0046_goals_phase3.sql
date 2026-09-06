-- ============================================================
-- 0046 — Goals v2 phase 3:
--   * auto-tracked progress: a goal can pull its progress live from an
--     existing system (prospects added, income logged, modules completed,
--     …) instead of the member typing it. `goals_sync_auto(p_org)` runs on
--     Goals-page load and patches those goals.
--   * goal audit trail: a trigger writes an `audit_log` row on every goal
--     status change / creation (not on progress bumps — no noise), and a
--     scoped SELECT policy lets the owner / admins / the member's team
--     leader read those rows for the drawer timeline.
--   * lazy deadline reminders: `goal_deadline_reminders(p_org)` creates one
--     notification per goal at 7 / 3 / 1 / 0 days before `due_date`,
--     deduped. (Still no scheduler — fires on Goals-page load.)
-- ============================================================

alter table member_monthly_goals
  add column if not exists auto_source text,
  add column if not exists auto_area   text;

alter table member_monthly_goals
  add constraint member_monthly_goals_auto_source_check
  check (auto_source is null or auto_source in (
    'prospects_added', 'followups_logged', 'income_amount', 'income_entries',
    'direct_members', 'daily_reports', 'exams_passed', 'events_attended', 'learning_modules'
  ));

-- ---------- auto-progress sync ----------
create or replace function goals_sync_auto(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare g record; v numeric; d date;
begin
  if not is_org_member(p_org) then return; end if;

  for g in
    select * from member_monthly_goals
    where org_id = p_org and user_id = auth.uid()
      and auto_source is not null and status in ('active', 'changes_requested')
  loop
    d := coalesce(g.period_start, (g.month || '-01')::date);
    v := case g.auto_source
      when 'prospects_added' then (select count(*) from network_marketing_contacts where user_id = auth.uid() and org_id = p_org and created_at::date >= d)
      when 'followups_logged' then (select count(*) from network_marketing_activities where user_id = auth.uid() and org_id = p_org and created_at::date >= d)
      when 'income_amount' then (select coalesce(sum(amount), 0) from income_development_income_entries where user_id = auth.uid() and org_id = p_org and earned_on >= d)
      when 'income_entries' then (select count(*) from income_development_income_entries where user_id = auth.uid() and org_id = p_org and earned_on >= d)
      when 'direct_members' then (select count(*) from profiles p join memberships m on m.user_id = p.id where p.sponsor_member_id = auth.uid() and m.org_id = p_org and m.status = 'active')
      when 'daily_reports' then (select count(*) from member_daily_reports where user_id = auth.uid() and org_id = p_org and report_on >= d)
      when 'exams_passed' then (select count(*) from attempts where user_id = auth.uid() and org_id = p_org and passed is true and coalesce(submitted_at::date, started_at::date) >= d)
      when 'events_attended' then (select count(distinct ea.event_id) from event_attendees ea join events e on e.id = ea.event_id where ea.user_id = auth.uid() and e.org_id = p_org and ea.joined_at::date >= d)
      when 'learning_modules' then (select report_area_modules_done(p_org, g.auto_area, auth.uid()))
      else null
    end;
    if v is null then continue; end if;

    update member_monthly_goals
    set progress_value = v,
        progress = round(v),
        done = (target_value is not null and v >= target_value),
        updated_at = now()
    where id = g.id and progress_value is distinct from v;
  end loop;
end;
$$;

grant execute on function goals_sync_auto(uuid) to authenticated;

-- ---------- audit trail ----------
create or replace function goal_audit_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.org_id, auth.uid(), 'goal.created', 'goal', new.id,
            jsonb_build_object('title', new.title, 'status', new.status, 'period', new.month));
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.org_id, auth.uid(), 'goal.' || new.status, 'goal', new.id,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'review_note', new.review_note, 'title', new.title));
  end if;
  return new;
end;
$$;

drop trigger if exists goal_audit on member_monthly_goals;
create trigger goal_audit
  after insert or update on member_monthly_goals
  for each row execute function goal_audit_trg();

-- scoped read of goal audit rows (audit_log has RLS on + no policies today)
drop policy if exists "read goal audit entries" on audit_log;
create policy "read goal audit entries"
  on audit_log for select
  using (
    entity_type = 'goal' and (
      exists (select 1 from member_monthly_goals g where g.id = audit_log.entity_id and g.user_id = auth.uid())
      or has_org_role(org_id, array['admin'])
      or (has_org_role(org_id, array['team_leader']) and exists (
        select 1 from member_monthly_goals g
        join group_members gm on gm.user_id = g.user_id
        join groups grp on grp.id = gm.group_id
        where g.id = audit_log.entity_id and grp.org_id = audit_log.org_id and grp.leader_id = auth.uid()
      ))
    )
  );

-- ---------- lazy deadline reminders ----------
create or replace function goal_deadline_reminders(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare g record; dd int; phrase text;
begin
  if not is_org_member(p_org) then return; end if;

  for g in
    select * from member_monthly_goals
    where org_id = p_org and user_id = auth.uid()
      and status in ('active', 'changes_requested')
      and due_date is not null and due_date >= current_date and due_date <= current_date + 7
  loop
    dd := g.due_date - current_date;
    if dd not in (0, 1, 3, 7) then continue; end if;
    if exists (
      select 1 from notifications
      where user_id = auth.uid() and type = 'goal_deadline'
        and payload->>'goal_id' = g.id::text and payload->>'days' = dd::text
    ) then continue; end if;

    phrase := case dd when 0 then 'is due today' when 1 then 'is due tomorrow' else 'is due in ' || dd || ' days' end;
    insert into notifications (org_id, user_id, type, channel, payload)
    values (p_org, auth.uid(), 'goal_deadline', 'in_app',
            jsonb_build_object('text', 'Goal "' || g.title || '" ' || phrase,
                               'link', '/goals', 'goal_id', g.id::text, 'days', dd::text));
  end loop;
end;
$$;

grant execute on function goal_deadline_reminders(uuid) to authenticated;
