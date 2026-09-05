-- ============================================================
-- HQ360 — group_members had no timestamp at all (just the group_id/user_id
-- composite key), so there was no way to say *when* someone was added to a
-- team. Needed for the Recent Activity module's "Member Assigned" activity
-- type — everything else that feed reports on already had a timestamp to
-- report from.
-- ============================================================

alter table group_members add column created_at timestamptz not null default now();
