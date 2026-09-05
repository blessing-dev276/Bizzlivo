-- ============================================================
-- HQ360 — activates the dormant Phase-2 learning_paths scaffold
-- ("Learning Systems") so Training Analytics can report real counts.
-- No authoring UI ships yet — admins can't create a Learning System
-- through the app today, so these will read as empty until that's
-- built separately. This migration only adds what's needed to query
-- them safely: a status field (mirrors exams.status) and RLS.
-- ============================================================

alter table learning_paths add column status text not null default 'draft';
alter table learning_paths add constraint learning_paths_status_check
  check (status in ('draft', 'published', 'archived'));

create policy "org admins manage learning paths"
  on learning_paths for all
  using (has_org_role(org_id, array['owner', 'admin', 'instructor']))
  with check (has_org_role(org_id, array['owner', 'admin', 'instructor']));

create policy "org admins manage learning path steps"
  on learning_path_steps for all
  using (exists (
    select 1 from learning_paths p where p.id = learning_path_steps.path_id
      and has_org_role(p.org_id, array['owner', 'admin', 'instructor'])
  ))
  with check (exists (
    select 1 from learning_paths p where p.id = learning_path_steps.path_id
      and has_org_role(p.org_id, array['owner', 'admin', 'instructor'])
  ));

create policy "org admins read learning path progress"
  on learning_path_progress for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from learning_paths p where p.id = learning_path_progress.path_id
        and has_org_role(p.org_id, array['owner', 'admin', 'instructor'])
    )
  );
