-- ============================================================
-- Team Leader gains the same class-management rights as Trainer, for
-- both Skill Development and Income Development's Skill Catalog (they
-- share the classes/class_modules/class_module_items schema — see
-- 0029_class_purpose.sql). The frontend gate (ClassDetail.tsx,
-- SkillDevelopmentHub.tsx) already widened to admin/trainer/team_leader;
-- without this, a Team Leader would see the class editor but every write
-- would be rejected by RLS.
--
-- ClassEditor.tsx's write surface isn't just classes/modules/items — it
-- also inserts resources (inline "+ Add new PDF/video"), and
-- coursework_assignments/coursework_targets (adding an assignment-type
-- item), so those need the same widening or building a class with either
-- of those item types would fail partway through for a Team Leader.
-- Reviewing coursework submissions afterwards is a separate, downstream
-- workflow — left untouched here, not part of building the class itself.
-- ============================================================

alter policy "org admins manage classes" on classes
  using (has_org_role(org_id, array['admin','trainer','team_leader']))
  with check (has_org_role(org_id, array['admin','trainer','team_leader']));

alter policy "org admins manage class modules" on class_modules
  using (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and has_org_role(c.org_id, array['admin','trainer','team_leader'])
  ))
  with check (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and has_org_role(c.org_id, array['admin','trainer','team_leader'])
  ));

alter policy "org admins manage class module items" on class_module_items
  using (exists (
    select 1 from class_modules m where m.id = class_module_items.module_id
      and has_org_role(m.org_id, array['admin','trainer','team_leader'])
  ))
  with check (exists (
    select 1 from class_modules m where m.id = class_module_items.module_id
      and has_org_role(m.org_id, array['admin','trainer','team_leader'])
  ));

alter policy "owners/admins read all class progress in their org" on class_item_progress
  using (has_org_role(org_id, array['admin','trainer','team_leader']));

alter policy "org admins manage class trainers" on class_trainers
  using (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and has_org_role(c.org_id, array['admin','trainer','team_leader'])
  ))
  with check (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and has_org_role(c.org_id, array['admin','trainer','team_leader'])
  ));

alter policy "owners/admins/instructors can manage resources" on resources
  using (has_org_role(org_id, array['admin','trainer','team_leader']))
  with check (has_org_role(org_id, array['admin','trainer','team_leader']));

alter policy "org admins manage coursework assignments" on coursework_assignments
  using (has_org_role(org_id, array['admin','trainer','team_leader']))
  with check (has_org_role(org_id, array['admin','trainer','team_leader']));

alter policy "org admins manage coursework targets" on coursework_targets
  using (has_org_role(org_id, array['admin','trainer','team_leader']))
  with check (has_org_role(org_id, array['admin','trainer','team_leader']));
