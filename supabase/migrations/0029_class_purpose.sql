-- ============================================================
-- Lets the existing Skill Development classes/modules/items builder
-- (0022_skill_development_classes.sql) be reused by Income Development's
-- Skill Catalog instead of duplicating that whole schema + editor UI —
-- same idea as resources.purpose (0025) distinguishing book/skill_set/
-- freelancing content on one shared `resources` table.
--
-- Existing rows are all Skill Development classes (Income Development's
-- catalog didn't exist before this), so the default backfills correctly
-- with no data migration needed.
-- ============================================================

alter table classes add column purpose text not null default 'skill_development';
alter table classes add constraint classes_purpose_check
  check (purpose in ('skill_development', 'income_development'));
