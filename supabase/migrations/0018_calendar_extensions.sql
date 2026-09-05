-- ============================================================
-- HQ360 — Office Calendar spec extends the Events module (same entity,
-- described calendar-first instead of list-first) rather than being a
-- separate feature, so this migration widens the existing `events` table
-- instead of creating a parallel schema:
--
-- - `meeting_link` is additive and independent of venue_type/venue_location
--   — a physical event can now also carry an online meeting link for
--   hybrid attendance, matching this spec's Event Fields list (Location
--   AND Meeting Link, not one-or-the-other).
-- - The category check constraint is widened to the union of both specs'
--   category lists (existing values kept, new ones from this spec added)
--   rather than replaced, so no existing event's category becomes invalid.
-- ============================================================

alter table events add column meeting_link text;

alter table events drop constraint events_category_check;
alter table events add constraint events_category_check check (category in (
  'orientation', 'leadership_meeting', 'network_marketing_training', 'freelancing_training',
  'skill_development_class', 'product_training', 'workshop', 'webinar',
  'recognition_event', 'team_meeting', 'office_announcement',
  'neolife_meeting', 'assignment_deadline', 'custom_event', 'training_session'
));
