-- ============================================================
-- 0073 — FINANCE PHASE 2  (automated payouts — code-complete, live-DISABLED)
--
-- Same ONE finance workflow as Phase 1. Only the execution step of an
-- already-AUTHORIZED withdrawal changes:
--
--   Phase 1 (A3):  authorized -> office pays -> record reference -> confirm -> PAID
--   Phase 2 (A2):  authorized -> Bizzlivo secure backend -> provider adapter
--                  -> organization provider account -> recipient -> transfer
--                  -> provider webhook -> PAID
--
-- Nothing here goes live until, per Decision B, the office's OWN provider
-- account is confirmed to support Transfers:
--   organization_finance_config.automated_payout_enabled  AND
--   organization_finance_connections.capabilities->>'supports_transfers'
-- Both are false everywhere by default. The frontend never calls the
-- provider — it calls the `finance-payout` Edge Function, which resolves
-- everything server-side and holds the secret key.
--
-- Idempotency (§22): withdrawal_payments.idempotency_key is the transfer
-- reference; provider_webhook_events dedupes inbound events.
-- ============================================================

-- ------------------------------------------------------------
-- 1. withdrawal_payments — provider-transfer columns
--    (this table already IS the "payout attempts" log: one row per
--     attempt, never overwritten, unique idempotency_key.)
-- ------------------------------------------------------------
alter table withdrawal_payments
  add column provider_transfer_id text,
  add column provider_status      text,          -- provider's own status string
  add column response_code        text,
  add column failure_code         text;

-- ------------------------------------------------------------
-- 2. can_initiate_payout — a distinct grant (Decision C)
-- ------------------------------------------------------------
alter table org_finance_grants
  add column can_initiate_payout boolean not null default false;

-- extend the capability resolver
create or replace function fin_capable_user(p_org uuid, p_user uuid, p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from memberships
      where org_id = p_org and user_id = p_user and status = 'active' and role = 'admin')
    or exists (
      select 1 from org_finance_grants g
      where g.org_id = p_org and g.user_id = p_user
        and case p_cap
          when 'view'              then g.can_view_finance
          when 'verify_settlement' then g.can_verify_settlement
          when 'review'            then g.can_review_withdrawal
          when 'approve'           then g.can_approve_withdrawal
          when 'authorize'         then g.can_authorize_payment
          when 'record_payment'    then g.can_record_payment
          when 'confirm_payment'   then g.can_confirm_payment
          when 'initiate_payout'   then g.can_initiate_payout
          when 'reconcile'         then g.can_manage_reconciliation
          else false
        end);
$$;

-- keep the admin grant editor in sync
create or replace function finance_set_grant(p_org uuid, p_user uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare before_row org_finance_grants;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'finance: office admin required'; end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user and status = 'active') then
    raise exception 'finance: that person is not an active member of this office';
  end if;
  select * into before_row from org_finance_grants where org_id = p_org and user_id = p_user;

  insert into org_finance_grants (org_id, user_id, granted_by,
    can_view_finance, can_verify_settlement, can_review_withdrawal, can_approve_withdrawal,
    can_authorize_payment, can_record_payment, can_confirm_payment, can_initiate_payout,
    can_manage_reconciliation, approval_limit_amount)
  values (p_org, p_user, auth.uid(),
    coalesce((p_patch->>'can_view_finance')::boolean, true),
    coalesce((p_patch->>'can_verify_settlement')::boolean, false),
    coalesce((p_patch->>'can_review_withdrawal')::boolean, false),
    coalesce((p_patch->>'can_approve_withdrawal')::boolean, false),
    coalesce((p_patch->>'can_authorize_payment')::boolean, false),
    coalesce((p_patch->>'can_record_payment')::boolean, false),
    coalesce((p_patch->>'can_confirm_payment')::boolean, false),
    coalesce((p_patch->>'can_initiate_payout')::boolean, false),
    coalesce((p_patch->>'can_manage_reconciliation')::boolean, false),
    nullif(p_patch->>'approval_limit_amount','')::numeric)
  on conflict (org_id, user_id) do update set
    can_view_finance          = coalesce((p_patch->>'can_view_finance')::boolean, org_finance_grants.can_view_finance),
    can_verify_settlement     = coalesce((p_patch->>'can_verify_settlement')::boolean, org_finance_grants.can_verify_settlement),
    can_review_withdrawal     = coalesce((p_patch->>'can_review_withdrawal')::boolean, org_finance_grants.can_review_withdrawal),
    can_approve_withdrawal    = coalesce((p_patch->>'can_approve_withdrawal')::boolean, org_finance_grants.can_approve_withdrawal),
    can_authorize_payment     = coalesce((p_patch->>'can_authorize_payment')::boolean, org_finance_grants.can_authorize_payment),
    can_record_payment        = coalesce((p_patch->>'can_record_payment')::boolean, org_finance_grants.can_record_payment),
    can_confirm_payment       = coalesce((p_patch->>'can_confirm_payment')::boolean, org_finance_grants.can_confirm_payment),
    can_initiate_payout       = coalesce((p_patch->>'can_initiate_payout')::boolean, org_finance_grants.can_initiate_payout),
    can_manage_reconciliation = coalesce((p_patch->>'can_manage_reconciliation')::boolean, org_finance_grants.can_manage_reconciliation),
    approval_limit_amount     = case when p_patch ? 'approval_limit_amount'
                                  then nullif(p_patch->>'approval_limit_amount','')::numeric
                                  else org_finance_grants.approval_limit_amount end,
    updated_at = now();

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before, after)
  values (p_org, auth.uid(), p_user, 'finance_grant_changed', 'finance_grant', p_user,
    to_jsonb(before_row), (select to_jsonb(g) from org_finance_grants g where g.org_id = p_org and g.user_id = p_user));
end;
$$;

-- ------------------------------------------------------------
-- 3. provider_webhook_events — inbound dedupe (§22)
-- ------------------------------------------------------------
create table provider_webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  event_type        text not null,
  provider_event_id text,
  signature_hash    text not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  result            text,                         -- 'applied' | 'ignored' | 'error'
  detail            text,
  unique (provider, signature_hash)
);
alter table provider_webhook_events enable row level security;
-- platform-only surface; no org policy (service role reads/writes)

create or replace function finance_record_webhook_event(
  p_provider text, p_event_type text, p_event_id text, p_sig_hash text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  insert into provider_webhook_events (provider, event_type, provider_event_id, signature_hash)
  values (p_provider, p_event_type, nullif(p_event_id,''), p_sig_hash)
  on conflict (provider, signature_hash) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function finance_mark_webhook_event(p_sig_hash text, p_result text, p_detail text default null)
returns void language sql security definer set search_path = public as $$
  update provider_webhook_events
  set processed_at = now(), result = p_result, detail = p_detail
  where signature_hash = p_sig_hash;
$$;

-- ------------------------------------------------------------
-- 4. finance_reconciliation_flags — persisted, clears on resolve
-- ------------------------------------------------------------
create table finance_reconciliation_flags (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  kind         text not null,
  entity_type  text,
  entity_id    uuid,
  detail       text,
  status       text not null default 'open' check (status in ('open','resolved')),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  resolved_by  uuid references profiles(id),
  resolved_at  timestamptz,
  unique (org_id, kind, entity_id)
);
alter table finance_reconciliation_flags enable row level security;
create policy "recon flags: finance reconcilers read"
  on finance_reconciliation_flags for select using (fin_can(org_id, 'reconcile'));
create index finance_reconciliation_flags_org_idx on finance_reconciliation_flags(org_id, status);

-- Rescan: (re)open flags for current discrepancies, auto-resolve those
-- that no longer hold. Read-only w.r.t. money.
create or replace function finance_reconcile_scan(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_open int;
begin
  perform fin_require(p_org, 'reconcile');

  -- stuck in provider transit / manual authorization for > 48h
  for r in
    select w.id, w.reference from withdrawal_requests w
    where w.org_id = p_org and w.status in ('authorized_for_payment','payment_recorded')
      and w.updated_at < now() - interval '48 hours'
  loop
    insert into finance_reconciliation_flags (org_id, kind, entity_type, entity_id, detail)
    values (p_org, 'stuck_in_payment', 'withdrawal', r.id, r.reference || ' has been mid-payment for over 48h')
    on conflict (org_id, kind, entity_id) do update
      set last_seen = now(), status = 'open', resolved_by = null, resolved_at = null;
  end loop;

  -- a failed provider attempt with no resolution
  for r in
    select w.id, w.reference, w.failure_reason from withdrawal_requests w
    where w.org_id = p_org and w.status = 'failed'
  loop
    insert into finance_reconciliation_flags (org_id, kind, entity_type, entity_id, detail)
    values (p_org, 'failed_payout', 'withdrawal', r.id, coalesce(r.failure_reason, 'payment failed'))
    on conflict (org_id, kind, entity_id) do update
      set last_seen = now(), status = 'open', resolved_by = null, resolved_at = null;
  end loop;

  -- paid but missing the finalized payout row
  for r in
    select w.id, w.reference from withdrawal_requests w
    where w.org_id = p_org and w.status = 'paid'
      and not exists (select 1 from finance_payouts fp where fp.withdrawal_id = w.id)
  loop
    insert into finance_reconciliation_flags (org_id, kind, entity_type, entity_id, detail)
    values (p_org, 'paid_without_payout_row', 'withdrawal', r.id, r.reference)
    on conflict (org_id, kind, entity_id) do update
      set last_seen = now(), status = 'open', resolved_by = null, resolved_at = null;
  end loop;

  -- negative member balance
  for r in
    select member_id, currency, sum(amount) bal from finance_ledger
    where org_id = p_org and affects_balance group by member_id, currency having sum(amount) < 0
  loop
    insert into finance_reconciliation_flags (org_id, kind, entity_type, entity_id, detail)
    values (p_org, 'negative_balance', 'member', r.member_id,
      r.currency || ' ledger sums to ' || r.bal)
    on conflict (org_id, kind, entity_id) do update
      set last_seen = now(), status = 'open', detail = excluded.detail, resolved_by = null, resolved_at = null;
  end loop;

  -- auto-resolve open flags that no longer reproduce
  update finance_reconciliation_flags f set status = 'resolved', resolved_at = now()
  where f.org_id = p_org and f.status = 'open' and f.last_seen < now() - interval '1 minute';

  select count(*) into v_open from finance_reconciliation_flags where org_id = p_org and status = 'open';
  return jsonb_build_object('open_flags', v_open);
end;
$$;

create or replace function finance_resolve_flag(p_org uuid, p_flag uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform fin_require(p_org, 'reconcile');
  update finance_reconciliation_flags
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_flag and org_id = p_org;
end;
$$;

-- ------------------------------------------------------------
-- 5. finance_transfer_begin — start a provider payout for an AUTHORIZED
--    withdrawal. Called ONLY by the finance-payout Edge Function
--    (service role) after it has checked the caller's capability; the
--    p_actor it passes is re-verified here.
-- ------------------------------------------------------------
create or replace function finance_transfer_begin(p_withdrawal uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w withdrawal_requests; cfg organization_finance_config; conn organization_finance_connections;
  acct member_payout_accounts; v_attempt int; v_key text; v_pay_id uuid;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  if not fin_capable_user(w.org_id, p_actor, 'initiate_payout') then
    raise exception 'finance: not permitted to initiate payouts';
  end if;
  if w.member_id = p_actor then
    raise exception 'finance: the requesting member cannot initiate their own payout';
  end if;
  if w.status not in ('authorized_for_payment','failed') then
    raise exception 'finance: withdrawal is not ready for payment';
  end if;

  select * into cfg from organization_finance_config where org_id = w.org_id;
  if not coalesce(cfg.automated_payout_enabled, false) then
    raise exception 'finance: automated payouts are not enabled for this office';
  end if;
  if cfg.finance_status <> 'active' then
    raise exception 'finance: finance is % for this office', cfg.finance_status;
  end if;

  select * into conn from organization_finance_connections
    where org_id = w.org_id and status <> 'suspended' order by created_at limit 1;
  if not coalesce((conn.capabilities->>'supports_transfers')::boolean, false) then
    raise exception 'finance: the office payment connection does not support transfers';
  end if;

  select * into acct from member_payout_accounts
    where id = w.payout_account_id and org_id = w.org_id and user_id = w.member_id;
  if acct.id is null then raise exception 'finance: no payout account on this request'; end if;
  if acct.provider_recipient_code is null then
    raise exception 'finance: payout account has no provider recipient yet';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
    from withdrawal_payments where withdrawal_id = w.id;
  v_key := w.org_id::text || ':' || w.id::text || ':' || v_attempt::text;

  insert into withdrawal_payments (org_id, withdrawal_id, attempt_number, execution_channel,
    provider, amount, currency, payment_method, transaction_reference, payment_date,
    idempotency_key, status, recorded_by)
  values (w.org_id, w.id, v_attempt, 'provider_transfer', conn.provider, w.amount, w.currency,
    'Provider transfer', v_key, now(), v_key, 'recorded', p_actor)
  returning id into v_pay_id;

  update withdrawal_requests set status = 'payment_recorded',
    payment_recorded_by = p_actor, payment_recorded_at = now(),
    active_payment_id = v_pay_id, failure_reason = null, updated_at = now()
  where id = w.id;

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (w.org_id, p_actor, w.member_id, 'payout_initiated', 'withdrawal', w.id,
    jsonb_build_object('attempt', v_attempt, 'reference', v_key, 'provider', conn.provider));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'idempotency_key', v_key, 'attempt_number', v_attempt,
    'recipient_code', acct.provider_recipient_code, 'amount', w.amount, 'currency', w.currency,
    'reference', v_key, 'provider', conn.provider);
end;
$$;

-- record the provider's acknowledgement of the initiate call
create or replace function finance_transfer_ack(p_payment uuid, p_provider_transfer_id text, p_provider_status text)
returns void language sql security definer set search_path = public as $$
  update withdrawal_payments
  set provider_transfer_id = nullif(p_provider_transfer_id,''), provider_status = nullif(p_provider_status,'')
  where id = p_payment;
$$;

-- ------------------------------------------------------------
-- 6. finance_transfer_settle — apply a terminal provider result.
--    Internal: called by finance-transfer-webhook (service role) only.
--    Idempotent on the payment row's status.
-- ------------------------------------------------------------
create or replace function finance_transfer_settle(
  p_payment uuid, p_result text, p_provider_transfer_id text default null,
  p_response_code text default null, p_detail text default null
) returns void language plpgsql security definer set search_path = public as $$
declare pay withdrawal_payments; w withdrawal_requests;
begin
  select * into pay from withdrawal_payments where id = p_payment for update;
  if not found then raise exception 'finance: payment attempt not found'; end if;
  select * into w from withdrawal_requests where id = pay.withdrawal_id for update;

  if pay.status in ('confirmed','failed','reversed') then
    return;  -- already terminal — idempotent no-op
  end if;

  if p_result = 'success' then
    update withdrawal_payments set provider_status = 'success',
      provider_transfer_id = coalesce(nullif(p_provider_transfer_id,''), provider_transfer_id),
      response_code = nullif(p_response_code,'')
    where id = pay.id;
    perform fin_finalize_withdrawal(w.id, pay.recorded_by);

  elsif p_result = 'failed' then
    update withdrawal_payments set status = 'failed', provider_status = 'failed',
      failure_reason = coalesce(nullif(p_detail,''), 'provider transfer failed'),
      failure_code = nullif(p_response_code,'')
    where id = pay.id;
    update withdrawal_requests set status = 'failed',
      failure_reason = coalesce(nullif(p_detail,''), 'provider transfer failed'),
      active_payment_id = null, updated_at = now()
    where id = w.id;
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, null, w.member_id, 'payout_failed', 'withdrawal', w.id,
      coalesce(nullif(p_detail,''), 'provider transfer failed'));

  elsif p_result = 'reversed' then
    update withdrawal_payments set status = 'reversed', provider_status = 'reversed',
      failure_reason = coalesce(nullif(p_detail,''), 'provider transfer reversed')
    where id = pay.id;
    -- if it had already been finalized as paid, hand the money back
    if w.status = 'paid' then
      insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance,
        withdrawal_id, created_by, note)
      values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, null,
        'Provider reversed the transfer — funds returned');
    end if;
    update withdrawal_requests set status = 'reversed', active_payment_id = null, updated_at = now()
    where id = w.id;
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, null, w.member_id, 'payout_reversed', 'withdrawal', w.id,
      coalesce(nullif(p_detail,''), 'provider transfer reversed'));
  else
    raise exception 'finance: unknown transfer result "%"', p_result;
  end if;
end;
$$;

-- store a freshly created provider recipient code on a member's account
create or replace function finance_set_recipient(p_account uuid, p_recipient_code text)
returns void language sql security definer set search_path = public as $$
  update member_payout_accounts
  set provider_recipient_code = nullif(p_recipient_code,''), status = 'verified', verified_at = now()
  where id = p_account;
$$;

-- ------------------------------------------------------------
-- 6b. finance_config_view — expose the new 'initiate_payout' capability
--     and whether automated payouts are actually available right now.
-- ------------------------------------------------------------
create or replace function finance_config_view(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conn organization_finance_connections;
begin
  if not is_org_member(p_org) then raise exception 'finance: not permitted'; end if;
  select * into v_conn from organization_finance_connections
    where org_id = p_org and status <> 'suspended' order by created_at limit 1;
  return (
    select to_jsonb(c) || jsonb_build_object(
      'connection', (select to_jsonb(v_conn) - 'metadata' - 'provider_account_reference'),
      'automation_available', (
        coalesce(c.automated_payout_enabled, false)
        and coalesce((v_conn.capabilities->>'supports_transfers')::boolean, false)
        and c.finance_status = 'active'),
      'viewer_capabilities', jsonb_build_object(
        'is_admin', has_org_role(p_org, array['admin']),
        'view', fin_can(p_org,'view'),
        'verify_settlement', fin_can(p_org,'verify_settlement'),
        'review', fin_can(p_org,'review'),
        'approve', fin_can(p_org,'approve'),
        'authorize', fin_can(p_org,'authorize'),
        'record_payment', fin_can(p_org,'record_payment'),
        'confirm_payment', fin_can(p_org,'confirm_payment'),
        'initiate_payout', fin_can(p_org,'initiate_payout'),
        'reconcile', fin_can(p_org,'reconcile')))
    from organization_finance_config c where c.org_id = p_org);
end;
$$;

grant execute on function finance_config_view(uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. GRANTS  — only the caller-facing helpers; the *_begin/_settle/_ack/
--    _set_recipient/_mark_webhook/_record_webhook functions are called by
--    Edge Functions with the service role and are NOT granted to
--    `authenticated` (defence in depth: the frontend cannot invoke them).
-- ------------------------------------------------------------
grant execute on function finance_reconcile_scan(uuid) to authenticated;
grant execute on function finance_resolve_flag(uuid, uuid) to authenticated;

-- Edge-function-only surface: callable with the service role, never the
-- browser. (Explicit so a default PUBLIC execute grant can't widen these.)
revoke execute on function finance_transfer_begin(uuid, uuid) from public;
revoke execute on function finance_transfer_ack(uuid, text, text) from public;
revoke execute on function finance_transfer_settle(uuid, text, text, text, text) from public;
revoke execute on function finance_set_recipient(uuid, text) from public;
revoke execute on function finance_record_webhook_event(text, text, text, text) from public;
revoke execute on function finance_mark_webhook_event(text, text, text) from public;
grant execute on function finance_transfer_begin(uuid, uuid) to service_role;
grant execute on function finance_transfer_ack(uuid, text, text) to service_role;
grant execute on function finance_transfer_settle(uuid, text, text, text, text) to service_role;
grant execute on function finance_set_recipient(uuid, text) to service_role;
grant execute on function finance_record_webhook_event(text, text, text, text) to service_role;
grant execute on function finance_mark_webhook_event(text, text, text) to service_role;
