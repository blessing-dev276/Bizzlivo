-- ============================================================
-- 0077 — Finance: payout SLA alerts, mandatory external reconciliation,
--        and configurable auto-reversal
-- ============================================================
-- Builds on 0072/0073. Nothing here changes how money is stored or
-- weakens the non-custodial model — it only adds time-based safety
-- rails around a withdrawal that is mid-payment:
--
--   1. payout_sla_hours          — a withdrawal stuck in
--      authorized_for_payment / payment_recorded past this many hours
--      raises a reconciliation flag and notifies the member (once).
--   2. require_external_reconciliation — when on (default), an
--      office-operated payment can NEVER auto-finalise to PAID; a
--      different capable user must confirm it, even if
--      require_payment_confirmation is off.
--   3. auto_reversal_hours       — opt-in (null = off). An automated
--      provider transfer that is not confirmed by webhook within this
--      window auto-transitions to FAILED and the reservation is
--      released back to the member's available balance.
--
-- The sweep (finance_sla_sweep) runs from pg_cron every 15 minutes.
-- ============================================================

alter table organization_finance_config
  add column if not exists payout_sla_hours               int
    not null default 24 check (payout_sla_hours between 1 and 720),
  add column if not exists require_external_reconciliation boolean
    not null default true,
  add column if not exists auto_reversal_hours            int
    check (auto_reversal_hours is null or auto_reversal_hours between 1 and 720);

-- ------------------------------------------------------------
-- finance_update_config — allow the three new keys through
-- ------------------------------------------------------------
create or replace function finance_update_config(p_org uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare before_row organization_finance_config;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'finance: office admin required'; end if;
  select * into before_row from organization_finance_config where org_id = p_org;
  if before_row.org_id is null then
    insert into organization_finance_config (org_id) values (p_org);
    select * into before_row from organization_finance_config where org_id = p_org;
  end if;

  update organization_finance_config set
    finance_enabled              = coalesce((p_patch->>'finance_enabled')::boolean, finance_enabled),
    finance_status               = coalesce(p_patch->>'finance_status', finance_status),
    finance_status_reason        = coalesce(p_patch->>'finance_status_reason', finance_status_reason),
    base_currency                = coalesce(nullif(p_patch->>'base_currency',''), base_currency),
    manual_payout_enabled        = coalesce((p_patch->>'manual_payout_enabled')::boolean, manual_payout_enabled),
    automated_payout_enabled     = coalesce((p_patch->>'automated_payout_enabled')::boolean, automated_payout_enabled),
    withdrawals_paused           = coalesce((p_patch->>'withdrawals_paused')::boolean, withdrawals_paused),
    minimum_withdrawal_amount    = coalesce((p_patch->>'minimum_withdrawal_amount')::numeric, minimum_withdrawal_amount),
    maximum_withdrawal_amount    = case when p_patch ? 'maximum_withdrawal_amount'
                                     then nullif(p_patch->>'maximum_withdrawal_amount','')::numeric
                                     else maximum_withdrawal_amount end,
    daily_payout_limit           = case when p_patch ? 'daily_payout_limit'
                                     then nullif(p_patch->>'daily_payout_limit','')::numeric
                                     else daily_payout_limit end,
    second_approval_enabled      = coalesce((p_patch->>'second_approval_enabled')::boolean, second_approval_enabled),
    second_approval_threshold    = case when p_patch ? 'second_approval_threshold'
                                     then nullif(p_patch->>'second_approval_threshold','')::numeric
                                     else second_approval_threshold end,
    require_payment_confirmation  = coalesce((p_patch->>'require_payment_confirmation')::boolean, require_payment_confirmation),
    enforce_separation_of_duties = coalesce((p_patch->>'enforce_separation_of_duties')::boolean, enforce_separation_of_duties),
    allow_member_cancel          = coalesce((p_patch->>'allow_member_cancel')::boolean, allow_member_cancel),
    payout_sla_hours             = coalesce((p_patch->>'payout_sla_hours')::int, payout_sla_hours),
    require_external_reconciliation = coalesce((p_patch->>'require_external_reconciliation')::boolean, require_external_reconciliation),
    auto_reversal_hours          = case when p_patch ? 'auto_reversal_hours'
                                     then nullif(p_patch->>'auto_reversal_hours','')::int
                                     else auto_reversal_hours end,
    updated_by = auth.uid(), updated_at = now()
  where org_id = p_org;

  insert into finance_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org, auth.uid(), 'finance_config_changed', 'finance_config', p_org,
    to_jsonb(before_row) - 'updated_by' - 'updated_at' - 'created_at',
    (select to_jsonb(c) - 'updated_by' - 'updated_at' - 'created_at'
     from organization_finance_config c where c.org_id = p_org));
end;
$$;

-- ------------------------------------------------------------
-- Guard: a withdrawal whose reservation has already been released
-- (net affects_balance ledger for it is no longer negative) must never
-- accept another payment attempt — the member has to request anew.
-- ------------------------------------------------------------
create or replace function _fin_reservation_live(p_withdrawal uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0) < 0
  from finance_ledger
  where withdrawal_id = p_withdrawal and affects_balance;
$$;

-- ------------------------------------------------------------
-- finance_record_withdrawal_payment — external payments never
-- auto-finalise when require_external_reconciliation is on, and a
-- released withdrawal cannot be re-paid.
-- ------------------------------------------------------------
create or replace function finance_record_withdrawal_payment(
  p_withdrawal uuid, p_channel text, p_method text, p_reference text,
  p_payment_date timestamptz default now(), p_bank_or_provider text default null,
  p_proof_url text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; cfg organization_finance_config; v_uid uuid := auth.uid();
        v_attempt int; v_pay_id uuid; v_key text; v_external boolean;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'record_payment');
  if w.status not in ('authorized_for_payment','failed') then
    raise exception 'finance: withdrawal is not ready for payment';
  end if;
  if not _fin_reservation_live(w.id) then
    raise exception 'finance: this withdrawal was returned to the member — they must request a new withdrawal';
  end if;
  if w.member_id = v_uid then
    raise exception 'finance: the requesting member cannot record their own payment';
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'finance: a transaction reference is required';
  end if;
  if coalesce(p_channel,'') not in ('office_bank_transfer','provider_transfer','other') then
    raise exception 'finance: invalid payment channel';
  end if;
  select * into cfg from organization_finance_config where org_id = w.org_id;
  v_external := p_channel in ('office_bank_transfer','other');

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
    from withdrawal_payments where withdrawal_id = w.id;
  v_key := w.org_id::text || ':' || w.id::text || ':' || v_attempt::text;

  insert into withdrawal_payments (org_id, withdrawal_id, attempt_number, execution_channel,
    amount, currency, payment_method, bank_or_provider, transaction_reference, payment_date,
    proof_url, internal_note, idempotency_key, recorded_by)
  values (w.org_id, w.id, v_attempt, p_channel, w.amount, w.currency, nullif(p_method,''),
    nullif(p_bank_or_provider,''), btrim(p_reference), coalesce(p_payment_date, now()),
    nullif(p_proof_url,''), nullif(p_note,''), v_key, v_uid)
  returning id into v_pay_id;

  update withdrawal_requests set status = 'payment_recorded',
    payment_recorded_by = v_uid, payment_recorded_at = now(),
    active_payment_id = v_pay_id, failure_reason = null, updated_at = now()
  where id = w.id;

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (w.org_id, v_uid, w.member_id, 'withdrawal_payment_recorded', 'withdrawal', w.id,
    jsonb_build_object('attempt', v_attempt, 'channel', p_channel, 'reference', btrim(p_reference),
      'method', nullif(p_method,'')));

  -- Finalise now only when the office requires no second confirmation AND
  -- this is not an external payment under mandatory reconciliation.
  if not coalesce(cfg.require_payment_confirmation, true)
     and not (v_external and coalesce(cfg.require_external_reconciliation, true)) then
    perform fin_finalize_withdrawal(w.id, v_uid);
  end if;
  return v_pay_id;
end;
$$;

-- ------------------------------------------------------------
-- finance_transfer_begin — also refuse a released withdrawal
-- (service-role only; re-add the same grant/revoke as 0073)
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
  if not _fin_reservation_live(w.id) then
    raise exception 'finance: this withdrawal was returned to the member — they must request a new withdrawal';
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
revoke execute on function finance_transfer_begin(uuid, uuid) from public;
grant  execute on function finance_transfer_begin(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- finance_sla_sweep — system job (pg_cron). Never trusts a caller;
-- iterates every finance-enabled org.
-- ------------------------------------------------------------
create or replace function finance_sla_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o record; w record;
  v_flags int := 0; v_reversed int := 0;
begin
  for o in
    select org_id,
           coalesce(payout_sla_hours, 24) as sla,
           auto_reversal_hours as ar
    from organization_finance_config
    where finance_enabled
  loop
    for w in
      select wr.id, wr.reference, wr.member_id, wr.amount, wr.currency, wr.status,
             wr.active_payment_id, wr.authorized_at, wr.payment_recorded_at, wr.updated_at,
             coalesce(wr.payment_recorded_at, wr.authorized_at, wr.updated_at) as since
      from withdrawal_requests wr
      where wr.org_id = o.org_id
        and wr.status in ('authorized_for_payment','payment_recorded')
      for update
    loop
      -- 1. SLA breach ------------------------------------------------
      if now() - w.since > make_interval(hours => o.sla) then
        insert into finance_reconciliation_flags (org_id, kind, entity_type, entity_id, detail)
        values (o.org_id, 'payout_sla_breach', 'withdrawal', w.id,
          coalesce(w.reference, 'withdrawal') || ' has been in ' || w.status
            || ' for over ' || o.sla || 'h')
        on conflict (org_id, kind, entity_id) do update
          set last_seen = now(), status = 'open', detail = excluded.detail,
              resolved_by = null, resolved_at = null;
        v_flags := v_flags + 1;

        perform notify(o.org_id, w.member_id, 'finance', 'withdrawal_sla_breach',
          'Your withdrawal ' || coalesce(w.reference, '')
            || ' is taking longer than usual. The office has been alerted and the amount stays reserved for you.',
          '/wallet', 'wd-sla:' || w.id::text);

        insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
        select o.org_id, null, w.member_id, 'withdrawal_sla_breach', 'withdrawal', w.id,
               jsonb_build_object('sla_hours', o.sla, 'status', w.status)
        where not exists (
          select 1 from finance_events fe
          where fe.entity_id = w.id and fe.action = 'withdrawal_sla_breach');
      end if;

      -- 2. auto-reversal (opt-in; automated provider transfers only) --
      if o.ar is not null
         and w.status = 'payment_recorded'
         and now() - coalesce(w.payment_recorded_at, w.updated_at) > make_interval(hours => o.ar)
         and exists (
           select 1 from withdrawal_payments p
           where p.id = w.active_payment_id
             and p.execution_channel = 'provider_transfer'
             and p.status = 'recorded')
      then
        update withdrawal_payments set
          status = 'failed',
          failure_code = 'auto_reversal_timeout',
          failure_reason = 'Auto-reversal: provider transfer not confirmed within ' || o.ar || 'h'
        where id = w.active_payment_id and status = 'recorded';

        insert into finance_ledger (org_id, member_id, entry_type, amount, currency,
          affects_balance, withdrawal_id, created_by, note)
        values (o.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency,
          true, w.id, null,
          'Auto-reversal — provider transfer unconfirmed after ' || o.ar || 'h, funds returned');

        update withdrawal_requests set
          status = 'failed', active_payment_id = null,
          failure_reason = 'Auto-reversal: provider transfer not confirmed within ' || o.ar || 'h',
          updated_at = now()
        where id = w.id;

        insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
        values (o.org_id, null, w.member_id, 'withdrawal_auto_reversed', 'withdrawal', w.id,
          'provider transfer unconfirmed after ' || o.ar || 'h — reservation released');

        perform notify(o.org_id, w.member_id, 'finance', 'withdrawal_auto_reversed',
          'Your withdrawal ' || coalesce(w.reference, '')
            || ' could not be confirmed in time. The amount has been returned to your available balance — you can request it again.',
          '/wallet', 'wd-autorev:' || w.id::text);

        insert into finance_reconciliation_flags (org_id, kind, entity_type, entity_id, detail)
        values (o.org_id, 'auto_reversed_payout', 'withdrawal', w.id,
          coalesce(w.reference, 'withdrawal') || ' auto-reversed after ' || o.ar || 'h with no provider confirmation')
        on conflict (org_id, kind, entity_id) do update
          set last_seen = now(), status = 'open', resolved_by = null, resolved_at = null;

        v_reversed := v_reversed + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('sla_flags', v_flags, 'auto_reversed', v_reversed);
end;
$$;

revoke execute on function finance_sla_sweep() from public;
grant  execute on function finance_sla_sweep() to service_role;

-- ------------------------------------------------------------
-- finance_org_overview — surface SLA breaches in "needs attention"
-- ------------------------------------------------------------
create or replace function finance_org_overview(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform fin_require(p_org, 'view');
  return jsonb_build_object(
    'orders_in_period', (select count(*) from finance_orders where org_id = p_org and created_at >= p_start and created_at < p_end),
    'gross_by_currency', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(gross_amount) amt from finance_orders
            where org_id = p_org and status <> 'cancelled' and created_at >= p_start and created_at < p_end
            group by currency) s),
    'pending_platform', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(gross_amount) amt from finance_orders
            where org_id = p_org and status in ('order_received','pending_settlement') group by currency) s),
    'member_wallet_liability', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from finance_ledger
            where org_id = p_org and affects_balance = true group by currency having sum(amount) <> 0) s),
    'available_member_funds', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from finance_ledger
            where org_id = p_org and affects_balance = true group by currency having sum(amount) <> 0) s),
    'pending_withdrawals_count', (select count(*) from withdrawal_requests
       where org_id = p_org and status in ('requested','under_review')),
    'processing_payouts_count', (select count(*) from withdrawal_requests
       where org_id = p_org and status in ('approved','authorized_for_payment','payment_recorded')),
    'paid_in_period', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount_paid) amt from finance_payouts
            where org_id = p_org and created_at >= p_start and created_at < p_end group by currency) s),
    'failed_payouts_count', (select count(*) from withdrawal_requests where org_id = p_org and status = 'failed'),
    'needs_attention', jsonb_build_object(
      'awaiting_settlement', (select count(*) from finance_orders where org_id = p_org and status in ('order_received','pending_settlement')),
      'settled_not_credited', (select count(*) from finance_orders where org_id = p_org and status = 'settled' and credited_at is null),
      'withdrawals_awaiting_approval', (select count(*) from withdrawal_requests where org_id = p_org and status in ('requested','under_review')),
      'withdrawals_awaiting_authorization', (select count(*) from withdrawal_requests where org_id = p_org and status = 'approved'),
      'withdrawals_awaiting_payment', (select count(*) from withdrawal_requests where org_id = p_org and status = 'authorized_for_payment'),
      'withdrawals_awaiting_confirmation', (select count(*) from withdrawal_requests where org_id = p_org and status = 'payment_recorded'),
      'withdrawals_failed', (select count(*) from withdrawal_requests where org_id = p_org and status = 'failed'),
      'payout_sla_breaches', (select count(*) from finance_reconciliation_flags
        where org_id = p_org and status = 'open' and kind in ('payout_sla_breach','stuck_in_payment')),
      'missing_conversion', (select count(*) from finance_orders where org_id = p_org and status = 'settled'
        and credited_at is null and converted = false and settlement_currency is distinct from
        (select base_currency from organizations where id = p_org)))
  );
end;
$$;

grant execute on function finance_org_overview(uuid, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- Schedule the sweep every 15 minutes (pure SQL — no edge function).
-- ------------------------------------------------------------
do $$
begin
  perform cron.unschedule('finance-sla-sweep');
exception when others then null;
end $$;

select cron.schedule('finance-sla-sweep', '*/15 * * * *', $$ select public.finance_sla_sweep(); $$);
