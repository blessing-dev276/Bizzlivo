-- ============================================================
-- Business Path — org-managed rank progression that ORCHESTRATES the
-- existing Learning Center + activity systems (it never duplicates
-- content). Supersedes the single ordered flow in task_flow_steps
-- (0033) and the hardcoded rank ladder in src/lib/rank.ts.
--
-- Model:
--   business_path_ranks    — each office's own ordered ranks
--   business_path_items    — per-rank requirements, one shape for both
--                            the "Learning Path" and the "Business Tasks"
--                            sections (distinguished by `section`)
--   member_rank_progress   — EXTENDED: current_rank_id (fk) + timestamps.
--                            The old `current_rank` text column is kept
--                            (nullable) for rollback.
--   member_rank_history    — append-only promotion log
--   business_path_item_progress — ONLY manual_admin / manual_self /
--                            resource / link completions. class / exam /
--                            assignment / activity completion is derived
--                            live from the owning system (see
--                            src/lib/taskProgress.ts + src/lib/businessPath.ts).
--   promote_member()       — security-definer RPC that owns the promotion
--                            rule (who may promote + approval mode).
--
-- Migration safety: task_flow_steps and member_rank_progress.current_rank
-- are LEFT IN PLACE. Existing rows are copied forward so the new UI works
-- immediately; a later migration drops the old shapes once Business Path
-- is confirmed in production.
-- ============================================================

-- ---------- ranks ----------
create table business_path_ranks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  slug            text not null,                       -- stable internal key (legacy: prospect|newbie|qualified|builder|leader|director)
  name            text not null,
  description     text,
  order_index     int  not null default 0,
  color           text,                                -- optional hex for the member UI
  icon            text,                                -- optional short token / emoji
  is_active       boolean not null default true,
  promotion_mode  text not null default 'automatic',   -- automatic | approval
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, slug),
  check (promotion_mode in ('automatic', 'approval'))
);
create index business_path_ranks_org_order_idx on business_path_ranks (org_id, order_index);

-- ---------- per-rank items (learning path + business tasks) ----------
create table business_path_items (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  rank_id                   uuid not null references business_path_ranks(id) on delete cascade,
  section                   text not null,             -- learning | task
  kind                      text not null,
  title                     text not null,
  instructions              text,
  order_index               int  not null default 0,
  is_required               boolean not null default true,
  -- content pointers — reuse existing rows, never duplicate content
  class_id                  uuid references classes(id) on delete cascade,
  exam_id                   uuid references exams(id) on delete cascade,
  coursework_assignment_id  uuid references coursework_assignments(id) on delete cascade,
  resource_id               uuid references resources(id) on delete cascade,
  link_url                  text,
  event_id                  uuid references events(id) on delete set null,
  -- activity thresholds (validated app-side; null -> treated as 1)
  target_count              int,
  target_amount             numeric(12, 2),
  created_by                uuid not null references profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (section in ('learning', 'task')),
  check (kind in (
    'class', 'exam', 'assignment', 'resource', 'link',
    'daily_reports', 'prospects_added', 'followups_logged', 'event_attendance', 'income_logged', 'monthly_goal',
    'manual_admin', 'manual_self'
  )),
  -- the pointer that matches the kind must be present
  check (
    case kind
      when 'class'      then class_id is not null
      when 'exam'       then exam_id is not null
      when 'assignment' then coursework_assignment_id is not null
      when 'resource'   then resource_id is not null
      when 'link'       then link_url is not null
      else true
    end
  )
);
create index business_path_items_rank_idx on business_path_items (org_id, rank_id, section, order_index);

-- ---------- member position on the ladder (EXTEND member_rank_progress) ----------
alter table member_rank_progress
  add column current_rank_id uuid references business_path_ranks(id) on delete set null;
alter table member_rank_progress add column started_at   timestamptz;
alter table member_rank_progress add column completed_at timestamptz;
alter table member_rank_progress alter column current_rank drop not null;

-- ---------- promotion history ----------
create table member_rank_history (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  rank_id      uuid not null references business_path_ranks(id) on delete cascade,
  achieved_at  timestamptz not null default now(),
  approved_by  uuid references profiles(id) on delete set null,   -- null = automatic promotion
  created_at   timestamptz not null default now()
);
create index member_rank_history_user_idx on member_rank_history (org_id, user_id, achieved_at desc);

-- ---------- manual / self-confirm item completions ----------
create table business_path_item_progress (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  item_id       uuid not null references business_path_items(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  marked_by     uuid references profiles(id) on delete set null,  -- null = member self-confirmed
  note          text,
  created_at    timestamptz not null default now(),
  unique (user_id, item_id)
);
create index business_path_item_progress_user_idx on business_path_item_progress (org_id, user_id);

-- ============================================================
-- Seed + data migration
-- ============================================================

-- default ladder for every existing office
insert into business_path_ranks (org_id, slug, name, description, order_index)
select o.id, d.slug, d.name, d.description, d.ord
from organizations o
cross join (values
  ('prospect',  'Prospect',     'Getting to know the business and finishing onboarding.', 0),
  ('newbie',    'Newbie',       'Registered and working your first prospects.',           1),
  ('qualified', 'Qualified',    'First customers won and a steady follow-up habit.',      2),
  ('builder',   'Team Builder', 'Recruiting distributors and helping them start.',        3),
  ('leader',    'Team Leader',  'Leading an active team toward their own ranks.',         4),
  ('director',  'Director',     'Multiple leaders in depth and a self-driven organisation.', 5)
) as d(slug, name, description, ord)
on conflict (org_id, slug) do nothing;

-- copy the existing single task flow onto each office's FIRST rank as tasks
insert into business_path_items
  (org_id, rank_id, section, kind, title, instructions, order_index,
   class_id, exam_id, coursework_assignment_id, created_by)
select
  s.org_id,
  (select br.id from business_path_ranks br where br.org_id = s.org_id order by br.order_index limit 1),
  'task',
  s.type,                       -- 'class' | 'exam' | 'assignment' already match kind values
  s.title,
  s.description,
  s.order_index,
  s.class_id, s.exam_id, s.coursework_assignment_id,
  s.created_by
from task_flow_steps s;

-- remap member_rank_progress.current_rank (text) -> current_rank_id (fk)
update member_rank_progress mp
set current_rank_id = r.id,
    started_at = coalesce(mp.started_at, mp.updated_at, now())
from business_path_ranks r
where r.org_id = mp.org_id
  and r.slug = case mp.current_rank
    when 'team_builder' then 'builder'
    when 'team_leader'  then 'leader'
    else mp.current_rank
  end;

-- anything unmatched (unexpected legacy value) -> that office's first rank
update member_rank_progress mp
set current_rank_id = (
      select br.id from business_path_ranks br
      where br.org_id = mp.org_id order by br.order_index limit 1
    ),
    started_at = coalesce(mp.started_at, now())
where mp.current_rank_id is null;

-- ============================================================
-- Promotion RPC — owns the "who may promote + approval mode" rule
-- ============================================================
create or replace function promote_member(
  target_user  uuid,
  target_org   uuid,
  to_rank_id   uuid,
  is_auto      boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   uuid := auth.uid();
  is_staff boolean;
begin
  if not exists (select 1 from business_path_ranks where id = to_rank_id and org_id = target_org) then
    raise exception 'rank does not belong to this organisation';
  end if;

  is_staff := has_org_role(target_org, array['admin'])
    or (has_org_role(target_org, array['team_leader']) and exists (
      select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.org_id = target_org and g.leader_id = caller and gm.user_id = target_user
    ));

  if not is_staff then
    -- a member may only advance THEMSELVES, and only from an
    -- automatic-mode rank. (Full server-side completion re-check is a
    -- follow-up hardening; the client verifies 100% before calling.)
    if caller is distinct from target_user then
      raise exception 'not permitted to promote this member';
    end if;
    if not exists (
      select 1 from member_rank_progress mp
      join business_path_ranks r on r.id = mp.current_rank_id
      where mp.org_id = target_org and mp.user_id = target_user
        and r.promotion_mode = 'automatic'
    ) then
      raise exception 'this rank requires staff approval';
    end if;
  end if;

  update member_rank_progress
    set current_rank_id = to_rank_id,
        started_at = now(),
        completed_at = null,
        updated_at = now()
    where org_id = target_org and user_id = target_user;

  if not found then
    insert into member_rank_progress (org_id, user_id, current_rank, current_rank_id, started_at)
      values (target_org, target_user, null, to_rank_id, now());
  end if;

  insert into member_rank_history (org_id, user_id, rank_id, approved_by)
    values (target_org, target_user, to_rank_id, case when is_staff then caller else null end);
end;
$$;

grant execute on function promote_member(uuid, uuid, uuid, boolean) to authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table business_path_ranks enable row level security;
alter table business_path_items enable row level security;
alter table member_rank_history enable row level security;
alter table business_path_item_progress enable row level security;

-- ranks: everyone in the org reads; only admins configure
create policy "org members read business path ranks"
  on business_path_ranks for select using (is_org_member(org_id));
create policy "admins manage business path ranks"
  on business_path_ranks for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- items: everyone in the org reads; only admins configure
create policy "org members read business path items"
  on business_path_items for select using (is_org_member(org_id));
create policy "admins manage business path items"
  on business_path_items for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- rank history: member reads own; staff read org-wide; writes only via promote_member()
create policy "members read their own rank history"
  on member_rank_history for select using (user_id = auth.uid());
create policy "staff read rank history in their org"
  on member_rank_history for select
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));

-- item progress: member manages own for self-confirm kinds; staff mark manual + read org-wide
create policy "members self-confirm their own path items"
  on business_path_item_progress for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from business_path_items i
      where i.id = item_id and i.kind in ('manual_self', 'resource', 'link')
    )
  );
create policy "staff mark manual path items in their org"
  on business_path_item_progress for all
  using (has_org_role(org_id, array['admin', 'team_leader']))
  with check (has_org_role(org_id, array['admin', 'team_leader']));
create policy "staff read path item progress in their org"
  on business_path_item_progress for select
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));

-- member_rank_progress: allow seeding with a rank id; direct writes -> admin only
-- (team-leader promotions now flow through promote_member); keep staff read.
alter policy "members seed their own rank row" on member_rank_progress
  with check (user_id = auth.uid());
alter policy "staff manage ranks in their org" on member_rank_progress
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));
create policy "staff read member rank progress in their org"
  on member_rank_progress for select
  using (has_org_role(org_id, array['admin', 'trainer', 'team_leader']));
