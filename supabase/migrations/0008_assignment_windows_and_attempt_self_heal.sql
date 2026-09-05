-- ============================================================
-- HQ360 — scheduled assignment windows (date + start/end time an
-- assignment must be taken in) and support for lazily self-healing
-- stale/missed attempts wherever they're viewed (Dashboard, My
-- Exams, the exam roster) instead of running a scheduled job.
-- ============================================================

-- Optional scheduled window per assignment row — applies to every
-- target of that row (one member, or every member of a group).
-- Both-or-neither: a half-set window is ambiguous, so it's rejected
-- at the DB level rather than only in the UI.
alter table exam_assignments add column starts_at timestamptz;
alter table exam_assignments add column ends_at   timestamptz;
alter table exam_assignments add constraint exam_assignments_window_check
  check (
    (starts_at is null) = (ends_at is null)
    and (starts_at is null or ends_at > starts_at)
  );

-- Race-safety for attempt creation: two concurrent "start exam" calls
-- (double-click, or a self-heal reconcile overlapping a live retake)
-- must not create two rows for the same person's same attempt slot.
create unique index attempts_exam_user_attempt_number_idx
  on attempts (exam_id, user_id, attempt_number)
  where user_id is not null;

-- Lets an org admin/instructor write a "missed" attempt row on behalf
-- of a member who never started (needed by the exam roster's self-heal
-- — there's no existing attempts row for that member an UPDATE could
-- target). The existing "members create their own attempts" policy is
-- untouched; Postgres OR's multiple permissive policies for the same
-- command together, so both keep working independently.
create policy "org admins can create attempts for their org's members"
  on attempts for insert
  with check (
    has_org_role(org_id, array['owner','admin','instructor'])
    and exists (
      select 1 from memberships m
      where m.org_id = attempts.org_id and m.user_id = attempts.user_id and m.status = 'active'
    )
  );

-- No UPDATE policy change needed: "members update their own in-progress
-- attempts" already allows org admins via has_org_role(...), which
-- covers an admin flipping someone else's stale in_progress row to
-- expired during the roster's self-heal pass.
