-- ============================================================
-- 0069 — permanent (hard) organization delete from the platform panel
-- ============================================================
-- delete_office() / platform_set_org_status(…, 'deleted') only flip a
-- flag — the org and all its data stay, and it can be restored. This
-- adds an irreversible purge: super-admin only, typed confirmation,
-- reason required, and a durable record that outlives the org.
--
-- Every org-scoped table references organizations(id) ON DELETE
-- CASCADE, so `delete from organizations` takes members, training,
-- finance, goals, ledger, audit — everything. auth.users rows are NOT
-- touched (members keep their Bizzlivo accounts).

-- Durable deletion record. No FK to organizations — it has to survive
-- the org being gone (audit_log rows cascade away with the org).
create table platform_org_deletions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  org_name      text not null,
  org_slug      text not null,
  plan_tier     text,
  member_count  integer not null default 0,
  reason        text not null,
  deleted_by    uuid,                       -- platform admin's auth.uid()
  snapshot      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table platform_org_deletions enable row level security;

create policy "platform admins read org deletions"
  on platform_org_deletions for select
  using (is_platform_admin());
-- no INSERT/UPDATE/DELETE policy: written only by platform_delete_org()

-- ------------------------------------------------------------
-- platform_delete_org(p_org, p_confirm, p_reason)
--   p_confirm must equal the org's slug exactly.
-- ------------------------------------------------------------
create or replace function platform_delete_org(p_org uuid, p_confirm text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name    text;
  v_slug    text;
  v_plan    text;
  v_status  text;
  v_members integer;
begin
  if not is_platform_super_admin() then
    raise exception 'not authorized: permanent deletion is super-admin only';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select name, slug, plan_tier, status
    into v_name, v_slug, v_plan, v_status
  from organizations where id = p_org;
  if v_name is null then
    raise exception 'organization not found';
  end if;

  if p_confirm is distinct from v_slug then
    raise exception 'confirmation text must exactly match the office slug (%)', v_slug;
  end if;

  select count(*) into v_members from memberships where org_id = p_org;

  insert into platform_org_deletions
    (org_id, org_name, org_slug, plan_tier, member_count, reason, deleted_by, snapshot)
  values (
    p_org, v_name, v_slug, v_plan, v_members, trim(p_reason), auth.uid(),
    jsonb_build_object(
      'status', v_status,
      'created_at', (select created_at from organizations where id = p_org),
      'subscription', (select to_jsonb(s) from subscriptions s where s.org_id = p_org),
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'role', m.role, 'status', m.status,
          'email', (select email from profiles pr where pr.id = m.user_id))), '[]'::jsonb)
        from memberships m where m.org_id = p_org
      )
    )
  );

  -- Cascades to every org-scoped table.
  delete from organizations where id = p_org;
end;
$$;

grant execute on function platform_delete_org(uuid, text, text) to authenticated;
