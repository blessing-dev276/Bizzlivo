-- ============================================================
-- Resources have been getting mixed together: Personal Development,
-- Income Development, and Skill Development all pick from the same
-- org-wide `resources` library with no way to tell "this PDF is a daily
-- reading book" apart from "this PDF is a Graphics Design skill-set
-- source" or "this is a freelancing guide". Tags each resource with the
-- section it was uploaded for, so each pillar's picker can filter to its
-- own purpose instead of showing everything.
--
-- Existing rows default to 'skill_set' — before this migration every
-- resource was uploaded through the general Resources page, which is
-- framed around skills/exam-generation, so that's the correct read of
-- what they already are.
-- ============================================================

alter table resources add column purpose text not null default 'skill_set';
alter table resources add constraint resources_purpose_check
  check (purpose in ('book', 'skill_set', 'freelancing'));
