-- ============================================================
-- Business Path requirements v2 — makes each rank's requirements
-- rank-aware, automatically validated, and (optionally) staff-approved,
-- so the member dashboard can render whatever the Admin configured for
-- the member's current rank.
--
-- Adds to business_path_items:
--   validation_mode  automatic | manual  (default automatic)
--   learning_area    relational field for the common learning_count rule
--   config           jsonb for exotic rules (e.g. profile-field list)
--   new kinds: profile_completion, onboarding_completion, learning_count,
--              goal_created, three_month_goals, direct_member_count
--
-- Adds to business_path_item_progress an approval workflow:
--   status  awaiting_approval | approved | rejected | changes_requested
--           | complete   (existing rows = 'complete' = approved)
--   reviewed_by / reviewed_at / review_note
--
-- Seeds Prospect + Newbie default requirements — ONLY into ranks that
-- currently have zero items, so hand-built paths are untouched. Nothing
-- is dropped; rollback = drop the added columns.
-- ============================================================

-- ---------- business_path_items: validation + rule config ----------
alter table business_path_items add column validation_mode text not null default 'automatic';
alter table business_path_items add column learning_area   text;
alter table business_path_items add column config          jsonb;

-- Rebuild the three inline CHECKs from 0035 as named constraints so the
-- kind list can grow.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'business_path_items'::regclass and contype = 'c'
  loop
    execute format('alter table business_path_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table business_path_items
  add constraint business_path_items_section_check check (section in ('learning', 'task')),
  add constraint business_path_items_validation_check check (validation_mode in ('automatic', 'manual')),
  add constraint business_path_items_kind_check check (kind in (
    'class', 'exam', 'assignment', 'resource', 'link',
    'daily_reports', 'prospects_added', 'followups_logged', 'event_attendance', 'income_logged', 'monthly_goal',
    'manual_admin', 'manual_self',
    'profile_completion', 'onboarding_completion', 'learning_count', 'goal_created',
    'three_month_goals', 'direct_member_count'
  )),
  add constraint business_path_items_pointer_check check (
    case kind
      when 'class'      then class_id is not null
      when 'exam'       then exam_id is not null
      when 'assignment' then coursework_assignment_id is not null
      when 'resource'   then resource_id is not null
      when 'link'       then link_url is not null
      when 'learning_count' then learning_area is not null
      else true
    end
  );

-- ---------- business_path_item_progress: approval workflow ----------
alter table business_path_item_progress add column status      text not null default 'complete';
alter table business_path_item_progress add column reviewed_by uuid references profiles(id) on delete set null;
alter table business_path_item_progress add column reviewed_at timestamptz;
alter table business_path_item_progress add column review_note text;
alter table business_path_item_progress
  add constraint business_path_item_progress_status_check
  check (status in ('awaiting_approval', 'approved', 'rejected', 'changes_requested', 'complete'));

-- Members may now also submit a MANUAL item for approval (status
-- 'awaiting_approval'); they still cannot self-approve a manual item.
drop policy if exists "members self-confirm their own path items" on business_path_item_progress;
create policy "members act on their own path items"
  on business_path_item_progress for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      (status in ('approved', 'complete') and exists (
        select 1 from business_path_items i where i.id = item_id and i.kind in ('manual_self', 'resource', 'link')
      ))
      or (status = 'awaiting_approval' and exists (
        select 1 from business_path_items i where i.id = item_id and i.validation_mode = 'manual'
      ))
    )
  );
-- staff approve/reject policy from 0035 ("staff mark manual path items in
-- their org", for all, admin+team_leader) already covers review writes.

-- ============================================================
-- Seed Prospect + Newbie default requirements
-- ============================================================
do $$
declare
  o record;
  admin_id uuid;
  prospect_rank uuid;
  newbie_rank uuid;
begin
  for o in select id as org_id from organizations loop
    select p.id into admin_id
    from profiles p join memberships m on m.user_id = p.id
    where m.org_id = o.org_id and m.role = 'admin' and m.status = 'active'
    limit 1;
    if admin_id is null then continue; end if;

    select id into prospect_rank from business_path_ranks
      where org_id = o.org_id order by (slug = 'prospect') desc, order_index limit 1;
    select id into newbie_rank from business_path_ranks
      where org_id = o.org_id order by (slug = 'newbie') desc, order_index offset 1 limit 1;

    if prospect_rank is not null
       and not exists (select 1 from business_path_items where rank_id = prospect_rank) then
      insert into business_path_items
        (org_id, rank_id, section, kind, title, instructions, order_index, is_required, validation_mode, config, created_by)
      values
        (o.org_id, prospect_rank, 'task', 'profile_completion', 'Complete your profile',
         'Add your phone number, a profile photo, and who introduced you.', 0, true, 'automatic',
         '{"fields":["phone","avatar_url","sponsor"]}'::jsonb, admin_id),
        (o.org_id, prospect_rank, 'task', 'onboarding_completion', 'Complete onboarding',
         'Work through every onboarding module.', 1, true, 'automatic', null, admin_id),
        (o.org_id, prospect_rank, 'task', 'goal_created', 'Set your goals',
         'Create at least one goal for this month.', 2, true, 'automatic', null, admin_id);
    end if;

    if newbie_rank is not null
       and not exists (select 1 from business_path_items where rank_id = newbie_rank) then
      insert into business_path_items
        (org_id, rank_id, section, kind, title, instructions, order_index, is_required, validation_mode, learning_area, target_count, created_by)
      values
        (o.org_id, newbie_rank, 'learning', 'learning_count', 'Complete Network Marketing training',
         'Finish the required Network Marketing modules.', 0, true, 'automatic', 'network_marketing', 3, admin_id),
        (o.org_id, newbie_rank, 'learning', 'learning_count', 'Complete Freelancing training',
         'Finish the required Freelancing modules.', 1, true, 'automatic', 'freelancing', 2, admin_id),
        (o.org_id, newbie_rank, 'learning', 'learning_count', 'Complete Personal Development training',
         'Finish the required Personal Development modules.', 2, true, 'automatic', 'personal_development', 2, admin_id);
      insert into business_path_items
        (org_id, rank_id, section, kind, title, instructions, order_index, is_required, validation_mode, created_by)
      values
        (o.org_id, newbie_rank, 'task', 'three_month_goals', 'Set your 3-month goals',
         'Plan goals for this month and the next two.', 3, true, 'automatic', admin_id);
    end if;
  end loop;
end $$;
