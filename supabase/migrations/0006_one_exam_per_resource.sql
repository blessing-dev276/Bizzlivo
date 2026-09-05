-- ============================================================
-- One exam per resource. Enforced at the database level so it's a
-- real guarantee, not just a UI nicety — manual exams (resource_id is
-- null) are unrestricted since there's no resource to collide on.
-- Offices should add more questions to the existing exam for a
-- resource rather than spinning up a second exam from the same PDF.
-- ============================================================

create unique index exams_resource_id_unique_idx on exams(resource_id) where resource_id is not null;
