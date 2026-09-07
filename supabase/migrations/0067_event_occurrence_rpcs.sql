-- ============================================================
-- 0067 — Events Phase B: occurrence materialization + date-keyed check-in
-- ============================================================
-- The RRULE engine lives in the frontend (src/lib/recurrence.ts), so the
-- resolved start/end instants for a given date are passed in — Postgres
-- never expands a recurrence rule. These RPCs just persist the row.

-- Admin/trainer: create (or fetch) the occurrence row for one date so
-- attendance / a reschedule / a cancel can hang off it.
create or replace function public.materialize_occurrence(
  p_event_id  uuid,
  p_date      date,
  p_start_at  timestamptz,
  p_end_at    timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  select org_id into v_org from events where id = p_event_id;
  if v_org is null then raise exception 'Event not found.'; end if;
  if not has_org_role(v_org, array['admin', 'trainer']) then
    raise exception 'Not authorized.';
  end if;

  insert into event_occurrences (org_id, event_id, occurrence_date, start_at, end_at)
  values (v_org, p_event_id, p_date, p_start_at, p_end_at)
  on conflict (event_id, occurrence_date) do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.materialize_occurrence(uuid, date, timestamptz, timestamptz) to authenticated;

-- Any eligible member: check in for a specific date. Materializes the
-- occurrence first (SECURITY DEFINER bypasses the admin-only manage
-- policy), then enforces the same window as check_in_occurrence().
create or replace function public.check_in_by_date(
  p_event_id  uuid,
  p_date      date,
  p_start_at  timestamptz,
  p_end_at    timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_occ uuid;
  v_status text;
  v_start timestamptz;
begin
  select org_id into v_org from events where id = p_event_id;
  if v_org is null then raise exception 'Event not found.'; end if;
  if not is_org_member(v_org) then raise exception 'Not authorized.'; end if;
  if not event_is_visible_to(p_event_id, auth.uid()) then
    raise exception 'This event is not for you.';
  end if;

  insert into event_occurrences (org_id, event_id, occurrence_date, start_at, end_at)
  values (v_org, p_event_id, p_date, p_start_at, p_end_at)
  on conflict (event_id, occurrence_date) do update set updated_at = now()
  returning id, status, start_at into v_occ, v_status, v_start;

  if v_status = 'cancelled' then raise exception 'This session is cancelled.'; end if;
  if now() < v_start - interval '15 minutes' then raise exception 'Check-in is not open yet.'; end if;
  if now() > v_start + interval '30 minutes' then raise exception 'Check-in has closed for this session.'; end if;

  insert into event_attendance (occurrence_id, user_id, org_id, status, method, marked_by)
  values (v_occ, auth.uid(), v_org, 'present', 'self_checkin', auth.uid())
  on conflict (occurrence_id, user_id) do update set status = 'present', marked_at = now()
  where event_attendance.method = 'self_checkin';
end;
$$;
grant execute on function public.check_in_by_date(uuid, date, timestamptz, timestamptz) to authenticated;

-- Cancel / reschedule one occurrence (admin/trainer). Reschedule stores the
-- new instants on the row and flags it 'rescheduled' — the RRULE is never
-- mutated for a single-date change.
create or replace function public.set_occurrence_state(
  p_occurrence_id uuid,
  p_status        text,
  p_start_at      timestamptz default null,
  p_end_at        timestamptz default null,
  p_title         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select org_id into v_org from event_occurrences where id = p_occurrence_id;
  if v_org is null then raise exception 'Occurrence not found.'; end if;
  if not has_org_role(v_org, array['admin', 'trainer']) then raise exception 'Not authorized.'; end if;
  if p_status not in ('scheduled', 'cancelled', 'rescheduled') then raise exception 'Bad status.'; end if;

  update event_occurrences set
    status        = p_status,
    is_override   = (p_status = 'rescheduled' or p_title is not null),
    start_at      = coalesce(p_start_at, start_at),
    end_at        = coalesce(p_end_at, end_at),
    override_title = coalesce(p_title, override_title),
    updated_at    = now()
  where id = p_occurrence_id;
end;
$$;
grant execute on function public.set_occurrence_state(uuid, text, timestamptz, timestamptz, text) to authenticated;
