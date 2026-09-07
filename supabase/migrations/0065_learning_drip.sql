-- ============================================================
-- 0065 — Day-based drip release for Learning Center sections
-- ============================================================
-- Optional per-section feature. When a section (class) has
-- drip_enabled = true, each module carries a drip_day (1-based). A
-- module unlocks for a member once (drip_day - 1) whole days have
-- passed since that member first opened the section
-- (class_enrollments.started_on). Purely time-based: a later day
-- unlocks when it arrives whether or not earlier modules are done.
--
-- Off by default; existing sections stay fully open. Dates are UTC so
-- the client can compute the same unlock day without a round-trip.

alter table classes       add column if not exists drip_enabled boolean not null default false;
alter table class_modules add column if not exists drip_day     int;   -- null / <=1 => open from day one
alter table class_modules add constraint class_modules_drip_day_chk
  check (drip_day is null or drip_day >= 1);

-- Per-member "Day 1" anchor for a section. Created lazily by start_class().
create table class_enrollments (
  org_id      uuid not null references organizations(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  started_on  date not null default (now() at time zone 'utc')::date,
  created_at  timestamptz not null default now(),
  primary key (class_id, user_id)
);
create index class_enrollments_user_idx on class_enrollments (org_id, user_id);

alter table class_enrollments enable row level security;

create policy "members read their own class enrollments"
  on class_enrollments for select using (user_id = auth.uid());
create policy "staff read class enrollments in their org"
  on class_enrollments for select
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));
-- no INSERT/UPDATE/DELETE policy: rows are written only by start_class()

-- ------------------------------------------------------------
-- start_class(p_class) — idempotently record that the caller has
-- started a section, and return their start date.
-- ------------------------------------------------------------
create or replace function start_class(p_class uuid)
returns date
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_started date;
begin
  select org_id into v_org from classes where id = p_class;
  if v_org is null then raise exception 'class not found'; end if;
  if not is_org_member(v_org) then raise exception 'not permitted'; end if;

  insert into class_enrollments (org_id, class_id, user_id)
  values (v_org, p_class, auth.uid())
  on conflict (class_id, user_id) do nothing;

  select started_on into v_started
  from class_enrollments where class_id = p_class and user_id = auth.uid();
  return v_started;
end $$;
grant execute on function start_class(uuid) to authenticated;

-- ------------------------------------------------------------
-- class_module_unlocked(p_module, p_user) — is this module open for
-- this member right now?
-- ------------------------------------------------------------
create or replace function class_module_unlocked(p_module uuid, p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_class uuid;
  v_drip boolean;
  v_day int;
  v_started date;
begin
  select cm.class_id, c.drip_enabled, coalesce(cm.drip_day, 1)
    into v_class, v_drip, v_day
  from class_modules cm
  join classes c on c.id = cm.class_id
  where cm.id = p_module;

  if v_class is null then return false; end if;
  if not v_drip or v_day <= 1 then return true; end if;

  select started_on into v_started
  from class_enrollments where class_id = v_class and user_id = p_user;

  if v_started is null then
    return false;  -- hasn't started the section: only day-one modules are open
  end if;

  return (now() at time zone 'utc')::date >= v_started + (v_day - 1);
end $$;
grant execute on function class_module_unlocked(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- Guard: a member cannot complete an item in a still-locked module.
-- (Covers the class_item_progress path — video/pdf/article/link/
-- podcast. Quiz/assignment items are hidden in a locked module by the
-- UI; their attempt/submission tables are not gated here.)
-- ------------------------------------------------------------
create or replace function _drip_guard_item_progress()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_module uuid;
begin
  select module_id into v_module from class_module_items where id = new.item_id;
  if v_module is not null and not class_module_unlocked(v_module, new.user_id) then
    raise exception 'This lesson is not unlocked yet.';
  end if;
  return new;
end $$;

create trigger drip_guard_item_progress
  before insert or update on class_item_progress
  for each row execute function _drip_guard_item_progress();
