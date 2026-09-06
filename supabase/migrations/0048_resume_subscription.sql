-- ============================================================
-- 0048 — let an admin undo a pending cancellation (before the period
-- actually ends). Charges are one-off inline, so "resume" is simply
-- clearing cancel_at_period_end while the current period is still valid;
-- no provider call needed. If the period already lapsed and the org fell
-- to Free, they check out again instead — this RPC is a no-op then.
-- ============================================================

create or replace function public.resume_subscription(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions
  set cancel_at_period_end = false
  where org_id = target_org_id
    and status in ('active', 'trialing')
    and coalesce(current_period_end, trial_ends_at) > now();

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'subscription_resumed', 'organizations', target_org_id);
end;
$$;
grant execute on function resume_subscription(uuid) to authenticated;
