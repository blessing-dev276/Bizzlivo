-- ============================================================
-- HQ360 — Upcoming Events module. Only the core CRUD + join/RSVP-count
-- surface is being built now (per spec: everything else — full calendar
-- grid, attendance tracking, notifications, online-meeting embeds,
-- reports/export — is explicitly Coming Soon). Schema wasn't dictated by
-- the spec ("Schema Details: Coming Soon"), so this is a fresh design:
--
-- - `category` is a plain text + check constraint, not a separate
--   event_categories table — same convention as exams.status /
--   questions.type elsewhere in this schema, for a fixed short enum.
-- - `status` only stores the states an admin actually sets by hand
--   (draft/scheduled/cancelled); "Live" vs "Completed" is derived
--   client-side from start_at/end_at so nothing needs a background job
--   to flip it at the right instant.
-- - event_attendees is the "Join" mechanic the Event Card and Member
--   permissions call for today — the deferred "RSVP System" heading
--   covers capacity limits/waitlists/reminders on top of this, not the
--   basic join-and-be-counted action.
-- - No event_reminders table — Notifications are explicitly Coming Soon.
-- ============================================================

create table events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  title           text not null,
  description     text,
  category        text not null default 'workshop',
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  venue_type      text not null default 'physical',
  venue_location  text,
  organizer_id    uuid references profiles(id),
  status          text not null default 'scheduled',
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  constraint events_category_check check (category in (
    'orientation', 'leadership_meeting', 'network_marketing_training', 'freelancing_training',
    'skill_development_class', 'product_training', 'workshop', 'webinar',
    'recognition_event', 'team_meeting', 'office_announcement'
  )),
  constraint events_venue_type_check check (venue_type in ('physical', 'online')),
  constraint events_status_check check (status in ('draft', 'scheduled', 'cancelled')),
  constraint events_time_check check (end_at >= start_at)
);
create index events_org_start_idx on events (org_id, start_at);

create table event_attendees (
  event_id  uuid not null references events(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table events enable row level security;
alter table event_attendees enable row level security;

create policy "org members can read their org's events"
  on events for select
  using (is_org_member(org_id));

create policy "owners/admins/instructors can manage events"
  on events for all
  using (has_org_role(org_id, array['owner', 'admin', 'instructor']))
  with check (has_org_role(org_id, array['owner', 'admin', 'instructor']));

create policy "org members can read event attendees"
  on event_attendees for select
  using (exists (select 1 from events e where e.id = event_attendees.event_id and is_org_member(e.org_id)));

create policy "members can join/leave events themselves"
  on event_attendees for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "org admins manage event attendees"
  on event_attendees for all
  using (exists (
    select 1 from events e where e.id = event_attendees.event_id
      and has_org_role(e.org_id, array['owner', 'admin', 'instructor'])
  ))
  with check (exists (
    select 1 from events e where e.id = event_attendees.event_id
      and has_org_role(e.org_id, array['owner', 'admin', 'instructor'])
  ));
