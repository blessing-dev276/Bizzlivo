-- ============================================================
-- 0065 — FINANCE PHASE 1  (Decisions A3 · B · C · D · E)
--
-- Bizzlivo stays the software CONTROL / ACCOUNTING / AUTHORIZATION
-- layer. It never holds customer funds and never moves money in this
-- phase. The office pays each approved withdrawal from its own
-- financial account and records the reference here; Bizzlivo runs the
-- ledger, the approval workflow, separation of duties, reconciliation,
-- audit and notifications.
--
-- ONE finance workflow, pluggable execution:
--   settlement -> wallet ledger -> withdrawal -> approval
--     -> AUTHORIZED_FOR_PAYMENT
--     -> [Phase 1] office executes payment + records reference + confirm
--     -> [Phase 2] provider adapter transfer + webhook confirm
--   ...both finish at PAID with a payout_debit ledger row.
--
-- Nothing in 0043 is dropped. This migration is additive:
--   * organization_finance_config      — per-office finance settings + policy
--   * organization_finance_connections — Phase-2-ready provider connection
--   * org_finance_grants               — org-scoped finance permissions (Decision C)
--   * withdrawal_payments              — structured payment-execution record
--   * withdrawal_requests              — extended state machine + approval columns
--   * member_payout_accounts           — provider / masking columns
--   * finance_ledger.entry_type        — + payout_debit / adjustment_* / reversal
--
-- Decision D: amounts stay numeric(14,2) (exact). exchange_rate stays
-- numeric(18,6) (0043). Minor-unit conversion happens only at the
-- provider boundary, in application code, in Phase 2.
-- ============================================================

-- ------------------------------------------------------------
-- 1. organization_finance_config  (Decision E — editable seed defaults)
-- ------------------------------------------------------------
create table organization_finance_config (
  org_id                        uuid primary key references organizations(id) on delete cascade,
  finance_enabled               boolean not null default false,
  finance_status                text not null default 'active'
                                  check (finance_status in ('active','restricted','suspended')),
  finance_status_reason         text,
  base_currency                 text not null default 'NGN',
  manual_payout_enabled         boolean not null default true,
  automated_payout_enabled      boolean not null default false,   -- gated by provider capability (Decision B)
  withdrawals_paused            boolean not null default false,
  -- policy (illustrative defaults — every office admin can change these)
  minimum_withdrawal_amount     numeric(14,2) not null default 5000    check (minimum_withdrawal_amount >= 0),
  maximum_withdrawal_amount     numeric(14,2)                          check (maximum_withdrawal_amount is null or maximum_withdrawal_amount > 0),
  daily_payout_limit            numeric(14,2)                          check (daily_payout_limit is null or daily_payout_limit > 0),
  second_approval_enabled       boolean not null default false,
  second_approval_threshold     numeric(14,2)                          check (second_approval_threshold is null or second_approval_threshold >= 0),
  require_payment_confirmation   boolean not null default true,
  enforce_separation_of_duties  boolean not null default true,
  allow_member_cancel           boolean not null default true,
  updated_by                    uuid references profiles(id),
  updated_at                    timestamptz not null default now(),
  created_at                    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. organization_finance_connections  (A2-ready; A1 impossible here)
--    NO provider secrets are ever stored in this table.
-- ------------------------------------------------------------
create table organization_finance_connections (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  provider                  text not null default 'paystack',
  connection_type           text not null default 'external_manual'
                              check (connection_type in
                                ('external_manual','connected_merchant','provider_subaccount','other')),
  provider_account_reference text,                       -- opaque, non-secret handle
  settlement_account_name   text,
  settlement_bank_name      text,
  settlement_masked_number  text,                        -- '••••4821'
  currency                  text not null default 'NGN',
  status                    text not null default 'active'
                              check (status in
                                ('not_connected','pending_verification','active','restricted','suspended')),
  capabilities              jsonb not null default '{}'::jsonb,   -- provider capability flags (Decision B)
  connected_by              uuid references profiles(id),
  verified_at               timestamptz,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index org_finance_connections_one_live
  on organization_finance_connections(org_id) where status <> 'suspended';

-- ------------------------------------------------------------
-- 3. org_finance_grants  (Decision C — no fifth global role)
--    Office Admins get every capability implicitly (see fin_capable_user).
-- ------------------------------------------------------------
create table org_finance_grants (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  user_id                   uuid not null references profiles(id) on delete cascade,
  can_view_finance          boolean not null default true,
  can_verify_settlement     boolean not null default false,
  can_review_withdrawal     boolean not null default false,
  can_approve_withdrawal    boolean not null default false,
  can_authorize_payment     boolean not null default false,
  can_record_payment        boolean not null default false,
  can_confirm_payment       boolean not null default false,
  can_manage_reconciliation boolean not null default false,
  approval_limit_amount     numeric(14,2) check (approval_limit_amount is null or approval_limit_amount >= 0),
  granted_by                uuid references profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (org_id, user_id)
);
create index org_finance_grants_user_idx on org_finance_grants(user_id);

-- ------------------------------------------------------------
-- 4. withdrawal_payments — structured payment-execution record.
--    Phase 1: execution_channel = 'office_bank_transfer' / 'other'.
--    Phase 2: 'provider_transfer' rows carry provider_* fields.
--    Never overwritten; one row per attempt; one active row at a time.
-- ------------------------------------------------------------
create table withdrawal_payments (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  withdrawal_id          uuid not null references withdrawal_requests(id) on delete cascade,
  attempt_number         int  not null default 1,
  execution_channel      text not null default 'office_bank_transfer'
                           check (execution_channel in
                             ('office_bank_transfer','provider_transfer','other')),
  provider               text,
  amount                 numeric(14,2) not null check (amount >= 0),
  currency               text not null,
  payment_method         text,
  bank_or_provider       text,
  transaction_reference  text not null,
  payment_date           timestamptz not null,
  proof_url              text,
  internal_note          text,
  idempotency_key        text not null,          -- org:withdrawal:attempt
  status                 text not null default 'recorded'
                           check (status in ('recorded','confirmed','failed','reversed')),
  recorded_by            uuid not null references profiles(id),
  confirmed_by           uuid references profiles(id),
  confirmed_at           timestamptz,
  failure_reason         text,
  provider_reference     text,                   -- Phase 2
  provider_payload       jsonb,                  -- Phase 2 (scrubbed — no PAN, no secrets)
  created_at             timestamptz not null default now(),
  unique (withdrawal_id, attempt_number),
  unique (idempotency_key)
);
create unique index withdrawal_payments_one_active
  on withdrawal_payments(withdrawal_id) where status in ('recorded','confirmed');
create index withdrawal_payments_wd_idx on withdrawal_payments(withdrawal_id);

-- ------------------------------------------------------------
-- 5. withdrawal_requests — extended state machine + approval trail
-- ------------------------------------------------------------
alter table withdrawal_requests
  add column approvals_required   int not null default 1,
  add column approvals_count      int not null default 0,
  add column first_approver_id    uuid references profiles(id),
  add column first_approved_at    timestamptz,
  add column second_approver_id   uuid references profiles(id),
  add column second_approved_at   timestamptz,
  add column authorized_by        uuid references profiles(id),
  add column authorized_at        timestamptz,
  add column payment_recorded_by  uuid references profiles(id),
  add column payment_recorded_at  timestamptz,
  add column confirmed_by         uuid references profiles(id),
  add column confirmed_at         timestamptz,
  add column paid_at              timestamptz,
  add column failure_reason       text,
  add column active_payment_id    uuid references withdrawal_payments(id);

-- map the old lean state set onto the new one before swapping the check
update withdrawal_requests set status = 'authorized_for_payment' where status = 'processing';

alter table withdrawal_requests drop constraint withdrawal_requests_status_check;
alter table withdrawal_requests add constraint withdrawal_requests_status_check
  check (status in (
    'requested','under_review','approved','authorized_for_payment',
    'payment_recorded','paid','rejected','cancelled','failed','reversed'));

-- ------------------------------------------------------------
-- 6. finance_ledger — new entry types (payout_debit / adjustments / reversal)
-- ------------------------------------------------------------
alter table finance_ledger drop constraint finance_ledger_entry_type_check;
alter table finance_ledger add constraint finance_ledger_entry_type_check
  check (entry_type in (
    'order_recorded','settlement','conversion','charge','charge_reversal',
    'available_credit','withdrawal_reserve','withdrawal_release',
    'payout','adjustment',                    -- legacy (kept)
    'payout_debit','adjustment_credit','adjustment_debit','reversal'));

-- ------------------------------------------------------------
-- 7. member_payout_accounts — provider / masking columns
-- ------------------------------------------------------------
alter table member_payout_accounts
  add column provider               text not null default 'paystack',
  add column bank_code              text,
  add column masked_account_number  text,
  add column provider_recipient_code text,
  add column status                 text not null default 'unverified'
                                      check (status in ('unverified','verified','failed','disabled')),
  add column verified_at            timestamptz;

update member_payout_accounts
set masked_account_number = '••••' || right(account_number, 4)
where account_number is not null and length(account_number) >= 4;

-- ============================================================
-- 8. PERMISSION HELPERS  (Decision C — server-side, org-scoped)
--    Defined before RLS so policies can reference fin_can().
-- ============================================================

-- True when a specific user holds a finance capability in an org.
-- Office Admins hold every capability implicitly.
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
          when 'reconcile'         then g.can_manage_reconciliation
          else false
        end);
$$;

create or replace function fin_can(p_org uuid, p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select fin_capable_user(p_org, auth.uid(), p_cap);
$$;

create or replace function fin_require(p_org uuid, p_cap text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not fin_capable_user(p_org, auth.uid(), p_cap) then
    raise exception 'finance: you do not have permission to % here', p_cap;
  end if;
end;
$$;

-- Does anyone OTHER than p_exclude hold p_cap in this org? Drives the
-- self-approval / separation-of-duties rules: enforced only when a
-- second eligible person actually exists (small offices aren't blocked).
create or replace function fin_other_capable_exists(p_org uuid, p_exclude uuid, p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.status = 'active' and m.user_id <> p_exclude
      and fin_capable_user(p_org, m.user_id, p_cap));
$$;

-- ============================================================
-- 9. DATA MIGRATION — seed config + connection for every existing org
-- ============================================================
insert into organization_finance_config (
  org_id, finance_enabled, base_currency, minimum_withdrawal_amount, allow_member_cancel
)
select o.id,
       (exists (select 1 from finance_orders fo where fo.org_id = o.id)
        or exists (select 1 from withdrawal_requests wr where wr.org_id = o.id)),
       coalesce(o.base_currency, 'NGN'),
       coalesce(o.min_withdrawal_amount, 5000),
       coalesce(o.allow_member_cancel_withdrawal, true)
from organizations o
on conflict (org_id) do nothing;

insert into organization_finance_connections (
  org_id, provider, connection_type, status, currency, capabilities
)
select o.id, 'paystack', 'external_manual', 'active',
       coalesce(o.base_currency, 'NGN'),
       -- only bank-name resolution is confirmed today (resolve-bank-account)
       jsonb_build_object(
         'supports_bank_resolution', true,
         'supports_transfer_recipients', false,
         'supports_transfers', false,
         'supports_subaccounts', false,
         'supports_splits', false,
         'supports_virtual_accounts', false,
         'supports_balance_lookup', false,
         'supports_connected_merchants', false,
         'supports_webhooks', false)
from organizations o
on conflict do nothing;

-- ============================================================
-- 10. RLS  — reads only from the client; all writes via the RPCs below
-- ============================================================
alter table organization_finance_config      enable row level security;
alter table organization_finance_connections enable row level security;
alter table org_finance_grants               enable row level security;
alter table withdrawal_payments              enable row level security;

create policy "finance config: org members read"
  on organization_finance_config for select using (is_org_member(org_id));

create policy "finance connection: finance viewers read"
  on organization_finance_connections for select
  using (has_org_role(org_id, array['admin']));

create policy "finance grants: self or admin read"
  on org_finance_grants for select
  using (user_id = auth.uid() or has_org_role(org_id, array['admin']));

create policy "withdrawal payments: member self or finance viewer"
  on withdrawal_payments for select
  using (
    exists (select 1 from withdrawal_requests w
            where w.id = withdrawal_id and w.member_id = auth.uid())
    or has_org_role(org_id, array['admin'])
    or exists (select 1 from org_finance_grants g
               where g.org_id = withdrawal_payments.org_id and g.user_id = auth.uid()
                 and g.can_view_finance)
  );

-- Non-admin Finance grant-holders also need to read the 0043 finance tables.
-- The new predicate is a superset of the old admin-only one.
alter policy "finance_orders: member self or admin" on finance_orders
  using (member_id = auth.uid() or fin_can(org_id, 'view'));
alter policy "finance_charges: member self or admin" on finance_charges
  using (member_id = auth.uid() or fin_can(org_id, 'view'));
alter policy "withdrawal_requests: member self or admin" on withdrawal_requests
  using (member_id = auth.uid() or fin_can(org_id, 'view'));
alter policy "finance_ledger: member self or admin" on finance_ledger
  using (member_id = auth.uid() or fin_can(org_id, 'view'));
alter policy "finance_payouts: member self or admin" on finance_payouts
  using (member_id = auth.uid() or fin_can(org_id, 'view'));
alter policy "finance_events: member self or admin" on finance_events
  using (member_id = auth.uid() or fin_can(org_id, 'view'));
alter policy "payout accounts: admin reads for payout ops" on member_payout_accounts
  using (fin_can(org_id, 'view'));

-- ============================================================
-- 11. INTERNAL — finalize a withdrawal to PAID (shared by manual + provider)
-- ============================================================
create or replace function fin_finalize_withdrawal(p_withdrawal uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; pay withdrawal_payments;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  if w.status = 'paid' then return; end if;   -- idempotent

  select * into pay from withdrawal_payments where id = w.active_payment_id for update;
  if not found then raise exception 'finance: no payment record to finalize'; end if;

  update withdrawal_payments
    set status = 'confirmed', confirmed_by = p_actor, confirmed_at = now()
    where id = pay.id and status <> 'confirmed';

  -- one finalized payout record per withdrawal (0043 table; feeds balances)
  insert into finance_payouts (org_id, member_id, withdrawal_id, amount_paid, currency,
    paid_on, method, reference, proof_url, admin_note, recorded_by)
  values (w.org_id, w.member_id, w.id, pay.amount, pay.currency,
    coalesce(pay.payment_date::date, current_date), pay.payment_method,
    pay.transaction_reference, pay.proof_url, pay.internal_note, p_actor)
  on conflict (withdrawal_id) do nothing;

  -- record-only ledger row: the reserve already removed the funds from Available
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency,
    affects_balance, withdrawal_id, created_by, note)
  values (w.org_id, w.member_id, 'payout_debit', -pay.amount, pay.currency,
    false, w.id, p_actor, 'Payout completed · ' || pay.transaction_reference);

  update withdrawal_requests set status = 'paid', paid_at = now(), updated_at = now()
  where id = w.id;

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (w.org_id, p_actor, w.member_id, 'withdrawal_paid', 'withdrawal', w.id,
    jsonb_build_object('amount', pay.amount, 'currency', pay.currency,
      'reference', pay.transaction_reference, 'channel', pay.execution_channel));
end;
$$;

-- ============================================================
-- 12. WITHDRAWAL RPCs
-- ============================================================

-- ---- request (evolves 0043) --------------------------------
create or replace function finance_request_withdrawal(
  p_org uuid, p_amount numeric, p_currency text,
  p_method text default null, p_account_id uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); cfg organization_finance_config;
  v_avail numeric; v_id uuid; v_ref text; v_snap jsonb; v_ccy text;
  v_today_total numeric; v_needs int;
begin
  if v_uid is null then raise exception 'finance: not authenticated'; end if;
  if not is_org_member(p_org) then raise exception 'finance: not a member of this office'; end if;
  v_ccy := upper(p_currency);
  perform pg_advisory_xact_lock(hashtext(p_org::text || ':' || v_uid::text));

  select * into cfg from organization_finance_config where org_id = p_org;
  if cfg.org_id is null then raise exception 'finance: finance is not configured for this office'; end if;
  if not cfg.finance_enabled then raise exception 'finance: finance is not enabled for this office'; end if;
  if cfg.finance_status = 'suspended' then raise exception 'finance: finance is suspended for this office'; end if;
  if cfg.withdrawals_paused then raise exception 'finance: withdrawals are paused for this office'; end if;

  if p_amount is null or p_amount <= 0 then raise exception 'finance: amount must be > 0'; end if;
  if p_amount < coalesce(cfg.minimum_withdrawal_amount, 0) then
    raise exception 'finance: below the minimum withdrawal of %', cfg.minimum_withdrawal_amount;
  end if;
  if v_ccy = upper(cfg.base_currency) then
    if cfg.maximum_withdrawal_amount is not null and p_amount > cfg.maximum_withdrawal_amount then
      raise exception 'finance: above the per-request limit of %', cfg.maximum_withdrawal_amount;
    end if;
    if cfg.daily_payout_limit is not null then
      select coalesce(sum(amount), 0) into v_today_total
      from withdrawal_requests
      where org_id = p_org and currency = v_ccy
        and created_at >= date_trunc('day', now())
        and status not in ('rejected','cancelled','failed','reversed');
      if v_today_total + p_amount > cfg.daily_payout_limit then
        raise exception 'finance: this would exceed the office daily payout limit of %', cfg.daily_payout_limit;
      end if;
    end if;
  end if;

  v_avail := fin_available(p_org, v_uid, v_ccy);
  if p_amount > v_avail then
    raise exception 'finance: requested % exceeds available % %', p_amount, v_avail, v_ccy;
  end if;

  if p_account_id is not null then
    select jsonb_build_object('bank_name', bank_name, 'account_name', account_name,
             'account_number', account_number, 'masked_account_number', masked_account_number,
             'bank_code', bank_code)
      into v_snap from member_payout_accounts
      where id = p_account_id and user_id = v_uid and org_id = p_org;
  end if;

  v_needs := case when cfg.second_approval_enabled
                   and cfg.second_approval_threshold is not null
                   and v_ccy = upper(cfg.base_currency)
                   and p_amount >= cfg.second_approval_threshold
              then 2 else 1 end;

  v_ref := fin_next_ref('WD');
  insert into withdrawal_requests (org_id, member_id, reference, amount, currency, method,
    payout_account_id, payout_snapshot, member_note, status, available_before, approvals_required)
  values (p_org, v_uid, v_ref, p_amount, v_ccy, nullif(p_method,''),
    p_account_id, v_snap, nullif(p_note,''), 'requested', v_avail, v_needs)
  returning id into v_id;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance,
    withdrawal_id, created_by, note)
  values (p_org, v_uid, 'withdrawal_reserve', -p_amount, v_ccy, true, v_id, v_uid, 'Reserved for ' || v_ref);

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (p_org, v_uid, v_uid, 'withdrawal_requested', 'withdrawal', v_id,
    jsonb_build_object('reference', v_ref, 'amount', p_amount, 'currency', v_ccy,
      'available_before', v_avail, 'approvals_required', v_needs));
  return v_id;
end;
$$;

-- ---- review: approve / reject (evolves 0043) --------------
create or replace function finance_review_withdrawal(
  p_withdrawal uuid, p_decision text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; cfg organization_finance_config; v_uid uuid := auth.uid();
        v_limit numeric; v_new_count int; v_final boolean;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'approve');
  if w.status not in ('requested','under_review') then
    raise exception 'finance: withdrawal is not awaiting approval';
  end if;
  select * into cfg from organization_finance_config where org_id = w.org_id;

  -- a member can never approve their own withdrawal while another approver exists
  if w.member_id = v_uid and fin_other_capable_exists(w.org_id, v_uid, 'approve') then
    raise exception 'finance: you cannot approve your own withdrawal — another authorized approver must review it';
  end if;
  -- the same person can't cast both required approvals when a second approver exists
  if w.first_approver_id = v_uid
     and coalesce(cfg.enforce_separation_of_duties, true)
     and fin_other_capable_exists(w.org_id, v_uid, 'approve') then
    raise exception 'finance: a different person must give the second approval';
  end if;
  -- respect a grant-holder's per-approval ceiling
  select approval_limit_amount into v_limit from org_finance_grants
    where org_id = w.org_id and user_id = v_uid;
  if v_limit is not null and w.amount > v_limit then
    raise exception 'finance: this amount is above your approval limit of %', v_limit;
  end if;

  if p_decision = 'approve' then
    v_new_count := w.approvals_count + 1;
    v_final := v_new_count >= w.approvals_required;
    if w.approvals_count = 0 then
      update withdrawal_requests set
        approvals_count = v_new_count,
        first_approver_id = v_uid, first_approved_at = now(),
        reviewed_by = v_uid, reviewed_at = now(), admin_note = nullif(p_note,''),
        status = case when v_final then 'approved' else 'under_review' end,
        updated_at = now()
      where id = w.id;
    else
      update withdrawal_requests set
        approvals_count = v_new_count,
        second_approver_id = v_uid, second_approved_at = now(),
        status = case when v_final then 'approved' else 'under_review' end,
        updated_at = now()
      where id = w.id;
    end if;
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
    values (w.org_id, v_uid, w.member_id,
      case when v_final then 'withdrawal_approved' else 'withdrawal_approval_partial' end,
      'withdrawal', w.id,
      jsonb_build_object('approvals', v_new_count, 'required', w.approvals_required, 'note', nullif(p_note,'')));

  elsif p_decision = 'reject' then
    update withdrawal_requests set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(),
      decided_reason = nullif(p_note,''), updated_at = now() where id = w.id;
    insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance,
      withdrawal_id, created_by, note)
    values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, v_uid,
      'Rejected — funds returned');
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, v_uid, w.member_id, 'withdrawal_rejected', 'withdrawal', w.id, nullif(p_note,''));
  else
    raise exception 'finance: decision must be approve or reject';
  end if;
end;
$$;

-- ---- authorize for payment (new — separation from approval) -
create or replace function finance_authorize_withdrawal(p_withdrawal uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; cfg organization_finance_config; v_uid uuid := auth.uid();
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'authorize');
  if w.status <> 'approved' then raise exception 'finance: withdrawal must be approved first'; end if;
  select * into cfg from organization_finance_config where org_id = w.org_id;

  if w.member_id = v_uid then
    raise exception 'finance: the requesting member cannot authorize their own payment';
  end if;
  if coalesce(cfg.enforce_separation_of_duties, true)
     and (w.first_approver_id = v_uid or w.second_approver_id = v_uid)
     and fin_other_capable_exists(w.org_id, v_uid, 'authorize') then
    raise exception 'finance: a different person must authorize payment (separation of duties)';
  end if;

  update withdrawal_requests set status = 'authorized_for_payment',
    authorized_by = v_uid, authorized_at = now(), updated_at = now() where id = w.id;
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
  values (w.org_id, v_uid, w.member_id, 'withdrawal_authorized', 'withdrawal', w.id, nullif(p_note,''));
end;
$$;

-- ---- record payment (new — structured office payment) ------
create or replace function finance_record_withdrawal_payment(
  p_withdrawal uuid, p_channel text, p_method text, p_reference text,
  p_payment_date timestamptz default now(), p_bank_or_provider text default null,
  p_proof_url text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; cfg organization_finance_config; v_uid uuid := auth.uid();
        v_attempt int; v_pay_id uuid; v_key text;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'record_payment');
  if w.status not in ('authorized_for_payment','failed') then
    raise exception 'finance: withdrawal is not ready for payment';
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

  -- if the office does not require a second confirmation, finalize now
  if not coalesce(cfg.require_payment_confirmation, true) then
    perform fin_finalize_withdrawal(w.id, v_uid);
  end if;
  return v_pay_id;
end;
$$;

-- ---- confirm payment (new — second person / reconciliation) -
create or replace function finance_confirm_withdrawal_payment(p_withdrawal uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; cfg organization_finance_config; v_uid uuid := auth.uid();
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'confirm_payment');
  if w.status <> 'payment_recorded' then raise exception 'finance: no recorded payment to confirm'; end if;
  select * into cfg from organization_finance_config where org_id = w.org_id;

  if w.member_id = v_uid then
    raise exception 'finance: the requesting member cannot confirm their own payment';
  end if;
  if coalesce(cfg.enforce_separation_of_duties, true)
     and w.payment_recorded_by = v_uid
     and fin_other_capable_exists(w.org_id, v_uid, 'confirm_payment') then
    raise exception 'finance: a different person must confirm the payment';
  end if;

  update withdrawal_requests set confirmed_by = v_uid, confirmed_at = now(),
    admin_note = coalesce(nullif(p_note,''), admin_note), updated_at = now() where id = w.id;
  perform fin_finalize_withdrawal(w.id, v_uid);
end;
$$;

-- ---- mark a payment attempt failed (retryable / or give up) -
create or replace function finance_fail_withdrawal(
  p_withdrawal uuid, p_reason text, p_return_funds boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; v_uid uuid := auth.uid();
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'record_payment');
  if w.status not in ('authorized_for_payment','payment_recorded','failed') then
    raise exception 'finance: withdrawal cannot be failed from its current state';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'finance: a reason is required'; end if;

  update withdrawal_payments set status = 'failed', failure_reason = btrim(p_reason)
    where id = w.active_payment_id and status in ('recorded','confirmed');

  if p_return_funds then
    update withdrawal_requests set status = 'rejected', failure_reason = btrim(p_reason),
      decided_reason = btrim(p_reason), active_payment_id = null, updated_at = now() where id = w.id;
    insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance,
      withdrawal_id, created_by, note)
    values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, v_uid,
      'Payment failed — funds returned');
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, v_uid, w.member_id, 'withdrawal_failed_returned', 'withdrawal', w.id, btrim(p_reason));
  else
    update withdrawal_requests set status = 'failed', failure_reason = btrim(p_reason),
      active_payment_id = null, updated_at = now() where id = w.id;
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, v_uid, w.member_id, 'withdrawal_failed', 'withdrawal', w.id, btrim(p_reason));
  end if;
end;
$$;

-- ---- reverse a paid withdrawal (genuine reversal only) -----
create or replace function finance_reverse_withdrawal(p_withdrawal uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; v_uid uuid := auth.uid();
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_require(w.org_id, 'reconcile');
  if w.status <> 'paid' then raise exception 'finance: only a paid withdrawal can be reversed'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'finance: a reason is required'; end if;

  update withdrawal_payments set status = 'reversed', failure_reason = btrim(p_reason)
    where withdrawal_id = w.id and status = 'confirmed';
  update withdrawal_requests set status = 'reversed', updated_at = now() where id = w.id;

  -- funds return to Available; payout_debit above is left in place, the
  -- release row nets it back out and reconciliation reports still balance.
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance,
    withdrawal_id, created_by, note)
  values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, v_uid,
    'Payout reversed — funds returned');
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
  values (w.org_id, v_uid, w.member_id, 'withdrawal_reversed', 'withdrawal', w.id, btrim(p_reason));
end;
$$;

-- ---- cancel (evolves 0043) --------------------------------
create or replace function finance_cancel_withdrawal(p_withdrawal uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; cfg organization_finance_config; v_uid uuid := auth.uid();
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  select * into cfg from organization_finance_config where org_id = w.org_id;

  if w.member_id = v_uid then
    if not coalesce(cfg.allow_member_cancel, true) then
      raise exception 'finance: member cancellation is disabled for this office';
    end if;
    if w.status not in ('requested','under_review') then
      raise exception 'finance: too late to cancel — contact your office';
    end if;
  else
    perform fin_require(w.org_id, 'approve');
    if w.status in ('paid','reversed','cancelled','rejected') then
      raise exception 'finance: this withdrawal can no longer be cancelled';
    end if;
  end if;

  update withdrawal_requests set status = 'cancelled', decided_reason = nullif(p_reason,''),
    active_payment_id = null, updated_at = now() where id = w.id;
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance,
    withdrawal_id, created_by, note)
  values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, v_uid,
    'Cancelled — funds returned');
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
  values (w.org_id, v_uid, w.member_id, 'withdrawal_cancelled', 'withdrawal', w.id, nullif(p_reason,''));
end;
$$;

-- retire the two loose 0043 payout RPCs (replaced by authorize/record/confirm)
drop function if exists finance_set_withdrawal_processing(uuid);
drop function if exists finance_mark_withdrawal_paid(uuid, date, numeric, text, text, text, text);

-- ============================================================
-- 13. MANUAL LEDGER ADJUSTMENT  (§13 — documented event, never a raw set)
-- ============================================================
create or replace function finance_manual_adjustment(
  p_org uuid, p_member uuid, p_direction text, p_amount numeric, p_currency text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ccy text := upper(p_currency); v_id uuid; v_avail numeric;
begin
  perform fin_require(p_org, 'verify_settlement');
  if p_direction not in ('credit','debit') then raise exception 'finance: direction must be credit or debit'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'finance: amount must be > 0'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'finance: a reason is required'; end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_member and status = 'active') then
    raise exception 'finance: target member is not in this office';
  end if;
  if p_direction = 'debit' then
    v_avail := fin_available(p_org, p_member, v_ccy);
    if p_amount > v_avail then raise exception 'finance: debit exceeds the member''s available % %', v_avail, v_ccy; end if;
  end if;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, created_by, note)
  values (p_org, p_member,
    case when p_direction = 'credit' then 'adjustment_credit' else 'adjustment_debit' end,
    case when p_direction = 'credit' then p_amount else -p_amount end,
    v_ccy, true, v_uid, btrim(p_reason))
  returning id into v_id;

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after, reason)
  values (p_org, v_uid, p_member, 'manual_adjustment', 'ledger', v_id,
    jsonb_build_object('direction', p_direction, 'amount', p_amount, 'currency', v_ccy), btrim(p_reason));
  return v_id;
end;
$$;

-- ============================================================
-- 14. CONFIG / GRANTS / CONNECTION  (admin-only; every change audited)
-- ============================================================
create or replace function finance_update_config(p_org uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare before_row organization_finance_config; k text;
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
    updated_by = auth.uid(), updated_at = now()
  where org_id = p_org;

  insert into finance_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org, auth.uid(), 'finance_config_changed', 'finance_config', p_org,
    to_jsonb(before_row) - 'updated_by' - 'updated_at' - 'created_at',
    (select to_jsonb(c) - 'updated_by' - 'updated_at' - 'created_at'
     from organization_finance_config c where c.org_id = p_org));
end;
$$;

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
    can_authorize_payment, can_record_payment, can_confirm_payment, can_manage_reconciliation,
    approval_limit_amount)
  values (p_org, p_user, auth.uid(),
    coalesce((p_patch->>'can_view_finance')::boolean, true),
    coalesce((p_patch->>'can_verify_settlement')::boolean, false),
    coalesce((p_patch->>'can_review_withdrawal')::boolean, false),
    coalesce((p_patch->>'can_approve_withdrawal')::boolean, false),
    coalesce((p_patch->>'can_authorize_payment')::boolean, false),
    coalesce((p_patch->>'can_record_payment')::boolean, false),
    coalesce((p_patch->>'can_confirm_payment')::boolean, false),
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

create or replace function finance_revoke_grant(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare before_row org_finance_grants;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'finance: office admin required'; end if;
  select * into before_row from org_finance_grants where org_id = p_org and user_id = p_user;
  delete from org_finance_grants where org_id = p_org and user_id = p_user;
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before)
  values (p_org, auth.uid(), p_user, 'finance_grant_revoked', 'finance_grant', p_user, to_jsonb(before_row));
end;
$$;

create or replace function finance_update_connection(p_org uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; before_row organization_finance_connections;
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'finance: office admin required'; end if;
  select * into before_row from organization_finance_connections
    where org_id = p_org and status <> 'suspended' order by created_at limit 1;
  if before_row.id is null then
    insert into organization_finance_connections (org_id, connected_by) values (p_org, auth.uid())
    returning * into before_row;
  end if;
  v_id := before_row.id;

  update organization_finance_connections set
    connection_type          = coalesce(p_patch->>'connection_type', connection_type),
    settlement_account_name   = case when p_patch ? 'settlement_account_name'
                                  then nullif(p_patch->>'settlement_account_name','') else settlement_account_name end,
    settlement_bank_name      = case when p_patch ? 'settlement_bank_name'
                                  then nullif(p_patch->>'settlement_bank_name','') else settlement_bank_name end,
    settlement_masked_number  = case when p_patch ? 'settlement_masked_number'
                                  then nullif(p_patch->>'settlement_masked_number','') else settlement_masked_number end,
    currency                  = coalesce(nullif(p_patch->>'currency',''), currency),
    status                    = coalesce(p_patch->>'status', status),
    verified_at               = case when (p_patch->>'status') = 'active' then now() else verified_at end,
    connected_by              = auth.uid(),
    updated_at                = now()
  where id = v_id;

  insert into finance_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org, auth.uid(), 'finance_connection_changed', 'finance_connection', v_id,
    to_jsonb(before_row) - 'metadata',
    (select to_jsonb(c) - 'metadata' from organization_finance_connections c where c.id = v_id));
end;
$$;

-- ============================================================
-- 15. READ HELPERS
-- ============================================================
create or replace function finance_config_view(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_org_member(p_org) then raise exception 'finance: not permitted'; end if;
  return (
    select to_jsonb(c) || jsonb_build_object(
      'connection', (select to_jsonb(x) - 'metadata' - 'provider_account_reference'
                     from organization_finance_connections x
                     where x.org_id = p_org and x.status <> 'suspended' order by x.created_at limit 1),
      'viewer_capabilities', jsonb_build_object(
        'is_admin', has_org_role(p_org, array['admin']),
        'view', fin_can(p_org,'view'),
        'verify_settlement', fin_can(p_org,'verify_settlement'),
        'review', fin_can(p_org,'review'),
        'approve', fin_can(p_org,'approve'),
        'authorize', fin_can(p_org,'authorize'),
        'record_payment', fin_can(p_org,'record_payment'),
        'confirm_payment', fin_can(p_org,'confirm_payment'),
        'reconcile', fin_can(p_org,'reconcile')))
    from organization_finance_config c where c.org_id = p_org);
end;
$$;

create or replace function finance_grants_list(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_org_role(p_org, array['admin']) then raise exception 'finance: office admin required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', g.user_id, 'full_name', p.full_name,
      'can_view_finance', g.can_view_finance, 'can_verify_settlement', g.can_verify_settlement,
      'can_review_withdrawal', g.can_review_withdrawal, 'can_approve_withdrawal', g.can_approve_withdrawal,
      'can_authorize_payment', g.can_authorize_payment, 'can_record_payment', g.can_record_payment,
      'can_confirm_payment', g.can_confirm_payment, 'can_manage_reconciliation', g.can_manage_reconciliation,
      'approval_limit_amount', g.approval_limit_amount) order by p.full_name)
    from org_finance_grants g join profiles p on p.id = g.user_id
    where g.org_id = p_org), '[]'::jsonb);
end;
$$;

create or replace function finance_reconciliation(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform fin_require(p_org, 'reconcile');
  return jsonb_build_object(
    'stuck_authorized', (select count(*) from withdrawal_requests
       where org_id = p_org and status = 'authorized_for_payment' and updated_at < now() - interval '48 hours'),
    'awaiting_confirmation', (select count(*) from withdrawal_requests
       where org_id = p_org and status = 'payment_recorded'),
    'failed', (select count(*) from withdrawal_requests where org_id = p_org and status = 'failed'),
    'settled_not_credited', (select count(*) from finance_orders
       where org_id = p_org and status = 'settled' and credited_at is null),
    'duplicate_payment_refs', (select count(*) from (
       select transaction_reference from withdrawal_payments
       where org_id = p_org and transaction_reference is not null
       group by transaction_reference having count(*) > 1) d),
    'negative_balances', (select count(*) from (
       select member_id, currency, sum(amount) bal from finance_ledger
       where org_id = p_org and affects_balance group by member_id, currency having sum(amount) < 0) n),
    'paid_without_payout_row', (select count(*) from withdrawal_requests w
       where w.org_id = p_org and w.status = 'paid'
         and not exists (select 1 from finance_payouts fp where fp.withdrawal_id = w.id)));
end;
$$;

-- ---- balances: include the new pending states; exclude reversed payouts ----
create or replace function finance_member_balances(p_org uuid, p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not (p_member = v_uid or fin_can(p_org, 'view')) then
    raise exception 'finance: not permitted';
  end if;
  return jsonb_build_object(
    'available', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from finance_ledger
            where org_id = p_org and member_id = p_member and affects_balance = true
            group by currency having sum(amount) <> 0) s),
    'lifetime_gross', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(gross_amount) amt from finance_orders
            where org_id = p_org and member_id = p_member and status <> 'cancelled'
            group by currency) s),
    'total_credited', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from finance_ledger
            where org_id = p_org and member_id = p_member and entry_type = 'available_credit'
            group by currency) s),
    'pending_platform', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(gross_amount) amt from finance_orders
            where org_id = p_org and member_id = p_member and status in ('order_received','pending_settlement')
            group by currency) s),
    'pending_withdrawal', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from withdrawal_requests
            where org_id = p_org and member_id = p_member
              and status in ('requested','under_review','approved','authorized_for_payment','payment_recorded')
            group by currency) s),
    'total_paid_out', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select fp.currency, sum(fp.amount_paid) amt from finance_payouts fp
            join withdrawal_requests w on w.id = fp.withdrawal_id
            where fp.org_id = p_org and fp.member_id = p_member and w.status <> 'reversed'
            group by fp.currency) s)
  );
end;
$$;

-- ---- org overview: richer withdrawal-pipeline attention counts ----
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
      'withdrawals_failed', (select count(*) from withdrawal_requests where org_id = p_org and status = 'failed'))
  );
end;
$$;

-- ============================================================
-- 16. NOTIFICATIONS  — in-app + email, member-facing language
-- ============================================================
create or replace function withdrawal_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text := new.status;
  v_subject text; v_headline text; v_member_text text; v_link text := '/wallet';
  v_tail text; v_acct text; u uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;

  v_acct := coalesce(new.payout_snapshot->>'masked_account_number',
                     new.payout_snapshot->>'account_number', '');
  if length(v_acct) >= 4 then v_tail := '••••' || right(v_acct, 4); end if;

  -- notify the reviewing side when a request lands or needs a final confirm
  if (tg_op = 'INSERT' and v_status = 'requested')
     or (tg_op = 'UPDATE' and v_status = 'payment_recorded') then
    for u in
      select m.user_id from memberships m
      where m.org_id = new.org_id and m.status = 'active'
        and fin_capable_user(new.org_id, m.user_id,
              case when v_status = 'requested' then 'approve' else 'confirm_payment' end)
    loop
      perform notify(new.org_id, u, 'finance', 'withdrawal_' || v_status,
        case when v_status = 'requested'
             then 'New withdrawal request: ' || new.amount || ' ' || new.currency
             else 'Withdrawal ' || new.reference || ' needs a final payment confirmation' end,
        '/finance', 'wdadm:' || new.id::text || ':' || v_status);
    end loop;
  end if;

  -- member-facing updates
  case v_status
    when 'requested' then
      v_subject := 'Withdrawal request received'; v_headline := 'We received your withdrawal request';
      v_member_text := 'Your withdrawal request for ' || new.amount || ' ' || new.currency || ' has been received.';
    when 'approved' then
      v_subject := 'Withdrawal approved'; v_headline := 'Your withdrawal has been approved';
      v_member_text := 'Your withdrawal is approved and is being prepared for payment.';
    when 'authorized_for_payment' then
      v_subject := 'Withdrawal is processing'; v_headline := 'Your withdrawal is being processed';
      v_member_text := 'Your withdrawal is authorized and is being paid.';
    when 'paid' then
      v_subject := 'Withdrawal paid'; v_headline := 'Your withdrawal has been paid';
      v_member_text := 'Your withdrawal of ' || new.amount || ' ' || new.currency
                       || coalesce(' to ' || v_tail, '') || ' has been paid.';
    when 'rejected' then
      v_subject := 'Withdrawal not approved'; v_headline := 'Your withdrawal request was not approved';
      v_member_text := 'Your withdrawal request was not approved. The funds have been returned to your available balance.'
                       || coalesce(' Reason: ' || new.decided_reason, '');
    when 'reversed' then
      v_subject := 'Withdrawal returned'; v_headline := 'Your withdrawal was returned';
      v_member_text := 'Your withdrawal was reversed and the funds have been returned to your available balance.';
    else
      return new;  -- under_review / payment_recorded / failed / cancelled: no member message
  end case;

  perform notify(new.org_id, new.member_id, 'finance', 'withdrawal_' || v_status,
    v_member_text, v_link, 'wd:' || new.id::text || ':' || v_status);

  perform enqueue_email(
    new.org_id, new.member_id, 'withdrawal_update', 'finance',
    jsonb_build_object('subject', v_subject, 'headline', v_headline,
      'amount', new.amount, 'currency', new.currency, 'reference', new.reference,
      'status', v_status, 'account_tail', v_tail,
      'note', coalesce(new.decided_reason, new.admin_note),
      'cta_label', 'View wallet', 'cta_path', '/wallet'),
    'wd:' || new.id::text || ':' || v_status, 'withdrawal_request', new.id);
  return new;
end;
$$;

drop trigger if exists withdrawal_requests_email on withdrawal_requests;
drop trigger if exists withdrawal_requests_notify on withdrawal_requests;
create trigger withdrawal_requests_notify
  after insert or update on withdrawal_requests
  for each row execute function withdrawal_notify();

-- ============================================================
-- 17. GRANTS
-- ============================================================
grant execute on function fin_can(uuid, text) to authenticated;
grant execute on function fin_capable_user(uuid, uuid, text) to authenticated;
grant execute on function fin_other_capable_exists(uuid, uuid, text) to authenticated;
grant execute on function finance_request_withdrawal(uuid, numeric, text, text, uuid, text) to authenticated;
grant execute on function finance_review_withdrawal(uuid, text, text) to authenticated;
grant execute on function finance_authorize_withdrawal(uuid, text) to authenticated;
grant execute on function finance_record_withdrawal_payment(uuid, text, text, text, timestamptz, text, text, text) to authenticated;
grant execute on function finance_confirm_withdrawal_payment(uuid, text) to authenticated;
grant execute on function finance_fail_withdrawal(uuid, text, boolean) to authenticated;
grant execute on function finance_reverse_withdrawal(uuid, text) to authenticated;
grant execute on function finance_cancel_withdrawal(uuid, text) to authenticated;
grant execute on function finance_manual_adjustment(uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function finance_update_config(uuid, jsonb) to authenticated;
grant execute on function finance_set_grant(uuid, uuid, jsonb) to authenticated;
grant execute on function finance_revoke_grant(uuid, uuid) to authenticated;
grant execute on function finance_update_connection(uuid, jsonb) to authenticated;
grant execute on function finance_config_view(uuid) to authenticated;
grant execute on function finance_grants_list(uuid) to authenticated;
grant execute on function finance_reconciliation(uuid) to authenticated;
grant execute on function finance_member_balances(uuid, uuid) to authenticated;
grant execute on function finance_org_overview(uuid, timestamptz, timestamptz) to authenticated;
