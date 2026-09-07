-- ============================================================
-- 0054 — Bizzlivo Platform Operations Center.
--
-- The control plane for running Bizzlivo itself — completely separate
-- from office (organization) admin. Access is gated by platform_admins +
-- is_platform_admin() / is_platform_super_admin(); every cross-tenant read
-- is a SECURITY DEFINER RPC that re-checks the role. No blanket SELECT
-- policies, org RLS untouched.
--
-- NO secrets in this file. The initial admin-bizzlivo account is created
-- out-of-band (auth-provider user + a platform_admins row) — see the
-- bootstrap note in the system overview.
-- ============================================================

-- ---------- platform_admins: username + login tracking ----------
alter table platform_admins add column if not exists username            text;
alter table platform_admins add column if not exists last_login_at       timestamptz;
alter table platform_admins add column if not exists must_change_password boolean not null default false;
create unique index if not exists platform_admins_username_key on platform_admins (lower(username)) where username is not null;

create or replace function is_platform_super_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from platform_admins where id = auth.uid() and role = 'super_admin');
$$;
grant execute on function is_platform_super_admin() to authenticated;

-- Anon-callable: resolve a platform username to its auth email so the
-- dedicated /platform/login page can sign in by username. Returns only the
-- email of an existing platform admin — nothing else.
create or replace function platform_username_email(p_username text)
returns text language sql security definer set search_path = public as $$
  select u.email
  from platform_admins pa
  join auth.users u on u.id = pa.id
  where lower(pa.username) = lower(trim(p_username))
  limit 1;
$$;
grant execute on function platform_username_email(text) to anon, authenticated;

-- Called by the client right after a successful platform sign-in.
create or replace function platform_record_login()
returns jsonb language plpgsql security definer set search_path = public as $$
declare pa platform_admins;
begin
  select * into pa from platform_admins where id = auth.uid();
  if pa.id is null then raise exception 'not a platform admin'; end if;

  update platform_admins set last_login_at = now() where id = auth.uid();
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'platform.login', 'platform_admin', auth.uid(),
          jsonb_build_object('at', now()));

  return jsonb_build_object('username', pa.username, 'role', pa.role, 'must_change_password', pa.must_change_password);
end;
$$;
grant execute on function platform_record_login() to authenticated;

create or replace function platform_clear_must_change_password()
returns void language sql security definer set search_path = public as $$
  update platform_admins set must_change_password = false where id = auth.uid();
$$;
grant execute on function platform_clear_must_change_password() to authenticated;

-- audit_log.org_id was NOT NULL — platform events aren't org-scoped.
alter table audit_log alter column org_id drop not null;

-- ---------- plan overrides ----------
create table plan_overrides (
  org_id        uuid primary key references organizations(id) on delete cascade,
  original_plan text not null,
  override_plan text not null,
  reason        text not null,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz
);
alter table plan_overrides enable row level security;
create policy "platform admins read plan overrides"
  on plan_overrides for select using (is_platform_admin());

-- ---------- platform settings (single row, only wired toggles) ----------
create table platform_settings (
  id                 boolean primary key default true check (id),
  signup_enabled     boolean not null default true,
  maintenance_mode   boolean not null default false,
  default_free_plan  text not null default 'free',
  support_email      text,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references profiles(id) on delete set null
);
insert into platform_settings (id) values (true) on conflict do nothing;
alter table platform_settings enable row level security;
create policy "anyone reads platform settings" on platform_settings for select using (true);

-- (email logging is provided by 0053_email.sql: email_outbox / email_log)

-- ============================================================
-- Privileged read RPCs — all check is_platform_admin() first
-- ============================================================
create or replace function platform_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'organizations', (select count(*) from organizations),
    'active_organizations', (select count(*) from organizations where status = 'active'),
    'suspended_organizations', (select count(*) from organizations where status = 'suspended'),
    'paid_organizations', (select count(*) from organizations where plan_tier in ('growth','business')),
    'free_organizations', (select count(*) from organizations where plan_tier = 'free' or plan_tier is null),
    'new_orgs_month', (select count(*) from organizations where created_at >= date_trunc('month', now())),
    'total_users', (select count(*) from profiles),
    'active_users_7d', (select count(distinct actor_id) from activity_log where created_at >= now() - interval '7 days'),
    'active_users_30d', (select count(distinct actor_id) from activity_log where created_at >= now() - interval '30 days'),
    'mrr_kobo', (
      select coalesce(sum(pl.price_monthly_kobo), 0)
      from subscriptions s join plan_limits pl on pl.plan = s.plan
      where s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now())
    ),
    'subscriptions_active', (select count(*) from subscriptions where status in ('active','trialing')),
    'subscriptions_past_due', (select count(*) from subscriptions where status = 'past_due'),
    'plan_mix', jsonb_build_object(
      'free', (select count(*) from organizations where plan_tier = 'free' or plan_tier is null),
      'growth', (select count(*) from organizations where plan_tier = 'growth'),
      'business', (select count(*) from organizations where plan_tier = 'business')
    ),
    'ai_generations_month', (select count(*) from ai_usage_events where created_at >= date_trunc('month', now())),
    'ai_questions_month', (select coalesce(sum(question_count),0) from ai_usage_events where created_at >= date_trunc('month', now())),
    'email_failures_7d', (select count(*) from email_log where status = 'failed' and created_at >= now() - interval '7 days'),
    'support_open', (select count(*) from support_tickets where status in ('open','in_progress')),
    'support_stale', (select count(*) from support_tickets where status in ('open','in_progress') and created_at < now() - interval '3 days'),
    'org_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) c
            from organizations where created_at >= now() - interval '12 months' group by 1) g
    ),
    'user_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) c
            from profiles where created_at >= now() - interval '12 months' group by 1) g
    ),
    'attention', (
      select coalesce(jsonb_agg(a), '[]'::jsonb) from (
        select jsonb_build_object('kind','past_due','count',count(*),'text',count(*) || ' subscription(s) past due','route','/platform/subscriptions') a
          from subscriptions where status = 'past_due' having count(*) > 0
        union all
        select jsonb_build_object('kind','email','count',count(*),'text',count(*) || ' email delivery failure(s) this week','route','/platform/email')
          from email_log where status = 'failed' and created_at >= now() - interval '7 days' having count(*) > 0
        union all
        select jsonb_build_object('kind','support','count',count(*),'text',count(*) || ' support ticket(s) older than 3 days','route','/platform/support')
          from support_tickets where status in ('open','in_progress') and created_at < now() - interval '3 days' having count(*) > 0
        union all
        select jsonb_build_object('kind','ai_limit','count',count(*),'text',count(*) || ' org(s) at/over their monthly AI limit','route','/platform/ai')
          from (
            select o.id from organizations o join plan_limits pl on pl.plan = o.plan_tier
            where (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())) >= pl.ai_exam_generations_per_month
          ) x having count(*) > 0
        union all
        select jsonb_build_object('kind','over_members','count',count(*),'text',count(*) || ' org(s) over their member limit','route','/platform/organizations')
          from (
            select o.id from organizations o join plan_limits pl on pl.plan = o.plan_tier
            where pl.max_members is not null
              and (select count(*) from memberships m where m.org_id = o.id and m.status = 'active') > pl.max_members
          ) x having count(*) > 0
      ) items
    ),
    'recent_orgs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'plan', o.plan_tier, 'status', o.status, 'created_at', o.created_at,
        'members', (select count(*) from memberships m where m.org_id = o.id and m.status = 'active'),
        'owner', (select p.full_name from memberships m join profiles p on p.id = m.user_id
                  where m.org_id = o.id and m.role = 'admin' and m.status = 'active' order by m.joined_at limit 1),
        'last_active', (select max(al.created_at) from activity_log al where al.org_id = o.id)
      ) order by o.created_at desc), '[]'::jsonb)
      from (select * from organizations order by created_at desc limit 8) o
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(jsonb_build_object('summary', summary, 'verb', verb, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from (select * from activity_log order by created_at desc limit 12) a
    )
  ) into result;
  return result;
exception when others then
  return jsonb_build_object('_error', sqlerrm, '_at', 'platform_overview');
end;
$$;
grant execute on function platform_overview() to authenticated;

create or replace function platform_orgs(p_filter text default 'all', p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; needle text := '%' || coalesce(trim(p_q), '') || '%';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row order by (row->>'created_at') desc), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'plan', o.plan_tier, 'status', o.status,
      'created_at', o.created_at, 'base_currency', o.base_currency,
      'members', (select count(*) from memberships m where m.org_id = o.id and m.status = 'active'),
      'owner_name', ow.full_name, 'owner_email', ow.email,
      'ai_month', (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
      'has_override', exists (select 1 from plan_overrides po where po.org_id = o.id),
      'sub_status', (select s.status from subscriptions s where s.org_id = o.id limit 1),
      'last_active', (select max(al.created_at) from activity_log al where al.org_id = o.id)
    ) as row
    from organizations o
    left join lateral (
      select p.full_name, p.email from memberships m join profiles p on p.id = m.user_id
      where m.org_id = o.id and m.role = 'admin' and m.status = 'active' order by m.joined_at limit 1
    ) ow on true
    where (p_q is null or o.name ilike needle or ow.full_name ilike needle or ow.email ilike needle)
      and case p_filter
        when 'free' then (o.plan_tier = 'free' or o.plan_tier is null)
        when 'growth' then o.plan_tier = 'growth'
        when 'business' then o.plan_tier = 'business'
        when 'active' then o.status = 'active'
        when 'suspended' then o.status = 'suspended'
        when 'past_due' then exists (select 1 from subscriptions s where s.org_id = o.id and s.status = 'past_due')
        else true end
  ) t;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_orgs');
end;
$$;
grant execute on function platform_orgs(text, text) to authenticated;

create or replace function platform_org_detail(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'org', (select to_jsonb(o) from organizations o where o.id = p_org),
    'owner', (select jsonb_build_object('name', p.full_name, 'email', p.email)
              from memberships m join profiles p on p.id = m.user_id
              where m.org_id = p_org and m.role = 'admin' and m.status = 'active' order by m.joined_at limit 1),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'role', m.role, 'status', m.status, 'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
      from memberships m join profiles p on p.id = m.user_id where m.org_id = p_org
    ),
    'subscription', (select to_jsonb(s) from subscriptions s where s.org_id = p_org limit 1),
    'override', (select to_jsonb(po) from plan_overrides po where po.org_id = p_org),
    'usage', (
      select jsonb_build_object(
        'members', (select count(*) from memberships where org_id = p_org and status = 'active'),
        'max_members', pl.max_members,
        'ai_generations', (select count(*) from ai_usage_events where org_id = p_org and created_at >= date_trunc('month', now())),
        'ai_limit', pl.ai_exam_generations_per_month,
        'published_exams', (select count(*) from exams where org_id = p_org and status = 'published')
      ) from plan_limits pl join organizations o on o.plan_tier = pl.plan where o.id = p_org
    ),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('summary', summary, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
                 from (select * from activity_log where org_id = p_org order by created_at desc limit 15) a),
    'support', (select coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'status', status, 'priority', priority, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
                from support_tickets where org_id = p_org),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'actor', (select full_name from profiles where id = actor_id), 'metadata', metadata, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
              from (select * from audit_log where org_id = p_org order by created_at desc limit 20) a)
  ) into result;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_org_detail');
end;
$$;
grant execute on function platform_org_detail(uuid) to authenticated;

create or replace function platform_users(p_q text default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; needle text := '%' || coalesce(trim(p_q), '') || '%';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'email', p.email, 'created_at', p.created_at,
    'org', o.name, 'org_id', o.id, 'office_role', m.role, 'membership_status', m.status,
    'platform_role', (select role from platform_admins pa where pa.id = p.id),
    'last_active', (select max(al.created_at) from activity_log al where al.actor_id = p.id)
  ) order by p.created_at desc), '[]'::jsonb) into result
  from profiles p
  left join lateral (select * from memberships mm where mm.user_id = p.id order by mm.joined_at limit 1) m on true
  left join organizations o on o.id = m.org_id
  where p_q is null or p.full_name ilike needle or p.email ilike needle or o.name ilike needle
  limit p_limit;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_users');
end;
$$;
grant execute on function platform_users(text, int) to authenticated;

create or replace function platform_subscriptions(p_filter text default 'all')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'org', o.name, 'org_id', o.id, 'plan', coalesce(s.plan, o.plan_tier), 'status', coalesce(s.status, 'none'),
    'billing_cycle', s.billing_cycle, 'amount_kobo', s.amount_kobo, 'provider', s.provider,
    'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
    'created_at', coalesce(s.created_at, o.created_at)
  ) order by o.name), '[]'::jsonb) into result
  from organizations o
  left join subscriptions s on s.org_id = o.id
  where case p_filter
    when 'free' then (coalesce(s.plan, o.plan_tier) = 'free' or coalesce(s.plan, o.plan_tier) is null)
    when 'growth' then coalesce(s.plan, o.plan_tier) = 'growth'
    when 'business' then coalesce(s.plan, o.plan_tier) = 'business'
    when 'active' then s.status in ('active','trialing')
    when 'past_due' then s.status = 'past_due'
    when 'cancelled' then s.status in ('canceled','cancelled','expired')
    else true end;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_subscriptions');
end;
$$;
grant execute on function platform_subscriptions(text) to authenticated;

create or replace function platform_ai_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'org', o.name, 'org_id', o.id, 'plan', o.plan_tier,
    'generations', (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    'questions', (select coalesce(sum(u.question_count),0) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    'gen_limit', pl.ai_exam_generations_per_month,
    'q_limit', pl.ai_questions_per_month
  ) order by (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())) desc), '[]'::jsonb) into result
  from organizations o join plan_limits pl on pl.plan = o.plan_tier;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_ai_usage');
end;
$$;
grant execute on function platform_ai_usage() to authenticated;

create or replace function platform_audit(p_q text default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; needle text := '%' || coalesce(trim(p_q), '') || '%';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
    'actor', (select full_name from profiles where id = a.actor_id),
    'org', (select name from organizations where id = a.org_id),
    'metadata', a.metadata, 'created_at', a.created_at
  ) order by a.created_at desc), '[]'::jsonb) into result
  from (select * from audit_log
        where p_q is null or action ilike needle or entity_type ilike needle
        order by created_at desc limit p_limit) a;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_audit');
end;
$$;
grant execute on function platform_audit(text, int) to authenticated;

create or replace function platform_support()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'subject', t.subject, 'category', t.category, 'priority', t.priority, 'status', t.status,
    'org', o.name, 'user', p.full_name, 'created_at', t.created_at, 'admin_note', t.admin_note
  ) order by t.created_at desc), '[]'::jsonb) into result
  from support_tickets t
  join organizations o on o.id = t.org_id
  join profiles p on p.id = t.created_by;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_support');
end;
$$;
grant execute on function platform_support() to authenticated;

-- ============================================================
-- Privileged write RPCs — audited, reason required
-- ============================================================
create or replace function platform_set_org_status(p_org uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare prev text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('active','suspended') then raise exception 'invalid status'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select status into prev from organizations where id = p_org;
  update organizations set status = p_status where id = p_org;
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.org_status', 'organization', p_org,
          jsonb_build_object('before', prev, 'after', p_status, 'reason', p_reason));
end;
$$;
grant execute on function platform_set_org_status(uuid, text, text) to authenticated;

create or replace function platform_set_plan_override(p_org uuid, p_plan text, p_reason text, p_expires timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not is_platform_super_admin() then raise exception 'not authorized'; end if;
  if p_plan not in ('free','growth','business') then raise exception 'invalid plan'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select plan_tier into cur from organizations where id = p_org;

  insert into plan_overrides (org_id, original_plan, override_plan, reason, created_by, expires_at)
  values (p_org, cur, p_plan, p_reason, auth.uid(), p_expires)
  on conflict (org_id) do update set override_plan = excluded.override_plan, reason = excluded.reason,
    created_by = excluded.created_by, created_at = now(), expires_at = excluded.expires_at;

  update organizations set plan_tier = p_plan where id = p_org;
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.plan_override', 'organization', p_org,
          jsonb_build_object('before', cur, 'after', p_plan, 'reason', p_reason, 'expires_at', p_expires));
end;
$$;
grant execute on function platform_set_plan_override(uuid, text, text, timestamptz) to authenticated;

create or replace function platform_clear_plan_override(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare orig text;
begin
  if not is_platform_super_admin() then raise exception 'not authorized'; end if;
  select original_plan into orig from plan_overrides where org_id = p_org;
  if orig is null then return; end if;
  update organizations set plan_tier = orig where id = p_org;
  delete from plan_overrides where org_id = p_org;
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.plan_override_cleared', 'organization', p_org,
          jsonb_build_object('restored_to', orig));
end;
$$;
grant execute on function platform_clear_plan_override(uuid) to authenticated;

create or replace function platform_extend_trial(p_org uuid, p_days int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update subscriptions
    set trial_ends_at = coalesce(trial_ends_at, now()) + make_interval(days => p_days),
        current_period_end = coalesce(current_period_end, now()) + make_interval(days => p_days)
    where org_id = p_org;
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.extend_trial', 'organization', p_org,
          jsonb_build_object('days', p_days, 'reason', p_reason, 'had_subscription', found));
end;
$$;
grant execute on function platform_extend_trial(uuid, int, text) to authenticated;

create or replace function platform_settings_update(p_signup boolean, p_maintenance boolean, p_support_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_super_admin() then raise exception 'not authorized'; end if;
  update platform_settings set
    signup_enabled = p_signup, maintenance_mode = p_maintenance,
    support_email = nullif(trim(coalesce(p_support_email,'')), ''),
    updated_at = now(), updated_by = auth.uid()
  where id;
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'platform.settings_changed', 'platform', null,
          jsonb_build_object('signup_enabled', p_signup, 'maintenance_mode', p_maintenance));
end;
$$;
grant execute on function platform_settings_update(boolean, boolean, text) to authenticated;

create or replace function platform_email_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'sent', (select count(*) from email_log where status = 'sent'),
    'failed', (select count(*) from email_log where status = 'failed'),
    'pending', (select count(*) from email_outbox where status in ('pending','processing')),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recipient', recipient_email, 'type', email_type, 'status', status, 'created_at', created_at,
        'subject', subject, 'error', error_message,
        'org', (select name from organizations where id = e.org_id)
      ) order by created_at desc), '[]'::jsonb)
      from (select * from email_log order by created_at desc limit 50) e
    )
  ) into result;
  return result;
end;
$$;
grant execute on function platform_email_stats() to authenticated;
