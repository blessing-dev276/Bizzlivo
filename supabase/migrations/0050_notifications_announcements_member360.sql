-- ============================================================
-- 0050 — connected-OS phases 3, 4, 5.
--
--  Phase 3  Notification Center: categories + a real dedupe key +
--           per-member preferences + a notify() RPC that respects both.
--  Phase 4  Office Announcements: office_announcements + announcement_reads
--           + an audience-resolving read policy + a fan-out trigger that
--           drops a notification to the resolved audience.
--  Phase 5  Admin Member 360: report_member() extended (freelance + finance
--           + team + needs-attention) and its guard widened to team leaders
--           for their own team's members.
-- ============================================================

-- ============================================================
-- PHASE 3 — Notification Center
-- ============================================================
alter table notifications add column if not exists category   text;
alter table notifications add column if not exists dedupe_key  text;

-- backfill category from the historical `type` string
update notifications set category = case
  when type like 'goal%'      then 'goals'
  when type like 'freelance%' then 'freelance'
  when type like 'finance%' or type like '%withdrawal%' or type like '%payout%' then 'finance'
  when type like '%exam%' or type like '%class%' or type like '%learning%' or type like '%assignment%' then 'learning'
  when type in ('join_request') or type like 'announcement%' then 'office'
  when type like '%prospect%' or type like '%network%' then 'network'
  else 'business'
end
where category is null;

create unique index if not exists notifications_dedupe_uq
  on notifications (user_id, dedupe_key) where dedupe_key is not null;

create index if not exists notifications_user_cat_idx
  on notifications (user_id, category, created_at desc);

-- ---------- per-member preferences ----------
create table if not exists notification_prefs (
  user_id        uuid primary key references profiles(id) on delete cascade,
  goal_reminders boolean not null default true,
  learning       boolean not null default true,
  finance        boolean not null default true,
  events         boolean not null default true,
  announcements  boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table notification_prefs enable row level security;
create policy "members manage their own notification prefs"
  on notification_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- notify() — the one safe path to create a notification ----------
-- Respects notification_prefs (category -> pref column) and the dedupe key.
create or replace function notify(
  p_org uuid, p_user uuid, p_category text, p_type text,
  p_text text, p_link text default null, p_dedupe_key text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_allowed boolean := true;
begin
  if not is_org_member(p_org) then raise exception 'not permitted'; end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user and status = 'active') then
    return;   -- target isn't an active member of this office
  end if;

  select case p_category
    when 'goals'     then coalesce(np.goal_reminders, true)
    when 'learning'  then coalesce(np.learning, true)
    when 'finance'   then coalesce(np.finance, true)
    when 'office'    then coalesce(np.announcements, true)
    else true
  end into v_allowed
  from (select p_user as uid) x
  left join notification_prefs np on np.user_id = x.uid;
  if not coalesce(v_allowed, true) then return; end if;

  if p_dedupe_key is not null then
    insert into notifications (org_id, user_id, type, category, channel, payload, status, dedupe_key)
    values (p_org, p_user, p_type, p_category, 'in_app',
            jsonb_build_object('text', p_text, 'link', p_link), 'sent', p_dedupe_key)
    on conflict (user_id, dedupe_key) do nothing;
  else
    insert into notifications (org_id, user_id, type, category, channel, payload, status)
    values (p_org, p_user, p_type, p_category, 'in_app',
            jsonb_build_object('text', p_text, 'link', p_link), 'sent');
  end if;
end;
$$;
grant execute on function notify(uuid, uuid, text, text, text, text, text) to authenticated;

-- ============================================================
-- PHASE 4 — Office Announcements
-- ============================================================
create table office_announcements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  title            text not null,
  body             text not null,
  audience_type    text not null default 'all' check (audience_type in ('all','team','rank','members')),
  audience_ids     uuid[] not null default '{}',     -- group ids / rank ids / user ids per audience_type
  priority         text not null default 'normal' check (priority in ('low','normal','high')),
  link             text,
  related_event_id uuid references events(id) on delete set null,
  publish_at       timestamptz not null default now(),
  expires_at       timestamptz,
  pinned           boolean not null default false,
  requires_ack     boolean not null default false,
  created_by       uuid not null references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index office_announcements_org_idx on office_announcements (org_id, publish_at desc);

create table announcement_reads (
  announcement_id uuid not null references office_announcements(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  read_at         timestamptz,
  acked_at        timestamptz,
  primary key (announcement_id, user_id)
);

alter table office_announcements enable row level security;
alter table announcement_reads   enable row level security;

create policy "admins manage announcements in their org"
  on office_announcements for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- a member sees a published, unexpired announcement whose audience includes them
create policy "members read announcements addressed to them"
  on office_announcements for select
  using (
    is_org_member(org_id)
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
    and (
      audience_type = 'all'
      or (audience_type = 'members' and auth.uid() = any (audience_ids))
      or (audience_type = 'team' and exists (
        select 1 from group_members gm where gm.user_id = auth.uid() and gm.group_id = any (audience_ids)))
      or (audience_type = 'rank' and exists (
        select 1 from member_rank_progress mp
        where mp.user_id = auth.uid() and mp.org_id = office_announcements.org_id
          and mp.current_rank_id = any (audience_ids)))
    )
  );

create policy "members manage their own announcement reads"
  on announcement_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- fan-out: on publish, notify the resolved audience (respects prefs via notify()).
create or replace function announcement_fanout()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.publish_at > now() then return new; end if;
  for u in
    select m.user_id from memberships m
    where m.org_id = new.org_id and m.status = 'active' and m.role = 'member'
      and (
        new.audience_type = 'all'
        or (new.audience_type = 'members' and m.user_id = any (new.audience_ids))
        or (new.audience_type = 'team' and exists (
          select 1 from group_members gm where gm.user_id = m.user_id and gm.group_id = any (new.audience_ids)))
        or (new.audience_type = 'rank' and exists (
          select 1 from member_rank_progress mp
          where mp.user_id = m.user_id and mp.org_id = new.org_id and mp.current_rank_id = any (new.audience_ids)))
      )
  loop
    perform notify(new.org_id, u, 'office', 'announcement',
      new.title, coalesce(new.link, '/updates'), 'ann:' || new.id::text);
  end loop;
  return new;
end;
$$;
create trigger office_announcements_fanout
  after insert on office_announcements
  for each row execute function announcement_fanout();

-- ============================================================
-- PHASE 5 — Admin Member 360 (extend report_member)
-- ============================================================
create or replace function report_member(p_org uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  result jsonb;
  v_total int := 0;
  v_done int := 0;
  v_since timestamptz;
  it business_path_items;
  c boolean;
  items jsonb := '[]'::jsonb;
  may boolean;
begin
  may := has_org_role(p_org, array['admin'])
    or (has_org_role(p_org, array['team_leader']) and exists (
      select 1 from groups g join group_members gm on gm.group_id = g.id
      where g.org_id = p_org and g.leader_id = auth.uid() and gm.user_id = p_user));
  if not may then raise exception 'not authorized'; end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user) then
    raise exception 'member not in this office';
  end if;

  select coalesce(started_at, 'epoch'::timestamptz) into v_since
  from member_rank_progress where org_id = p_org and user_id = p_user;
  v_since := coalesce(v_since, 'epoch'::timestamptz);

  for it in
    select bi.* from business_path_items bi
    join member_rank_progress mp on mp.current_rank_id = bi.rank_id and mp.org_id = p_org and mp.user_id = p_user
    where bi.org_id = p_org
    order by bi.section, bi.order_index
  loop
    c := report_bp_item_complete(it, p_user, v_since);
    if it.is_required then
      v_total := v_total + 1;
      if c then v_done := v_done + 1; end if;
    end if;
    items := items || jsonb_build_object('title', it.title, 'required', it.is_required, 'complete', c);
  end loop;

  select jsonb_build_object(
    'name', (select full_name from profiles where id = p_user),
    'avatar_url', (select avatar_url from profiles where id = p_user),
    'role', (select role from memberships where org_id = p_org and user_id = p_user),
    'membership_status', (select status from memberships where org_id = p_org and user_id = p_user),
    'team', (select g.name from group_members gm join groups g on g.id = gm.group_id where gm.user_id = p_user and g.org_id = p_org limit 1),
    'rank', (select r.name from member_rank_progress mp left join business_path_ranks r on r.id = mp.current_rank_id where mp.org_id = p_org and mp.user_id = p_user),
    'rank_started_at', v_since,
    'bp_required_total', v_total,
    'bp_required_done', v_done,
    'bp_percent', case when v_total > 0 then round(v_done::numeric / v_total * 100) else 0 end,
    'bp_items', items,
    'goals_total', (select count(*) from member_monthly_goals where org_id = p_org and user_id = p_user),
    'goals_done', (select count(*) from member_monthly_goals where org_id = p_org and user_id = p_user and done),
    'goals_this_month', (select count(*) from member_monthly_goals where org_id = p_org and user_id = p_user and period_type = 'monthly' and month = to_char(now(),'YYYY-MM')),
    'goals_changes_requested', (select count(*) from member_monthly_goals where org_id = p_org and user_id = p_user and status = 'changes_requested'),
    'direct_members', (select count(*) from profiles p join memberships m on m.user_id = p.id where p.sponsor_member_id = p_user and m.org_id = p_org and m.status = 'active'),
    'prospects', (select count(*) from network_marketing_contacts where org_id = p_org and user_id = p_user),
    'prospect_followups_overdue', (select count(*) from network_marketing_contacts where org_id = p_org and user_id = p_user and next_follow_up_at is not null and next_follow_up_at < now() and stage not in ('won_customer','won_distributor','lost')),
    'freelance_prospects', (select count(*) from freelance_prospects where org_id = p_org and member_id = p_user and status not in ('won','lost')),
    'freelance_clients', (select count(*) from freelance_clients where org_id = p_org and member_id = p_user),
    'freelance_projects_open', (select count(*) from freelance_projects where org_id = p_org and member_id = p_user and status not in ('completed','cancelled')),
    'freelance_projects_overdue', (select count(*) from freelance_projects where org_id = p_org and member_id = p_user and status not in ('completed','cancelled') and due_date is not null and due_date < current_date),
    'freelance_verified_earnings', (select coalesce(sum(order_value),0) from freelance_projects where org_id = p_org and member_id = p_user and finance_order_id is not null),
    'available_balance', (select finance_member_balances(p_org, p_user)),
    'income_total', (select coalesce(sum(amount), 0) from income_development_income_entries where org_id = p_org and user_id = p_user),
    'exams_passed', (select count(*) from attempts where org_id = p_org and user_id = p_user and passed is true),
    'joined_at', (select joined_at from memberships where org_id = p_org and user_id = p_user),
    'last_activity', (
      select max(ts) from (
        select max(completed_at) ts from class_item_progress where org_id = p_org and user_id = p_user
        union all select max(submitted_at) from attempts where org_id = p_org and user_id = p_user
        union all select max(created_at) from network_marketing_activities where org_id = p_org and user_id = p_user
        union all select max(created_at) from member_daily_reports where org_id = p_org and user_id = p_user
        union all select max(created_at) from freelance_activities where org_id = p_org and member_id = p_user
      ) a
    )
  ) into result;
  return result;
exception when others then
  return jsonb_build_object('_error', sqlerrm, '_at', 'report_member');
end;
$$;
