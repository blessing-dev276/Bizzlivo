-- ============================================================
-- HQ360 — coursework assignments: a free-form task system distinct
-- from exam_assignments (which schedules quiz-style exams). An admin
-- creates a task with instructions, sends it to specific members or
-- groups, each recipient submits a text note and/or an external link
-- (no file upload — large work like videos/designs lives on the
-- external service the member already uses), and an admin approves,
-- rejects, or requests changes.
--
-- Tables are prefixed `coursework_` (rather than reusing the word
-- "assignment" bare) specifically to avoid confusion with the
-- existing exam_assignments table, which is a different feature.
-- ============================================================

create table coursework_assignments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  title           text not null,
  instructions    text not null,
  reference_link  text,
  require_note    boolean not null default true,
  require_link    boolean not null default false,
  due_date        timestamptz,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  check (require_note or require_link)
);

create table coursework_targets (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references coursework_assignments(id) on delete cascade,
  org_id              uuid not null references organizations(id) on delete cascade,
  assigned_to_user    uuid references profiles(id),
  assigned_to_group   uuid references groups(id),
  created_at          timestamptz not null default now(),
  check (assigned_to_user is not null or assigned_to_group is not null)
);

create table coursework_submissions (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references coursework_assignments(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references profiles(id),
  note            text,
  link            text,
  status          text not null default 'submitted', -- submitted / approved / rejected / changes_requested
  review_note     text,
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  submitted_at    timestamptz not null default now(),
  unique (assignment_id, user_id)
);

alter table coursework_assignments enable row level security;
alter table coursework_targets enable row level security;
alter table coursework_submissions enable row level security;

create policy "org admins manage coursework assignments"
  on coursework_assignments for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

create policy "targeted members can read their assignment"
  on coursework_assignments for select
  using (
    has_org_role(org_id, array['owner','admin','instructor'])
    or exists (
      select 1 from coursework_targets t
      where t.assignment_id = coursework_assignments.id
        and (t.assigned_to_user = auth.uid()
             or exists (select 1 from group_members gm where gm.group_id = t.assigned_to_group and gm.user_id = auth.uid()))
    )
  );

create policy "org admins manage coursework targets"
  on coursework_targets for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

create policy "members read their own or their group's coursework targets"
  on coursework_targets for select
  using (
    has_org_role(org_id, array['owner','admin','instructor'])
    or assigned_to_user = auth.uid()
    or exists (select 1 from group_members gm where gm.group_id = coursework_targets.assigned_to_group and gm.user_id = auth.uid())
  );

-- Admins can read/update/approve any submission in their org.
create policy "admins manage all coursework submissions"
  on coursework_submissions for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

-- Members insert only their own submission, only for an assignment that
-- actually targets them, and only ever as status='submitted' — they can
-- never write 'approved'/'rejected'/'changes_requested' themselves.
create policy "members submit work for assignments targeting them"
  on coursework_submissions for insert
  with check (
    user_id = auth.uid()
    and status = 'submitted'
    and exists (
      select 1 from coursework_targets t
      where t.assignment_id = coursework_submissions.assignment_id
        and (t.assigned_to_user = auth.uid()
             or exists (select 1 from group_members gm where gm.group_id = t.assigned_to_group and gm.user_id = auth.uid()))
    )
  );

create policy "members read their own coursework submission"
  on coursework_submissions for select
  using (user_id = auth.uid() or has_org_role(org_id, array['owner','admin','instructor']));

-- Resubmitting (editing note/link after a rejection) is only ever allowed
-- to land back at 'submitted' — same self-approval guard as the insert policy.
create policy "members resubmit their own coursework work"
  on coursework_submissions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'submitted');
