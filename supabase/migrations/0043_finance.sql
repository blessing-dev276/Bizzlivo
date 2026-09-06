-- ============================================================
-- 0043 — FINANCE / WALLET v2
--
-- Turns the member Wallet from a self-reported "income log" into a
-- transparent, ledger-backed earnings & payout system.
--
-- Two separate concepts:
--   A. VERIFIED OFFICE EARNINGS  -> finance_* tables below. Admin-only
--      writes, and only through the security-definer RPCs at the bottom.
--      Balances are DERIVED from finance_ledger, never stored mutable.
--   B. PERSONAL INCOME TRACKING  -> income_development_income_entries
--      (0023) is LEFT UNTOUCHED. It never affects withdrawable balance.
--      No data is migrated between the two.
--
-- Money model (per order):
--   gross_amount (never overwritten)
--     -> platform_deduction / settled_amount  (settlement)
--     -> exchange_rate / converted_amount      (optional conversion, rate
--        stored permanently, never recomputed from a live rate)
--     -> itemised finance_charges
--     -> available_amount  (posted once as a finance_ledger
--        'available_credit' row -> becomes withdrawable)
--
-- Balances (computed PER CURRENCY, never cross-currency added):
--   available        = Σ available_credit − Σ withdrawal_reserve + Σ withdrawal_release
--   pending_platform = Σ gross of orders in (order_received, pending_settlement)
--   pending_withdrawal = Σ withdrawal_requests.amount in (requested,approved,processing)
--   total_paid_out   = Σ finance_payouts.amount_paid
--   lifetime_gross   = Σ finance_orders.gross_amount
--
-- Every state change writes a finance_events row (before/after) — a
-- dedicated financial audit trail, separate from the generic audit_log.
-- Nothing is hard-deleted; corrections are voids / reversals.
-- ============================================================

-- ---------- office finance settings ----------
alter table organizations
  add column if not exists base_currency text not null default 'NGN',
  add column if not exists min_withdrawal_amount numeric(14,2) not null default 0,
  add column if not exists withdrawal_requires_approval boolean not null default true,
  add column if not exists allow_member_cancel_withdrawal boolean not null default true;

-- ---------- member payout accounts ----------
create table member_payout_accounts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  bank_name      text not null,
  account_name   text not null,
  account_number text not null,
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index member_payout_accounts_one_default
  on member_payout_accounts(org_id, user_id) where is_default;

-- ---------- orders (verified office earnings) ----------
create table finance_orders (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  member_id          uuid not null references profiles(id) on delete cascade,
  platform           text not null,
  title              text not null,
  order_reference    text,
  description        text,
  proof_url          text,
  order_date         date not null,
  gross_amount       numeric(14,2) not null check (gross_amount >= 0),
  currency           text not null,
  status             text not null default 'order_received'
    check (status in ('order_received','pending_settlement','settled','available','partially_paid','paid','cancelled')),
  -- settlement (gross_amount is never overwritten)
  platform_deduction numeric(14,2) check (platform_deduction >= 0),
  settled_amount     numeric(14,2) check (settled_amount >= 0),
  settled_on         date,
  settlement_currency text,
  settled_by         uuid references profiles(id),
  -- currency conversion (rate stored permanently)
  converted          boolean not null default false,
  from_currency      text,
  to_currency        text,
  exchange_rate      numeric(18,6) check (exchange_rate > 0),
  converted_amount   numeric(14,2) check (converted_amount >= 0),
  conversion_date    date,
  -- final member credit
  available_amount   numeric(14,2) check (available_amount >= 0),
  available_currency text,
  credited_at        timestamptz,
  credited_by        uuid references profiles(id),
  cancelled_reason   text,
  created_by         uuid not null references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index finance_orders_org_idx on finance_orders(org_id, status);
create index finance_orders_member_idx on finance_orders(org_id, member_id);

-- ---------- itemised charges / adjustments ----------
create table finance_charges (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  order_id      uuid not null references finance_orders(id) on delete cascade,
  member_id     uuid not null references profiles(id) on delete cascade,
  charge_type   text not null check (charge_type in
    ('platform_fee','withdrawal_fee','conversion_fee','bank_charge','service_charge','other')),
  description   text,
  amount        numeric(14,2) not null check (amount >= 0),
  currency      text not null,
  charge_date   date not null default current_date,
  voided        boolean not null default false,
  voided_reason text,
  voided_at     timestamptz,
  reversal_of   uuid references finance_charges(id),
  added_by      uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);
create index finance_charges_order_idx on finance_charges(order_id);

-- ---------- withdrawal requests ----------
create table withdrawal_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  member_id         uuid not null references profiles(id) on delete cascade,
  reference         text not null,
  amount            numeric(14,2) not null check (amount > 0),
  currency          text not null,
  method            text,
  payout_account_id uuid references member_payout_accounts(id) on delete set null,
  payout_snapshot   jsonb,
  member_note       text,
  status            text not null default 'requested'
    check (status in ('requested','approved','processing','paid','rejected','cancelled')),
  available_before  numeric(14,2),
  reviewed_by       uuid references profiles(id),
  reviewed_at       timestamptz,
  admin_note        text,
  decided_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index withdrawal_requests_org_idx on withdrawal_requests(org_id, status);
create index withdrawal_requests_member_idx on withdrawal_requests(org_id, member_id);

-- ---------- append-only ledger ----------
create table finance_ledger (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  member_id      uuid not null references profiles(id) on delete cascade,
  entry_type     text not null check (entry_type in
    ('order_recorded','settlement','conversion','charge','charge_reversal',
     'available_credit','withdrawal_reserve','withdrawal_release','payout','adjustment')),
  amount         numeric(14,2) not null,          -- signed, in `currency`
  currency       text not null,
  affects_balance boolean not null default false, -- only true rows move Available
  order_id       uuid references finance_orders(id) on delete set null,
  charge_id      uuid references finance_charges(id) on delete set null,
  withdrawal_id  uuid references withdrawal_requests(id) on delete set null,
  note           text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now()
);
create index finance_ledger_member_idx on finance_ledger(org_id, member_id, currency);
-- one available_credit per order (prevents double credit / race)
create unique index finance_ledger_one_credit_per_order
  on finance_ledger(order_id) where entry_type = 'available_credit';

-- ---------- payouts ----------
create table finance_payouts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  member_id     uuid not null references profiles(id) on delete cascade,
  withdrawal_id uuid not null unique references withdrawal_requests(id) on delete cascade,
  amount_paid   numeric(14,2) not null check (amount_paid >= 0),
  currency      text not null,
  paid_on       date not null,
  method        text,
  reference     text,
  proof_url     text,
  admin_note    text,
  recorded_by   uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);

-- ---------- dedicated financial audit trail ----------
create table finance_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  actor_id     uuid references profiles(id),
  member_id    uuid references profiles(id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  reason       text,
  created_at   timestamptz not null default now()
);
create index finance_events_org_idx on finance_events(org_id, created_at desc);
create index finance_events_entity_idx on finance_events(entity_type, entity_id);

-- ============================================================
-- RLS — read only from the client. All writes go through the
-- security-definer RPCs below (which run as owner and bypass RLS).
-- admin = full office finance. member = own records only.
-- trainer / team_leader = NO finance access (no policy at all).
-- ============================================================
alter table member_payout_accounts enable row level security;
alter table finance_orders          enable row level security;
alter table finance_charges         enable row level security;
alter table withdrawal_requests     enable row level security;
alter table finance_ledger          enable row level security;
alter table finance_payouts         enable row level security;
alter table finance_events          enable row level security;

create policy "payout accounts: owner manages own"
  on member_payout_accounts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_org_member(org_id));
create policy "payout accounts: admin reads for payout ops"
  on member_payout_accounts for select
  using (has_org_role(org_id, array['admin']));

create policy "finance_orders: member self or admin"
  on finance_orders for select
  using (member_id = auth.uid() or has_org_role(org_id, array['admin']));
create policy "finance_charges: member self or admin"
  on finance_charges for select
  using (member_id = auth.uid() or has_org_role(org_id, array['admin']));
create policy "withdrawal_requests: member self or admin"
  on withdrawal_requests for select
  using (member_id = auth.uid() or has_org_role(org_id, array['admin']));
create policy "finance_ledger: member self or admin"
  on finance_ledger for select
  using (member_id = auth.uid() or has_org_role(org_id, array['admin']));
create policy "finance_payouts: member self or admin"
  on finance_payouts for select
  using (member_id = auth.uid() or has_org_role(org_id, array['admin']));
create policy "finance_events: member self or admin"
  on finance_events for select
  using (member_id = auth.uid() or has_org_role(org_id, array['admin']));

-- ============================================================
-- Helpers
-- ============================================================
create or replace function fin_assert_admin(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(p_org, array['admin']) then
    raise exception 'finance: admin role required';
  end if;
end;
$$;

create or replace function fin_next_ref(p_prefix text)
returns text language sql volatile as $$
  select p_prefix || '-' || to_char(now(), 'YYMMDD') || '-' ||
         lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
$$;

-- Available balance for a member in a specific currency (from the ledger).
create or replace function fin_available(p_org uuid, p_member uuid, p_currency text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)
  from finance_ledger
  where org_id = p_org and member_id = p_member
    and currency = p_currency and affects_balance = true;
$$;

-- ============================================================
-- ORDER RPCs
-- ============================================================
create or replace function finance_record_order(
  p_org uuid, p_member uuid, p_platform text, p_title text,
  p_order_date date, p_gross numeric, p_currency text,
  p_reference text default null, p_description text default null, p_proof_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform fin_assert_admin(p_org);
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_member and status = 'active') then
    raise exception 'finance: target member is not in this office';
  end if;
  if p_gross is null or p_gross < 0 then raise exception 'finance: gross amount must be >= 0'; end if;

  insert into finance_orders (org_id, member_id, platform, title, order_reference, description,
    proof_url, order_date, gross_amount, currency, status, created_by)
  values (p_org, p_member, p_platform, p_title, nullif(p_reference,''), nullif(p_description,''),
    nullif(p_proof_url,''), p_order_date, p_gross, upper(p_currency), 'order_received', auth.uid())
  returning id into v_id;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, order_id, created_by, note)
  values (p_org, p_member, 'order_recorded', p_gross, upper(p_currency), false, v_id, auth.uid(), 'Order recorded');

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (p_org, auth.uid(), p_member, 'order_created', 'order', v_id,
    jsonb_build_object('platform', p_platform, 'title', p_title, 'gross', p_gross, 'currency', upper(p_currency)));
  return v_id;
end;
$$;

create or replace function finance_update_order(
  p_order uuid, p_platform text, p_title text, p_order_date date,
  p_gross numeric, p_currency text, p_reference text default null,
  p_description text default null, p_proof_url text default null
) returns void language plpgsql security definer set search_path = public as $$
declare o finance_orders;
begin
  select * into o from finance_orders where id = p_order;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.status not in ('order_received','pending_settlement') then
    raise exception 'finance: order can no longer be edited (settled)';
  end if;

  update finance_orders set
    platform = p_platform, title = p_title, order_date = p_order_date,
    gross_amount = p_gross, currency = upper(p_currency),
    order_reference = nullif(p_reference,''), description = nullif(p_description,''),
    proof_url = nullif(p_proof_url,''), updated_at = now()
  where id = p_order;

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before, after)
  values (o.org_id, auth.uid(), o.member_id, 'order_updated', 'order', p_order,
    jsonb_build_object('platform', o.platform, 'title', o.title, 'gross', o.gross_amount, 'currency', o.currency),
    jsonb_build_object('platform', p_platform, 'title', p_title, 'gross', p_gross, 'currency', upper(p_currency)));
end;
$$;

create or replace function finance_cancel_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o finance_orders;
begin
  select * into o from finance_orders where id = p_order;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.credited_at is not null then
    raise exception 'finance: cannot cancel an order already credited as available';
  end if;
  update finance_orders set status = 'cancelled', cancelled_reason = p_reason, updated_at = now() where id = p_order;
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before, reason)
  values (o.org_id, auth.uid(), o.member_id, 'order_cancelled', 'order', p_order,
    to_jsonb(o) - 'created_by', p_reason);
end;
$$;

-- ============================================================
-- SETTLEMENT
-- ============================================================
create or replace function finance_record_settlement(
  p_order uuid, p_platform_deduction numeric, p_settled_amount numeric,
  p_settled_on date, p_settlement_currency text default null
) returns void language plpgsql security definer set search_path = public as $$
declare o finance_orders; v_ccy text;
begin
  select * into o from finance_orders where id = p_order for update;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.settled_amount is not null then raise exception 'finance: order is already settled'; end if;
  if o.status = 'cancelled' then raise exception 'finance: order is cancelled'; end if;
  if p_settled_amount is null or p_settled_amount < 0 then raise exception 'finance: settled amount must be >= 0'; end if;

  v_ccy := upper(coalesce(nullif(p_settlement_currency,''), o.currency));
  update finance_orders set
    platform_deduction = coalesce(p_platform_deduction, 0),
    settled_amount = p_settled_amount,
    settled_on = coalesce(p_settled_on, current_date),
    settlement_currency = v_ccy,
    settled_by = auth.uid(),
    status = 'settled',
    updated_at = now()
  where id = p_order;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, order_id, created_by, note)
  values (o.org_id, o.member_id, 'settlement', p_settled_amount, v_ccy, false, p_order, auth.uid(),
    'Net platform settlement (gross ' || o.gross_amount || ' ' || o.currency || ', deduction ' || coalesce(p_platform_deduction,0) || ')');

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before, after)
  values (o.org_id, auth.uid(), o.member_id, 'settlement_recorded', 'order', p_order,
    jsonb_build_object('gross', o.gross_amount, 'currency', o.currency),
    jsonb_build_object('platform_deduction', coalesce(p_platform_deduction,0), 'settled_amount', p_settled_amount,
      'settlement_currency', v_ccy, 'settled_on', coalesce(p_settled_on, current_date)));
end;
$$;

-- ============================================================
-- CURRENCY CONVERSION  (rate stored permanently, never recomputed)
-- ============================================================
create or replace function finance_record_conversion(
  p_order uuid, p_from_currency text, p_to_currency text,
  p_rate numeric, p_conversion_date date
) returns void language plpgsql security definer set search_path = public as $$
declare o finance_orders; v_converted numeric;
begin
  select * into o from finance_orders where id = p_order for update;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.settled_amount is null then raise exception 'finance: record the settlement first'; end if;
  if o.credited_at is not null then raise exception 'finance: order already credited — conversion locked'; end if;
  if p_rate is null or p_rate <= 0 then raise exception 'finance: exchange rate must be > 0'; end if;

  v_converted := round(o.settled_amount * p_rate, 2);
  update finance_orders set
    converted = true,
    from_currency = upper(p_from_currency),
    to_currency = upper(p_to_currency),
    exchange_rate = p_rate,
    converted_amount = v_converted,
    conversion_date = coalesce(p_conversion_date, current_date),
    updated_at = now()
  where id = p_order;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, order_id, created_by, note)
  values (o.org_id, o.member_id, 'conversion', v_converted, upper(p_to_currency), false, p_order, auth.uid(),
    '1 ' || upper(p_from_currency) || ' = ' || p_rate || ' ' || upper(p_to_currency));

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before, after)
  values (o.org_id, auth.uid(), o.member_id, 'conversion_recorded', 'order', p_order,
    jsonb_build_object('settled_amount', o.settled_amount, 'settlement_currency', o.settlement_currency),
    jsonb_build_object('from', upper(p_from_currency), 'to', upper(p_to_currency), 'rate', p_rate,
      'converted_amount', v_converted, 'date', coalesce(p_conversion_date, current_date)));
end;
$$;

create or replace function finance_clear_conversion(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o finance_orders;
begin
  select * into o from finance_orders where id = p_order for update;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.credited_at is not null then raise exception 'finance: order already credited'; end if;
  delete from finance_ledger where order_id = p_order and entry_type = 'conversion';
  update finance_orders set converted = false, from_currency = null, to_currency = null,
    exchange_rate = null, converted_amount = null, conversion_date = null, updated_at = now()
  where id = p_order;
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
  values (o.org_id, auth.uid(), o.member_id, 'conversion_cleared', 'order', p_order, 'no conversion');
end;
$$;

-- ============================================================
-- CHARGES
-- ============================================================
create or replace function finance_add_charge(
  p_order uuid, p_type text, p_amount numeric, p_currency text,
  p_description text default null, p_charge_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare o finance_orders; v_id uuid;
begin
  select * into o from finance_orders where id = p_order;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.credited_at is not null then raise exception 'finance: order already credited — charges locked'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'finance: charge amount must be >= 0'; end if;

  insert into finance_charges (org_id, order_id, member_id, charge_type, description, amount, currency, charge_date, added_by)
  values (o.org_id, p_order, o.member_id, p_type, nullif(p_description,''), p_amount, upper(p_currency),
    coalesce(p_charge_date, current_date), auth.uid())
  returning id into v_id;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, order_id, charge_id, created_by, note)
  values (o.org_id, o.member_id, 'charge', -p_amount, upper(p_currency), false, p_order, v_id, auth.uid(), p_type);

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (o.org_id, auth.uid(), o.member_id, 'charge_added', 'charge', v_id,
    jsonb_build_object('type', p_type, 'amount', p_amount, 'currency', upper(p_currency)));
  return v_id;
end;
$$;

create or replace function finance_void_charge(p_charge uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c finance_charges; o finance_orders;
begin
  select * into c from finance_charges where id = p_charge;
  if not found then raise exception 'finance: charge not found'; end if;
  perform fin_assert_admin(c.org_id);
  if c.voided then raise exception 'finance: charge already voided'; end if;
  select * into o from finance_orders where id = c.order_id;
  if o.credited_at is not null then raise exception 'finance: order already credited — charges locked'; end if;

  update finance_charges set voided = true, voided_reason = p_reason, voided_at = now() where id = p_charge;

  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, order_id, charge_id, created_by, note)
  values (c.org_id, c.member_id, 'charge_reversal', c.amount, c.currency, false, c.order_id, c.id, auth.uid(),
    'Reversal of ' || c.charge_type);

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, before, reason)
  values (c.org_id, auth.uid(), c.member_id, 'charge_voided', 'charge', p_charge,
    jsonb_build_object('type', c.charge_type, 'amount', c.amount, 'currency', c.currency), p_reason);
end;
$$;

-- ============================================================
-- CREDIT AVAILABLE  (gross -> settlement -> conversion -> charges -> available)
-- ============================================================
create or replace function finance_credit_available(p_order uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare o finance_orders; v_base numeric; v_ccy text; v_charges numeric; v_final numeric;
begin
  select * into o from finance_orders where id = p_order for update;
  if not found then raise exception 'finance: order not found'; end if;
  perform fin_assert_admin(o.org_id);
  if o.status = 'cancelled' then raise exception 'finance: order is cancelled'; end if;
  if o.settled_amount is null then raise exception 'finance: record the settlement first'; end if;
  if o.credited_at is not null then raise exception 'finance: order is already credited'; end if;

  if o.converted then
    v_base := o.converted_amount; v_ccy := o.to_currency;
  else
    v_base := o.settled_amount; v_ccy := coalesce(o.settlement_currency, o.currency);
  end if;

  -- charges must be in the same currency as the credit
  select coalesce(sum(amount), 0) into v_charges
  from finance_charges where order_id = p_order and voided = false and currency = v_ccy;
  if exists (select 1 from finance_charges where order_id = p_order and voided = false and currency <> v_ccy) then
    raise exception 'finance: some charges are in a different currency than the credit (%). Fix charges first.', v_ccy;
  end if;

  v_final := round(v_base - v_charges, 2);
  if v_final < 0 then raise exception 'finance: charges exceed the settled amount'; end if;

  update finance_orders set
    available_amount = v_final, available_currency = v_ccy,
    credited_at = now(), credited_by = auth.uid(), status = 'available', updated_at = now()
  where id = p_order;

  -- the one balance-moving row for this order (unique index guards double credit)
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, order_id, created_by, note)
  values (o.org_id, o.member_id, 'available_credit', v_final, v_ccy, true, p_order, auth.uid(),
    'Final available amount');

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (o.org_id, auth.uid(), o.member_id, 'available_credited', 'order', p_order,
    jsonb_build_object('base', v_base, 'charges', v_charges, 'final', v_final, 'currency', v_ccy));
  return v_final;
end;
$$;

-- ============================================================
-- WITHDRAWALS
-- ============================================================
create or replace function finance_request_withdrawal(
  p_org uuid, p_amount numeric, p_currency text,
  p_method text default null, p_account_id uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_avail numeric; v_min numeric; v_id uuid; v_ref text; v_snap jsonb; v_ccy text;
begin
  if v_uid is null then raise exception 'finance: not authenticated'; end if;
  if not is_org_member(p_org) then raise exception 'finance: not a member of this office'; end if;
  v_ccy := upper(p_currency);
  -- serialise concurrent requests from the same member in the same office
  perform pg_advisory_xact_lock(hashtext(p_org::text || ':' || v_uid::text));

  if p_amount is null or p_amount <= 0 then raise exception 'finance: amount must be > 0'; end if;
  select coalesce(min_withdrawal_amount, 0) into v_min from organizations where id = p_org;
  if p_amount < v_min then raise exception 'finance: below the minimum withdrawal of %', v_min; end if;

  v_avail := fin_available(p_org, v_uid, v_ccy);
  if p_amount > v_avail then
    raise exception 'finance: requested % exceeds available % %', p_amount, v_avail, v_ccy;
  end if;

  if p_account_id is not null then
    select jsonb_build_object('bank_name', bank_name, 'account_name', account_name, 'account_number', account_number)
      into v_snap from member_payout_accounts where id = p_account_id and user_id = v_uid and org_id = p_org;
  end if;

  v_ref := fin_next_ref('WD');
  insert into withdrawal_requests (org_id, member_id, reference, amount, currency, method,
    payout_account_id, payout_snapshot, member_note, status, available_before)
  values (p_org, v_uid, v_ref, p_amount, v_ccy, nullif(p_method,''),
    p_account_id, v_snap, nullif(p_note,''), 'requested', v_avail)
  returning id into v_id;

  -- reserve the funds immediately so they cannot be requested twice
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, withdrawal_id, created_by, note)
  values (p_org, v_uid, 'withdrawal_reserve', -p_amount, v_ccy, true, v_id, v_uid, 'Reserved for ' || v_ref);

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (p_org, v_uid, v_uid, 'withdrawal_requested', 'withdrawal', v_id,
    jsonb_build_object('reference', v_ref, 'amount', p_amount, 'currency', v_ccy, 'available_before', v_avail));
  return v_id;
end;
$$;

create or replace function finance_review_withdrawal(p_withdrawal uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_assert_admin(w.org_id);
  if w.status <> 'requested' then raise exception 'finance: withdrawal is not awaiting review'; end if;

  if p_decision = 'approve' then
    update withdrawal_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      admin_note = nullif(p_note,''), updated_at = now() where id = p_withdrawal;
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, auth.uid(), w.member_id, 'withdrawal_approved', 'withdrawal', p_withdrawal, nullif(p_note,''));
  elsif p_decision = 'reject' then
    update withdrawal_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      decided_reason = nullif(p_note,''), updated_at = now() where id = p_withdrawal;
    -- return the reserved funds
    insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, withdrawal_id, created_by, note)
    values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, auth.uid(), 'Rejected — funds returned');
    insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
    values (w.org_id, auth.uid(), w.member_id, 'withdrawal_rejected', 'withdrawal', p_withdrawal, nullif(p_note,''));
  else
    raise exception 'finance: decision must be approve or reject';
  end if;
end;
$$;

create or replace function finance_set_withdrawal_processing(p_withdrawal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_assert_admin(w.org_id);
  if w.status <> 'approved' then raise exception 'finance: withdrawal must be approved first'; end if;
  update withdrawal_requests set status = 'processing', updated_at = now() where id = p_withdrawal;
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id)
  values (w.org_id, auth.uid(), w.member_id, 'withdrawal_processing', 'withdrawal', p_withdrawal);
end;
$$;

create or replace function finance_mark_withdrawal_paid(
  p_withdrawal uuid, p_paid_on date, p_amount_paid numeric,
  p_reference text default null, p_method text default null,
  p_proof_url text default null, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  perform fin_assert_admin(w.org_id);
  if w.status not in ('approved','processing') then raise exception 'finance: withdrawal is not in a payable state'; end if;

  update withdrawal_requests set status = 'paid', updated_at = now() where id = p_withdrawal;

  insert into finance_payouts (org_id, member_id, withdrawal_id, amount_paid, currency, paid_on, method, reference, proof_url, admin_note, recorded_by)
  values (w.org_id, w.member_id, w.id, coalesce(p_amount_paid, w.amount), w.currency,
    coalesce(p_paid_on, current_date), nullif(p_method,''), nullif(p_reference,''), nullif(p_proof_url,''), nullif(p_note,''), auth.uid());

  -- reserve already removed the funds from Available; payout row is the record of settlement
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, withdrawal_id, created_by, note)
  values (w.org_id, w.member_id, 'payout', 0, w.currency, false, w.id, auth.uid(),
    'Paid ' || coalesce(p_amount_paid, w.amount) || ' ' || w.currency);

  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, after)
  values (w.org_id, auth.uid(), w.member_id, 'withdrawal_paid', 'withdrawal', p_withdrawal,
    jsonb_build_object('amount_paid', coalesce(p_amount_paid, w.amount), 'currency', w.currency,
      'paid_on', coalesce(p_paid_on, current_date), 'reference', p_reference));
end;
$$;

create or replace function finance_cancel_withdrawal(p_withdrawal uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; v_allow boolean;
begin
  select * into w from withdrawal_requests where id = p_withdrawal for update;
  if not found then raise exception 'finance: withdrawal not found'; end if;
  -- member may cancel their own while still 'requested' (if the office allows); admin any time pre-paid
  if w.member_id = auth.uid() then
    select allow_member_cancel_withdrawal into v_allow from organizations where id = w.org_id;
    if not coalesce(v_allow, true) then raise exception 'finance: member cancellation is disabled'; end if;
    if w.status <> 'requested' then raise exception 'finance: too late to cancel'; end if;
  else
    perform fin_assert_admin(w.org_id);
    if w.status not in ('requested','approved','processing') then raise exception 'finance: cannot cancel'; end if;
  end if;

  update withdrawal_requests set status = 'cancelled', decided_reason = nullif(p_reason,''), updated_at = now()
  where id = p_withdrawal;
  insert into finance_ledger (org_id, member_id, entry_type, amount, currency, affects_balance, withdrawal_id, created_by, note)
  values (w.org_id, w.member_id, 'withdrawal_release', w.amount, w.currency, true, w.id, auth.uid(), 'Cancelled — funds returned');
  insert into finance_events (org_id, actor_id, member_id, action, entity_type, entity_id, reason)
  values (w.org_id, auth.uid(), w.member_id, 'withdrawal_cancelled', 'withdrawal', p_withdrawal, nullif(p_reason,''));
end;
$$;

-- ============================================================
-- READ HELPERS (jsonb, mirror the 0041 report RPC style)
-- ============================================================
create or replace function finance_member_balances(p_org uuid, p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not (p_member = v_uid or has_org_role(p_org, array['admin'])) then
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
    'pending_platform', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(gross_amount) amt from finance_orders
            where org_id = p_org and member_id = p_member and status in ('order_received','pending_settlement')
            group by currency) s),
    'pending_withdrawal', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from withdrawal_requests
            where org_id = p_org and member_id = p_member and status in ('requested','approved','processing')
            group by currency) s),
    'total_paid_out', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount_paid) amt from finance_payouts
            where org_id = p_org and member_id = p_member group by currency) s)
  );
end;
$$;

create or replace function finance_org_overview(p_org uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform fin_assert_admin(p_org);
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
            where org_id = p_org and status in ('order_received','pending_settlement')
            group by currency) s),
    'available_member_funds', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount) amt from finance_ledger
            where org_id = p_org and affects_balance = true group by currency having sum(amount) <> 0) s),
    'pending_withdrawals_count', (select count(*) from withdrawal_requests where org_id = p_org and status = 'requested'),
    'paid_in_period', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amt) order by currency), '[]'::jsonb)
      from (select currency, sum(amount_paid) amt from finance_payouts
            where org_id = p_org and created_at >= p_start and created_at < p_end group by currency) s),
    'needs_attention', jsonb_build_object(
      'awaiting_settlement', (select count(*) from finance_orders where org_id = p_org and status in ('order_received','pending_settlement')),
      'withdrawals_awaiting_approval', (select count(*) from withdrawal_requests where org_id = p_org and status = 'requested'),
      'settled_not_credited', (select count(*) from finance_orders where org_id = p_org and status = 'settled' and credited_at is null),
      'missing_conversion', (select count(*) from finance_orders where org_id = p_org and status = 'settled'
        and credited_at is null and converted = false and settlement_currency is distinct from
        (select base_currency from organizations where id = p_org)))
  );
end;
$$;

grant execute on function finance_record_order(uuid, uuid, text, text, date, numeric, text, text, text, text) to authenticated;
grant execute on function finance_update_order(uuid, text, text, date, numeric, text, text, text, text) to authenticated;
grant execute on function finance_cancel_order(uuid, text) to authenticated;
grant execute on function finance_record_settlement(uuid, numeric, numeric, date, text) to authenticated;
grant execute on function finance_record_conversion(uuid, text, text, numeric, date) to authenticated;
grant execute on function finance_clear_conversion(uuid) to authenticated;
grant execute on function finance_add_charge(uuid, text, numeric, text, text, date) to authenticated;
grant execute on function finance_void_charge(uuid, text) to authenticated;
grant execute on function finance_credit_available(uuid) to authenticated;
grant execute on function finance_request_withdrawal(uuid, numeric, text, text, uuid, text) to authenticated;
grant execute on function finance_review_withdrawal(uuid, text, text) to authenticated;
grant execute on function finance_set_withdrawal_processing(uuid) to authenticated;
grant execute on function finance_mark_withdrawal_paid(uuid, date, numeric, text, text, text, text) to authenticated;
grant execute on function finance_cancel_withdrawal(uuid, text) to authenticated;
grant execute on function finance_member_balances(uuid, uuid) to authenticated;
grant execute on function finance_org_overview(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function fin_available(uuid, uuid, text) to authenticated;
