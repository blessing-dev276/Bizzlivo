-- ============================================================
-- Tasks: a single office-wide, ordered learning flow that guides members
-- day by day. Each step is a thin pointer into content that already lives
-- in the Learning Center — a Skill/Income Development class, a published
-- exam, or a coursework assignment — same "don't duplicate content"
-- approach as class_module_items (0022_skill_development_classes.sql).
--
-- No separate progress table: completion of a step is derived live from
-- the signal that content type already tracks elsewhere (class_item_progress
-- + attempts + coursework_submissions for a class's items, attempts for an
-- exam, coursework_submissions for an assignment) — see TasksMember.tsx.
-- "One step unlocks per day" is enforced client-side: step N+1 only shows
-- as available once step N's derived completion timestamp is >=24h old.
--
-- Admin, Trainer, and Team Leader can all edit the flow — same tier as
-- Skill/Income Development's class management (0031).
-- ============================================================

create table task_flow_steps (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  title                     text not null,
  description               text,
  order_index               int not null default 0,
  type                      text not null, -- class / exam / assignment
  class_id                  uuid references classes(id) on delete cascade,
  exam_id                   uuid references exams(id) on delete cascade,
  coursework_assignment_id  uuid references coursework_assignments(id) on delete cascade,
  created_by                uuid not null references profiles(id),
  created_at                timestamptz not null default now(),
  check (type in ('class', 'exam', 'assignment')),
  -- Exactly one content pointer, matching the step's type.
  check (
    (type = 'class'
       and class_id is not null and exam_id is null and coursework_assignment_id is null)
    or (type = 'exam'
       and exam_id is not null and class_id is null and coursework_assignment_id is null)
    or (type = 'assignment'
       and coursework_assignment_id is not null and class_id is null and exam_id is null)
  )
);

alter table task_flow_steps enable row level security;

create policy "org members read the task flow"
  on task_flow_steps for select
  using (is_org_member(org_id));

create policy "admins/trainers/team leaders manage the task flow"
  on task_flow_steps for all
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']))
  with check (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));
