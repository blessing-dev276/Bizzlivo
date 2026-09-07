-- ============================================================
-- 0063 — collapse the freelance project lifecycle to four states.
--
-- The workspace is now just a tracker for freelancing work — no client
-- book, no separate delivery/revision micro-stages. Members think in
-- terms of: is this order Pending, Active, Completed, or Cancelled?
--
--   new                          -> pending
--   in_progress|delivered|revision -> active
--   completed                    -> completed  (unchanged)
--   cancelled                    -> cancelled  (unchanged)
--
-- The inline CHECK from 0049 is named freelance_projects_status_check.
-- ============================================================

alter table freelance_projects drop constraint if exists freelance_projects_status_check;

update freelance_projects
set status = case
  when status = 'new' then 'pending'
  when status in ('in_progress', 'delivered', 'revision') then 'active'
  else status
end
where status in ('new', 'in_progress', 'delivered', 'revision');

alter table freelance_projects
  alter column status set default 'pending',
  add constraint freelance_projects_status_check
    check (status in ('pending', 'active', 'completed', 'cancelled'));
