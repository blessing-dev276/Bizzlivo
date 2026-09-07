-- ============================================================
-- 0070 — new offices trial on the Starter package
-- ============================================================
-- start_trial() (0061) gave every new office a 30-day trial on the
-- 'growth' plan. Keep the 30 free days, but put the trial on 'starter'
-- instead — that's the package a new office lands on and pays for when
-- the trial ends.
--
-- Forward-only: offices already trialing on 'growth' keep it for the
-- rest of their trial. Only start_trial() changes.

create or replace function public.start_trial(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  if exists (select 1 from subscriptions where org_id = target_org_id) then
    return;
  end if;

  insert into subscriptions (org_id, plan, status, provider, trial_ends_at)
  values (target_org_id, 'starter', 'trialing', 'paystack', now() + interval '30 days');

  update organizations set plan_tier = 'starter' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'trial_started', 'organizations', target_org_id);
end;
$$;
