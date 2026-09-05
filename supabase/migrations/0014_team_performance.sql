-- ============================================================
-- HQ360 — Team Performance module reuses the existing groups/group_members
-- tables as "teams" (they're already live: used for exam/coursework
-- targeting, with working RLS) rather than the spec's proposed fresh
-- teams/team_members schema. The one real gap is a designated team leader,
-- so we add that column here. No admin UI to assign one yet — this will
-- read as "Unassigned" until that ships, mirroring the learning_paths
-- approach: the field is real, the authoring tool is a separate build.
-- ============================================================

alter table groups add column leader_id uuid references profiles(id);
