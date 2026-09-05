-- ============================================================
-- Skill Development (Training pillar): offices build their own
-- curriculum as a set of Classes (e.g. "Graphics Design"), each split
-- into Modules the office names however it wants ("Module 1", "Week 1",
-- "Basics" — free text, ordered), each Module holding an ordered list
-- of training Items.
--
-- An Item is one of six types: video, pdf, article, test, quiz,
-- assignment. Rather than re-implement content/quiz/submission
-- handling, an Item is a thin pointer into whichever system already
-- owns that content type, so nothing is duplicated:
--   - video / pdf -> a row in the existing `resources` library
--     (shared with the Personal Development pillar — upload a video
--     once, reuse it in a class module). `resources` isn't altered by
--     this migration.
--   - article       -> inline written content, stored directly on the
--     item (`body`) since it isn't a file or an external link.
--   - test / quiz   -> a row in the existing `exams` table (full AI
--     question-gen, timed CBT, grading). "Test" vs "Quiz" is purely a
--     label the office chooses; both are modeled identically.
--   - assignment    -> a row in the existing `coursework_assignments`
--     table (submission + review flow).
--
-- Classes are an org-wide curriculum, not individually assigned —
-- same shape as Personal Development and Onboarding: publish a class
-- and every org member can see and work through it at their own pace.
-- Per-member progress through the (non-quiz/assignment) items is
-- tracked in class_item_progress; quiz/assignment completion is
-- already tracked by `attempts` / `coursework_submissions` and isn't
-- duplicated here.
-- ============================================================

create table classes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  title         text not null,
  description   text,
  status        text not null default 'draft', -- draft / published / archived
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);

create table class_modules (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  title         text not null,
  order_index   int not null default 0,
  created_at    timestamptz not null default now()
);

create table class_module_items (
  id                        uuid primary key default gen_random_uuid(),
  module_id                 uuid not null references class_modules(id) on delete cascade,
  org_id                    uuid not null references organizations(id) on delete cascade,
  type                      text not null, -- video / pdf / article / test / quiz / assignment
  title                     text not null,
  order_index               int not null default 0,
  resource_id               uuid references resources(id),
  body                      text,
  exam_id                   uuid references exams(id),
  coursework_assignment_id  uuid references coursework_assignments(id),
  created_by                uuid not null references profiles(id),
  created_at                timestamptz not null default now(),
  check (type in ('video', 'pdf', 'article', 'test', 'quiz', 'assignment')),
  -- Exactly one content pointer, matching the item's type.
  check (
    (type in ('video', 'pdf')
       and resource_id is not null and body is null and exam_id is null and coursework_assignment_id is null)
    or (type = 'article'
       and body is not null and resource_id is null and exam_id is null and coursework_assignment_id is null)
    or (type in ('test', 'quiz')
       and exam_id is not null and resource_id is null and body is null and coursework_assignment_id is null)
    or (type = 'assignment'
       and coursework_assignment_id is not null and resource_id is null and body is null and exam_id is null)
  )
);

-- Only for video/pdf/article items — test/quiz/assignment completion is
-- derived from attempts/coursework_submissions instead, so no progress
-- row is ever written for those item types.
create table class_item_progress (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references class_module_items(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  status        text not null default 'not_started', -- not_started / in_progress / completed
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (item_id, user_id)
);

alter table classes enable row level security;
alter table class_modules enable row level security;
alter table class_module_items enable row level security;
alter table class_item_progress enable row level security;

create policy "org admins manage classes"
  on classes for all
  using (has_org_role(org_id, array['owner', 'admin', 'instructor']))
  with check (has_org_role(org_id, array['owner', 'admin', 'instructor']));

create policy "org members read published classes"
  on classes for select
  using (status = 'published' and is_org_member(org_id));

create policy "org admins manage class modules"
  on class_modules for all
  using (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and has_org_role(c.org_id, array['owner', 'admin', 'instructor'])
  ))
  with check (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and has_org_role(c.org_id, array['owner', 'admin', 'instructor'])
  ));

create policy "org members read modules of published classes"
  on class_modules for select
  using (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and c.status = 'published' and is_org_member(c.org_id)
  ));

create policy "org admins manage class module items"
  on class_module_items for all
  using (exists (
    select 1 from class_modules m where m.id = class_module_items.module_id
      and has_org_role(m.org_id, array['owner', 'admin', 'instructor'])
  ))
  with check (exists (
    select 1 from class_modules m where m.id = class_module_items.module_id
      and has_org_role(m.org_id, array['owner', 'admin', 'instructor'])
  ));

create policy "org members read items of published classes"
  on class_module_items for select
  using (exists (
    select 1 from class_modules m join classes c on c.id = m.class_id
    where m.id = class_module_items.module_id
      and c.status = 'published' and is_org_member(c.org_id)
  ));

create policy "members manage their own class progress"
  on class_item_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all class progress in their org"
  on class_item_progress for select
  using (has_org_role(org_id, array['owner', 'admin', 'instructor']));
