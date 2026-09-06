-- ============================================================
-- Onboarding: quiz items + per-item completion.
--
-- 1. A step item can now be a 'quiz' — a thin pointer at an existing
--    `exams` row (same pattern as class_module_items). "Quiz" is the
--    member-facing word for an exam throughout the app now.
--
-- 2. onboarding_item_progress tracks completion per member per item, so a
--    step auto-completes once *every* item in it is done:
--      - video  -> watched to the end
--      - pdf    -> opened in-app and scrolled to the last page
--      - link   -> opened in-app
--      - quiz   -> a passing attempt exists (derived from `attempts`, so
--                  no progress row is written for quiz items)
--    The onboarding_progress per-step timestamp is still the gate for the
--    next step; it's just set automatically now instead of by a button.
-- ============================================================

alter table onboarding_step_items
  add column exam_id uuid references exams(id) on delete cascade;

-- Replace the two anonymous CHECKs from 0024 with named ones that also
-- cover the new 'quiz' type / exam_id pointer.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'onboarding_step_items'::regclass and contype = 'c'
  loop
    execute format('alter table onboarding_step_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table onboarding_step_items
  add constraint onboarding_step_items_step_check
    check (step in ('business_explanation', 'network_varsity', 'office_policy')),
  add constraint onboarding_step_items_type_check
    check (type in ('pdf', 'video', 'link', 'quiz')),
  add constraint onboarding_step_items_pointer_check check (
    (type in ('pdf', 'video') and file_path is not null and link_url is null and exam_id is null)
    or (type = 'link' and link_url is not null and file_path is null and exam_id is null)
    or (type = 'quiz' and exam_id is not null and file_path is null and link_url is null)
  );

create table onboarding_item_progress (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  item_id       uuid not null references onboarding_step_items(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (item_id, user_id)
);

alter table onboarding_item_progress enable row level security;

create policy "members manage their own onboarding item progress"
  on onboarding_item_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all onboarding item progress in their org"
  on onboarding_item_progress for select
  using (has_org_role(org_id, array['owner', 'admin']));
