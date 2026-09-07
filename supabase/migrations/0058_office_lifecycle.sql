-- ============================================================
-- 0055 — office lifecycle: a member can leave an office, an office admin
-- can (soft-)delete their office, and a platform admin can bring a
-- deleted/suspended office back — quietly.
--
--  * organizations.status gains 'deleted' (soft — no data is removed, so
--    reactivation is a single flag flip). + deleted_at / deleted_by /
--    deleted_reason / suspended_reason for the record.
--  * member_leave_office(p_org)  — SECURITY DEFINER; sets the caller's own
--    membership to 'left'. Refuses if they are the last active admin.
--  * delete_office(p_org, reason) — SECURITY DEFINER; office admin only;
--    flips status to 'deleted', audited.
--  * platform_set_org_status()   — extended to accept 'deleted' and to
--    clear the deleted_* fields when an org is set back to 'active'. It
--    writes only an audit_log row (which office admins cannot read) and
--    sends no notification — reactivation is invisible to the office.
-- ============================================================

alter table organizations
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid references profiles(id) on delete set null,
  add column if not exists deleted_reason  text,
  add column if not exists suspended_reason text;

-- ---------- member leaves an office ----------
create or replace function member_leave_office(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  my_role text;
  admin_count int;
begin
  select role into my_role from memberships
  where org_id = p_org and user_id = auth.uid() and status = 'active';
  if my_role is null then
    raise exception 'you are not an active member of this office';
  end if;

  if my_role = 'admin' then
    select count(*) into admin_count from memberships
    where org_id = p_org and role = 'admin' and status = 'active';
    if admin_count <= 1 then
      raise exception 'you are the only admin — assign another admin before leaving, or delete the office instead';
    end if;
  end if;

  update memberships set status = 'left'
  where org_id = p_org and user_id = auth.uid();

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'member.left', 'membership', auth.uid(),
          jsonb_build_object('role', my_role));
end;
$$;
grant execute on function member_leave_office(uuid) to authenticated;

-- ---------- office admin soft-deletes the office ----------
create or replace function delete_office(p_org uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(p_org, array['admin']) then
    raise exception 'only an office admin can delete the office';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  update organizations
  set status = 'deleted', deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
  where id = p_org and status <> 'deleted';

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'org.deleted', 'organization', p_org,
          jsonb_build_object('reason', p_reason));
end;
$$;
grant execute on function delete_office(uuid, text) to authenticated;

-- ---------- platform: status change (now covers 'deleted' + revival) ----------
create or replace function platform_set_org_status(p_org uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare prev text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('active', 'suspended', 'deleted') then raise exception 'invalid status'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select status into prev from organizations where id = p_org;

  update organizations set
    status = p_status,
    suspended_reason = case when p_status = 'suspended' then p_reason else null end,
    deleted_at      = case when p_status = 'deleted' then coalesce(deleted_at, now()) else null end,
    deleted_by      = case when p_status = 'deleted' then coalesce(deleted_by, auth.uid()) else null end,
    deleted_reason  = case when p_status = 'deleted' then p_reason else null end
  where id = p_org;

  -- audit only — no notification to the office. Office admins cannot read
  -- platform.* audit rows, so a revival is invisible to them.
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.org_status', 'organization', p_org,
          jsonb_build_object('before', prev, 'after', p_status, 'reason', p_reason));
end;
$$;
grant execute on function platform_set_org_status(uuid, text, text) to authenticated;

-- ---------- platform: let the org list filter to deleted offices ----------
-- (only the filter arm changes vs 0054 — deleted offices were already
--  visible under 'all', this just makes them a one-click view for restore.)
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
        when 'deleted' then o.status = 'deleted'
        when 'past_due' then exists (select 1 from subscriptions s where s.org_id = o.id and s.status = 'past_due')
        else true end
  ) t;
  return result;
exception when others then return jsonb_build_object('_error', sqlerrm, '_at', 'platform_orgs');
end;
$$;
grant execute on function platform_orgs(text, text) to authenticated;
