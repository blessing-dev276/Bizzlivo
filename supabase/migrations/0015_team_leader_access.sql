-- ============================================================
-- HQ360 — Team Leader access.
--
-- groups.leader_id (0014) already marks who leads a team, but nothing
-- granted that person any actual read access beyond what their own
-- membership role already gave them — a 'member' who leads a team could
-- browse to a team page and see nothing, since attempts/exam_assignments/
-- coursework_submissions are only readable by their own owner or by
-- owner/admin/instructor. A Team Leader is deliberately neither: the whole
-- point of the role (per spec) is a non-admin who can see their own team's
-- progress but not billing/office settings/other teams.
--
-- Postgres OR's together multiple permissive policies for the same
-- command, so these are additive — the existing "own row or admin" SELECT
-- policies on these three tables are untouched, this just widens who else
-- can see a given row.
-- ============================================================

create policy "team leaders read their team's attempts"
  on attempts for select
  using (
    exists (
      select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.leader_id = auth.uid()
        and gm.user_id = attempts.user_id
        and g.org_id = attempts.org_id
    )
  );

create policy "team leaders read their team's assignments"
  on exam_assignments for select
  using (
    exists (
      select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.leader_id = auth.uid()
        and gm.user_id = exam_assignments.assigned_to_user
        and g.org_id = exam_assignments.org_id
    )
  );

create policy "team leaders read their team's coursework submissions"
  on coursework_submissions for select
  using (
    exists (
      select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.leader_id = auth.uid()
        and gm.user_id = coursework_submissions.user_id
        and g.org_id = coursework_submissions.org_id
    )
  );
