-- ============================================================
-- 0064 — Personal income entries: admin-recorded only
-- ============================================================
-- Verified / withdrawable earnings (finance_orders) were already
-- admin-only via finance_record_order + fin_assert_admin. The one
-- remaining member-writable "earnings" surface was the self-reported
-- personal income log (income_development_income_entries), which a
-- member could add to and delete from directly.
--
-- New rule: an office admin records these entries on the member's
-- behalf. Members can still SEE their own log (it feeds Business Path
-- "Log income" requirements and income goals) but can no longer add,
-- edit, or delete entries.

drop policy if exists "members manage their own income entries"
  on income_development_income_entries;

create policy "members read their own income entries"
  on income_development_income_entries for select
  using (user_id = auth.uid());

-- Admins may insert/update/delete for any member in an org they
-- administer (with check keys off the row's org_id, so the target
-- user_id can be any member of that office).
create policy "admins manage income entries in their org"
  on income_development_income_entries for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- The pre-existing "owners/admins read all income entries in their org"
-- SELECT policy is now subsumed by the ALL policy above but left in
-- place — it is harmless and dropping it is unnecessary churn.
