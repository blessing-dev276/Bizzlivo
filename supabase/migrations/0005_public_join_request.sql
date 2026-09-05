-- ============================================================
-- Let a visitor on the office-branded login page (/o/:slug/login)
-- request to join that office directly, without an account. This is
-- the same approval queue used by public-exam-link takers — the
-- office admin still has to approve before a real invite is created.
-- `with check (status = 'pending')` stops a client from inserting a
-- row that's already approved/rejected.
-- ============================================================

create policy "anyone can request to join an org"
  on pending_members for insert
  with check (status = 'pending');
