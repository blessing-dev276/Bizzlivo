-- ============================================================
-- 0068 — Events → recurring office meeting & training system (Phase A)
-- ============================================================
-- Evolves the existing `events` table into a SERIES definition and adds a
-- lazily-materialized OCCURRENCE model, per-occurrence ATTENDANCE, and a
-- flexible AUDIENCE model. Recurrence is stored as an RFC-5545 RRULE
-- string; occurrences are computed from it on read and only persisted
-- when something needs to hang off a specific date (attendance, a
-- reminder, an admin override/cancel/reschedule).
--
-- Nothing here creates future rows blindly. See src/lib/recurrence.ts for
-- the shared RRULE engine, and later phases for reminders (events-tick),
-- Google Calendar/Meet sync, leaderboard and reports wiring.
--
-- Existing one-time events keep working: is_recurring defaults false and
-- their start_at/end_at are untouched. The old `event_attendees` table
-- (self-service RSVP / "following") is left as-is; verified attendance is
-- the new `event_attendance` table, keyed per occurrence.

-- ---------- 1. evolve `events` into a series definition ----------
alter table events add column if not exists updated_at            timestamptz not null default now();
alter table events add column if not exists is_recurring          boolean not null default false;
alter table events add column if not exists timezone              text;           -- IANA, e.g. 'Africa/Lagos'; defaults from organizations.timezone
alter table events add column if not exists local_start_time      text;           -- 'HH:MM' wall-clock time in `timezone` (recurring only)
alter table events add column if not exists duration_minutes      integer;        -- occurrence length (recurring only; one-time uses start_at/end_at)
alter table events add column if not exists recurrence_rule       text;           -- RFC-5545 RRULE, e.g. 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
alter table events add column if not exists series_start_date     date;           -- first eligible date for the rule
alter table events add column if not exists recurrence_end_type   text not null default 'never';
alter table events add column if not exists recurrence_until      date;           -- when recurrence_end_type = 'until'
alter table events add column if not exists recurrence_count      integer;        -- when recurrence_end_type = 'count'
alter table events add column if not exists meeting_provider      text not null default 'none';
alter table events add column if not exists meeting_url           text;           -- external link, or the synced Google Meet URL
alter table events add column if not exists reminder_minutes      integer[] not null default '{30}';
alter table events add column if not exists email_reminders       boolean not null default false;
-- Google Calendar / Meet sync (populated by later phases; inert until then)
alter table events add column if not exists google_calendar_id    text;
alter table events add column if not exists google_event_id       text;
alter table events add column if not exists google_conference_id  text;
alter table events add column if not exists sync_status           text not null default 'not_synced';
alter table events add column if not exists sync_error            text;
alter table events add column if not exists synced_at             timestamptz;

alter table events drop constraint if exists events_recurrence_end_type_check;
alter table events add constraint events_recurrence_end_type_check
  check (recurrence_end_type in ('never', 'until', 'count'));

alter table events drop constraint if exists events_meeting_provider_check;
alter table events add constraint events_meeting_provider_check
  check (meeting_provider in ('none', 'external', 'google_meet'));

alter table events drop constraint if exists events_sync_status_check;
alter table events add constraint events_sync_status_check
  check (sync_status in ('not_synced', 'syncing', 'synced', 'sync_failed'));

-- A recurring event must carry the rule + wall time + duration + start date.
alter table events drop constraint if exists events_recurrence_shape_check;
alter table events add constraint events_recurrence_shape_check check (
  not is_recurring
  or (recurrence_rule is not null and local_start_time is not null
      and duration_minutes is not null and series_start_date is not null)
);

-- start_at/end_at are only required for one-time events now.
alter table events alter column start_at drop not null;
alter table events alter column end_at drop not null;
alter table events drop constraint if exists events_time_check;
alter table events add constraint events_time_check
  check (start_at is null or end_at is null or end_at >= start_at);
alter table events drop constraint if exists events_onetime_shape_check;
alter table events add constraint events_onetime_shape_check
  check (is_recurring or (start_at is not null and end_at is not null));

-- ---------- 2. backfill existing rows ----------
update events e set
  timezone = coalesce(e.timezone, o.timezone, 'Africa/Lagos'),
  duration_minutes = coalesce(e.duration_minutes,
    greatest(1, round(extract(epoch from (e.end_at - e.start_at)) / 60)::int))
from organizations o
where o.id = e.org_id;

-- ---------- 3. updated_at trigger ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_events_touch on events;
create trigger trg_events_touch before update on events
  for each row execute function public.touch_updated_at();

-- ---------- 4. fix stale manage-role names on events ----------
-- 0027 replaced owner/instructor with admin/trainer/team_leader/member.
drop policy if exists "owners/admins/instructors can manage events" on events;
create policy "org admins/trainers can manage events"
  on events for all
  using (has_org_role(org_id, array['admin', 'trainer']))
  with check (has_org_role(org_id, array['admin', 'trainer']));

-- ---------- 5. event_audiences ----------
-- Who a series (or a single overridden occurrence) is for. Ranks are
-- referenced by id — business_path ranks are org-configurable, never a
-- hardcoded string.
create table if not exists event_audiences (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  event_id      uuid not null references events(id) on delete cascade,
  occurrence_id uuid,                                   -- null = applies to the whole series
  kind          text not null check (kind in ('all', 'leadership', 'team', 'rank', 'member')),
  ref_id        uuid,                                   -- group id / rank id / user id; null for 'all' | 'leadership'
  created_at    timestamptz not null default now()
);
create index if not exists event_audiences_event_idx on event_audiences (event_id);
alter table event_audiences enable row level security;

create policy "org members read event audiences"
  on event_audiences for select using (is_org_member(org_id));
create policy "org admins/trainers manage event audiences"
  on event_audiences for all
  using (has_org_role(org_id, array['admin', 'trainer']))
  with check (has_org_role(org_id, array['admin', 'trainer']));

-- Is `p_user` in the audience of `p_event`? No audience rows at all = the
-- whole org (back-compat with every event created before this migration).
create or replace function public.event_is_visible_to(p_event uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with rows as (
    select * from event_audiences where event_id = p_event and occurrence_id is null
  )
  select
    not exists (select 1 from rows)
    or exists (select 1 from rows where kind = 'all')
    or exists (
      select 1 from rows r
      where (r.kind = 'member' and r.ref_id = p_user)
         or (r.kind = 'team' and exists (
              select 1 from group_members gm where gm.group_id = r.ref_id and gm.user_id = p_user))
         or (r.kind = 'leadership' and exists (
              select 1 from memberships m
              where m.org_id = (select org_id from events where id = p_event)
                and m.user_id = p_user and m.status = 'active'
                and m.role in ('admin', 'trainer', 'team_leader')))
         or (r.kind = 'rank' and exists (
              select 1 from member_rank_progress mrp
              where mrp.user_id = p_user and mrp.current_rank_id = r.ref_id))
    );
$$;

-- ---------- 6. event_occurrences (lazily materialized) ----------
-- A row exists ONLY when a specific date needs state: attendance taken, a
-- reminder scheduled, or an admin cancelled / rescheduled / overrode it.
-- Unmodified future dates are computed from the RRULE and never stored.
create table if not exists event_occurrences (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  event_id          uuid not null references events(id) on delete cascade,
  occurrence_date   date not null,                       -- the RRULE-anchored local date
  start_at          timestamptz not null,                -- resolved UTC instant (may differ from rule if overridden)
  end_at            timestamptz not null,
  status            text not null default 'scheduled'
                    check (status in ('scheduled', 'cancelled', 'rescheduled', 'completed')),
  is_override       boolean not null default false,      -- admin changed time/title/audience for this date only
  override_title    text,
  meeting_url       text,                                -- per-occurrence link override
  google_event_id   text,
  reminders_sent    integer[] not null default '{}',     -- reminder_minutes windows already dispatched
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, occurrence_date)
);
create index if not exists event_occurrences_org_start_idx on event_occurrences (org_id, start_at);
create index if not exists event_occurrences_event_idx on event_occurrences (event_id, occurrence_date);
alter table event_occurrences enable row level security;

drop trigger if exists trg_event_occurrences_touch on event_occurrences;
create trigger trg_event_occurrences_touch before update on event_occurrences
  for each row execute function public.touch_updated_at();

create policy "org members read visible occurrences"
  on event_occurrences for select
  using (
    is_org_member(org_id)
    and (
      has_org_role(org_id, array['admin', 'trainer'])
      or event_is_visible_to(event_id, auth.uid())
    )
  );
create policy "org admins/trainers manage occurrences"
  on event_occurrences for all
  using (has_org_role(org_id, array['admin', 'trainer']))
  with check (has_org_role(org_id, array['admin', 'trainer']));

-- ---------- 7. event_attendance (per occurrence, verified) ----------
create table if not exists event_attendance (
  occurrence_id uuid not null references event_occurrences(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  status        text not null default 'present' check (status in ('present', 'absent', 'excused')),
  method        text not null default 'admin' check (method in ('admin', 'self_checkin')),
  marked_by     uuid references profiles(id),
  marked_at     timestamptz not null default now(),
  primary key (occurrence_id, user_id)
);
create index if not exists event_attendance_user_idx on event_attendance (org_id, user_id);
alter table event_attendance enable row level security;

create policy "org members read attendance for their org"
  on event_attendance for select using (is_org_member(org_id));
create policy "org admins/trainers manage attendance"
  on event_attendance for all
  using (has_org_role(org_id, array['admin', 'trainer']))
  with check (has_org_role(org_id, array['admin', 'trainer']));
-- No self-insert policy: members check in through check_in_occurrence()
-- (below), which enforces the time window server-side.

-- ---------- 8. member self check-in ----------
-- Window defaults: opens 15 min before start, closes 30 min after start.
-- Opening the event page never counts — only an explicit call here does.
create or replace function public.check_in_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  occ record;
begin
  select o.*, e.org_id as ev_org
    into occ
  from event_occurrences o
  join events e on e.id = o.event_id
  where o.id = p_occurrence_id;

  if not found then raise exception 'Occurrence not found.'; end if;
  if not is_org_member(occ.ev_org) then raise exception 'Not authorized.'; end if;
  if not event_is_visible_to(occ.event_id, auth.uid()) then
    raise exception 'This event is not for you.';
  end if;
  if occ.status = 'cancelled' then raise exception 'This session is cancelled.'; end if;
  if now() < occ.start_at - interval '15 minutes' then
    raise exception 'Check-in is not open yet.';
  end if;
  if now() > occ.start_at + interval '30 minutes' then
    raise exception 'Check-in has closed for this session.';
  end if;

  insert into event_attendance (occurrence_id, user_id, org_id, status, method, marked_by)
  values (p_occurrence_id, auth.uid(), occ.org_id, 'present', 'self_checkin', auth.uid())
  on conflict (occurrence_id, user_id)
  do update set status = 'present', marked_at = now()
  where event_attendance.method = 'self_checkin';
end;
$$;
grant execute on function public.check_in_occurrence(uuid) to authenticated;
