-- ============================================================
-- Profile settings: a short status line, and a sponsor — either an
-- existing org member (sponsor_member_id) or free text for someone
-- outside the Virtual Office (sponsor_name). Exactly one of the two is
-- set at a time; enforced in the app rather than a check constraint
-- since "neither set" (no sponsor yet) is also a valid state.
-- ============================================================
alter table profiles add column status text;
alter table profiles add column sponsor_member_id uuid references profiles(id) on delete set null;
alter table profiles add column sponsor_name text;

-- No RLS changes needed: "users can update own profile" (0001_init.sql)
-- already covers these new columns on the same row, and the existing
-- "read own profile or org-mates' profiles" select policy already lets a
-- member's sponsor name resolve for anyone rendering their teammates.
