-- ============================================================
-- HQ360 — platform admin layer + public exam link (guest takers)
-- ============================================================

-- ============================================================
-- Public exam link — every exam gets a public_token; admin toggles
-- public_link_enabled and can regenerate the token to invalidate a
-- leaked link. Guests never touch these tables directly — only via
-- the start-attempt/submit-attempt Edge Functions (service role key).
-- ============================================================

alter table exams add column public_link_enabled boolean not null default false;
alter table exams add column public_token uuid not null default gen_random_uuid();

create unique index exams_public_token_idx on exams(public_token);

-- ============================================================
-- Guest attempts — user_id becomes optional; guests are identified
-- by taker_name instead. Existing member-attempt behavior is unchanged.
-- ============================================================

alter table attempts alter column user_id drop not null;
alter table attempts add column taker_name text;
alter table attempts add column is_guest boolean not null default false;
alter table attempts add constraint attempts_user_or_taker_check
  check (user_id is not null or taker_name is not null);

-- ============================================================
-- Platform admin — HQ360's own team, sits outside tenant structure.
-- Not an org membership. Accessed only through the functions below,
-- which run as security definer and enforce is_platform_admin()
-- internally — never query organizations/memberships directly with
-- the service role key from client code as a shortcut.
-- ============================================================

create table platform_admins (
  id          uuid primary key references profiles(id),
  role        text not null default 'admin',        -- super_admin / support / billing_admin
  created_at  timestamptz not null default now()
);

alter table platform_admins enable row level security;
-- no client-facing policy needed — only accessed inside security definer
-- functions below, which bypass RLS as the function owner (postgres)

create or replace function is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_admins where id = auth.uid()
  );
$$;

create or replace function admin_list_offices()
returns table (
  org_id            uuid,
  name              text,
  slug              text,
  plan_tier         text,
  status            text,
  member_count      bigint,
  exam_count        bigint,
  last_attempt_at   timestamptz,
  created_at        timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.id, o.name, o.slug, o.plan_tier, o.status,
    (select count(*) from memberships m where m.org_id = o.id and m.status = 'active'),
    (select count(*) from exams e where e.org_id = o.id),
    (select max(a.submitted_at) from attempts a where a.org_id = o.id),
    o.created_at
  from organizations o
  where is_platform_admin()          -- returns empty set for non-admins, doesn't error
  order by o.created_at desc;
$$;

create or replace function admin_get_office_detail(target_org_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select json_build_object(
    'org', (select row_to_json(o) from organizations o where o.id = target_org_id),
    'members', (select json_agg(row_to_json(m)) from memberships m where m.org_id = target_org_id),
    'exams', (select json_agg(row_to_json(e)) from exams e where e.org_id = target_org_id),
    'recent_attempts', (
      select json_agg(row_to_json(a)) from (
        select * from attempts where org_id = target_org_id
        order by started_at desc limit 20
      ) a
    )
  ) into result;

  return result;
end;
$$;

create or replace function admin_set_office_status(target_org_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  update organizations set status = new_status where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org_id, auth.uid(), 'platform_admin.status_change', 'organization',
          target_org_id, jsonb_build_object('new_status', new_status));
end;
$$;

create or replace function admin_set_plan_tier(target_org_id uuid, new_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  update organizations set plan_tier = new_plan where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org_id, auth.uid(), 'platform_admin.plan_change', 'organization',
          target_org_id, jsonb_build_object('new_plan', new_plan));
end;
$$;

grant execute on function is_platform_admin() to authenticated;
grant execute on function admin_list_offices() to authenticated;
grant execute on function admin_get_office_detail(uuid) to authenticated;
grant execute on function admin_set_office_status(uuid, text) to authenticated;
grant execute on function admin_set_plan_tier(uuid, text) to authenticated;
