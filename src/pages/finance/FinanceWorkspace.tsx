import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { localDateString } from '../../lib/date'
import type {
  FinanceCharge,
  FinanceLedgerEntry,
  FinanceOrder,
  FinancePayout,
  FinancePaymentChannel,
  FinanceReconciliation,
  OrgFinanceConfig,
  Profile,
  WithdrawalRequest,
} from '../../types/database'
import {
  CHARGE_TYPE_LABEL,
  COMMON_CURRENCIES,
  LEDGER_TYPE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  addCharge,
  authorizeWithdrawal,
  cancelOrder,
  clearConversion,
  confirmWithdrawalPayment,
  creditAvailable,
  failWithdrawal,
  listCharges,
  listLedger,
  listOrders,
  listPayouts,
  listWithdrawals,
  loadFinanceConfig,
  loadOrgOverview,
  loadReconciliationFlags,
  money,
  moneyList,
  previewCredit,
  recordConversion,
  recordOrder,
  recordSettlement,
  recordWithdrawalPayment,
  resolveReconciliationFlag,
  reverseWithdrawal,
  reviewWithdrawal,
  runReconcileScan,
  sendPayout,
  voidCharge,
} from '../../lib/finance'
import type { FinanceReconciliationFlag } from '../../types/database'
import { OrderBreakdown, OrderStatusPill, WithdrawalStatusPill } from './shared'

type Tab = 'overview' | 'orders' | 'withdrawals' | 'members' | 'transactions' | 'reconciliation'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'orders', label: 'Earnings' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'members', label: 'Members' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'reconciliation', label: 'Reconciliation' },
]

export default function FinanceWorkspace() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [tab, setTab] = useState<Tab>('overview')
  const [cfg, setCfg] = useState<OrgFinanceConfig | null>(null)
  const [denied, setDenied] = useState(false)
  const [members, setMembers] = useState<Profile[]>([])
  const [orders, setOrders] = useState<FinanceOrder[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [ledger, setLedger] = useState<FinanceLedgerEntry[]>([])
  const [payouts, setPayouts] = useState<FinancePayout[]>([])
  const [loading, setLoading] = useState(true)
  const [openOrder, setOpenOrder] = useState<FinanceOrder | null>(null)
  const [showRecord, setShowRecord] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const config = await loadFinanceConfig(orgId)
      setCfg(config)
      if (!config.viewer_capabilities.view) { setDenied(true); setLoading(false); return }
      const [m, o, w, l, p] = await Promise.all([
        supabase.from('memberships').select('profile:profiles(*)').eq('org_id', orgId).eq('status', 'active').returns<{ profile: Profile }[]>(),
        listOrders(orgId),
        listWithdrawals(orgId),
        listLedger(orgId),
        listPayouts(orgId),
      ])
      setMembers(((m.data ?? []).map((r) => r.profile)).filter(Boolean))
      setOrders(o); setWithdrawals(w); setLedger(l); setPayouts(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load finance data.')
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { reload() }, [reload])

  const memberName = useCallback((id: string) => members.find((m) => m.id === id)?.full_name ?? 'Member', [members])

  if (!orgId) return null
  if (denied) return <Navigate to="/wallet" replace />
  const caps = cfg?.viewer_capabilities

  return (
    <div className="page fin">
      <div className="lc-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Finance Operations</h1>
          <p>Verified office earnings, settlements, and member payouts — a transparent ledger, not an editable balance. The office pays each authorized withdrawal from its own financial account.</p>
          {cfg?.finance_status === 'restricted' && (
            <p className="form-error">Finance is restricted{cfg.finance_status_reason ? ` — ${cfg.finance_status_reason}` : ''}. Payouts cannot be initiated.</p>
          )}
        </div>
        {caps?.is_admin && <button type="button" className="md-btn" onClick={() => setShowRecord(true)}>Record earning</button>}
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="view-tabs" style={{ marginBottom: 18 }}>
        {TABS.filter((t) => t.key !== 'reconciliation' || caps?.reconcile).map((t) => (
          <button key={t.key} type="button" className={`view-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading || !cfg ? <p className="empty-row">Loading…</p> : (
        <>
          {tab === 'overview' && <Overview orgId={orgId} orders={orders} withdrawals={withdrawals} onGo={setTab} />}
          {tab === 'orders' && (
            <OrdersTable orders={orders} memberName={memberName} onOpen={setOpenOrder} />
          )}
          {tab === 'withdrawals' && (
            <WithdrawalsQueue withdrawals={withdrawals} memberName={memberName} cfg={cfg} onChange={reload} onErr={setError} />
          )}
          {tab === 'members' && (
            <MembersView orgId={orgId} members={members} orders={orders} withdrawals={withdrawals} payouts={payouts} onOpen={setOpenOrder} />
          )}
          {tab === 'transactions' && <TransactionsTable ledger={ledger} orders={orders} memberName={memberName} />}
          {tab === 'reconciliation' && caps?.reconcile && <ReconciliationView orgId={orgId} onGo={setTab} />}
        </>
      )}

      {openOrder && (
        <OrderDrawer
          order={orders.find((o) => o.id === openOrder.id) ?? openOrder}
          orgBaseCurrency="NGN"
          memberName={memberName(openOrder.member_id)}
          onClose={() => setOpenOrder(null)}
          onChange={async () => { await reload() }}
        />
      )}
      {showRecord && (
        <RecordOrderModal
          orgId={orgId}
          members={members}
          onClose={() => setShowRecord(false)}
          onDone={async () => { setShowRecord(false); await reload() }}
        />
      )}
    </div>
  )
}

// ---------------- Overview ----------------

function Overview({
  orgId, orders, withdrawals, onGo,
}: { orgId: string; orders: FinanceOrder[]; withdrawals: WithdrawalRequest[]; onGo: (t: Tab) => void }) {
  const [ov, setOv] = useState<Awaited<ReturnType<typeof loadOrgOverview>> | null>(null)
  useEffect(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    loadOrgOverview(orgId, start, end).then(setOv).catch(() => setOv(null))
  }, [orgId])

  const na = ov?.needs_attention
  const attnTotal = na
    ? na.awaiting_settlement + na.settled_not_credited + na.withdrawals_awaiting_approval
      + na.withdrawals_awaiting_authorization + na.withdrawals_awaiting_payment
      + na.withdrawals_awaiting_confirmation + na.withdrawals_failed
    : 0
  return (
    <>
      <div className="fin-balances">
        <Card label="Member Wallet Liabilities" value={moneyList(ov?.member_wallet_liability)} tone="primary" />
        <Card label="Pending Platform Funds" value={moneyList(ov?.pending_platform)} tone="events" />
        <Card label="Pending Withdrawals" value={String(ov?.pending_withdrawals_count ?? '—')} />
        <Card label="Processing Payouts" value={String(ov?.processing_payouts_count ?? '—')} />
        <Card label="Paid This Month" value={moneyList(ov?.paid_in_period)} tone="ok" />
        <Card label="Failed Payouts" value={String(ov?.failed_payouts_count ?? '—')} />
      </div>

      <section className="fin-section">
        <h4 className="overview-heading">NEEDS ATTENTION</h4>
        {!na || attnTotal === 0 ? (
          <p className="empty-row">Nothing needs attention right now.</p>
        ) : (
          <ul className="fin-attn">
            {na.awaiting_settlement > 0 && <li><button type="button" onClick={() => onGo('orders')}>{na.awaiting_settlement} earning{na.awaiting_settlement === 1 ? '' : 's'} awaiting settlement</button></li>}
            {na.settled_not_credited > 0 && <li><button type="button" onClick={() => onGo('orders')}>{na.settled_not_credited} settled earning{na.settled_not_credited === 1 ? '' : 's'} not yet credited</button></li>}
            {na.withdrawals_awaiting_approval > 0 && <li><button type="button" onClick={() => onGo('withdrawals')}>{na.withdrawals_awaiting_approval} withdrawal{na.withdrawals_awaiting_approval === 1 ? '' : 's'} awaiting approval</button></li>}
            {na.withdrawals_awaiting_authorization > 0 && <li><button type="button" onClick={() => onGo('withdrawals')}>{na.withdrawals_awaiting_authorization} awaiting authorization for payment</button></li>}
            {na.withdrawals_awaiting_payment > 0 && <li><button type="button" onClick={() => onGo('withdrawals')}>{na.withdrawals_awaiting_payment} authorized — payment to be recorded</button></li>}
            {na.withdrawals_awaiting_confirmation > 0 && <li><button type="button" onClick={() => onGo('withdrawals')}>{na.withdrawals_awaiting_confirmation} payment{na.withdrawals_awaiting_confirmation === 1 ? '' : 's'} awaiting confirmation</button></li>}
            {na.withdrawals_failed > 0 && <li><button type="button" onClick={() => onGo('withdrawals')}>{na.withdrawals_failed} failed payout{na.withdrawals_failed === 1 ? '' : 's'} to resolve</button></li>}
          </ul>
        )}
      </section>

      <section className="fin-section">
        <h4 className="overview-heading">LATEST ORDERS</h4>
        <MiniOrders orders={orders.slice(0, 6)} />
      </section>
      <section className="fin-section">
        <h4 className="overview-heading">LATEST WITHDRAWALS</h4>
        {withdrawals.length === 0 ? <p className="empty-row">None yet.</p> : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Ref</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{withdrawals.slice(0, 6).map((w) => (
              <tr key={w.id}><td>{w.reference}</td><td>{money(w.amount, w.currency)}</td><td><WithdrawalStatusPill status={w.status} /></td><td className="cell-dim">{new Date(w.created_at).toLocaleDateString()}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  )
}

function MiniOrders({ orders }: { orders: FinanceOrder[] }) {
  if (orders.length === 0) return <p className="empty-row">No orders recorded yet.</p>
  return (
    <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Project</th><th>Platform</th><th>Gross</th><th>Status</th></tr></thead>
      <tbody>{orders.map((o) => (
        <tr key={o.id}><td>{o.title}</td><td className="cell-dim">{o.platform}</td><td>{money(o.gross_amount, o.currency)}</td><td><OrderStatusPill status={o.status} /></td></tr>
      ))}</tbody>
    </table></div>
  )
}

function Card({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'events' | 'primary' }) {
  const color = tone === 'ok' ? 'var(--tint-ok)' : tone === 'events' ? 'var(--tint-events)' : tone === 'primary' ? 'var(--tint-primary)' : undefined
  return (
    <div className="kpi">
      <div className="kpi-top"><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color, fontSize: 18 }}>{value}</div>
    </div>
  )
}

// ---------------- Orders ----------------

function OrdersTable({
  orders, memberName, onOpen,
}: { orders: FinanceOrder[]; memberName: (id: string) => string; onOpen: (o: FinanceOrder) => void }) {
  const [status, setStatus] = useState<string>('all')
  const list = status === 'all' ? orders : orders.filter((o) => o.status === status)
  return (
    <>
      <div className="view-tabs" style={{ marginBottom: 12 }}>
        {['all', 'order_received', 'pending_settlement', 'settled', 'available', 'paid', 'cancelled'].map((s) => (
          <button key={s} type="button" className={`view-tab ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="empty-row">No orders recorded yet.</p>
      ) : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Member</th><th>Platform</th><th>Project</th><th>Gross</th><th>Settlement</th><th>Available</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o)}>
                <td>{memberName(o.member_id)}</td>
                <td className="cell-dim">{o.platform}</td>
                <td>{o.title}</td>
                <td>{money(o.gross_amount, o.currency)}</td>
                <td className="cell-dim">{o.settled_amount != null ? money(o.settled_amount, o.settlement_currency ?? o.currency) : '—'}</td>
                <td>{o.available_amount != null ? money(o.available_amount, o.available_currency ?? o.currency) : '—'}</td>
                <td><OrderStatusPill status={o.status} /></td>
                <td className="cell-dim">{new Date(o.order_date).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ---------------- Order drawer: the 5-step settlement flow ----------------

function OrderDrawer({
  order, orgBaseCurrency, memberName, onClose, onChange,
}: { order: FinanceOrder; orgBaseCurrency: string; memberName: string; onClose: () => void; onChange: () => Promise<void> }) {
  const [charges, setCharges] = useState<FinanceCharge[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const reloadCharges = useCallback(() => listCharges(order.id).then(setCharges), [order.id])
  useEffect(() => { reloadCharges() }, [reloadCharges])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try { await fn(); await onChange(); await reloadCharges() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Action failed.') }
    finally { setBusy(false) }
  }

  const locked = order.credited_at != null || order.status === 'cancelled'
  const preview = previewCredit(order, charges)

  return (
    <div className="drawer-overlay open" onClick={onClose}>
      <div className="drawer open" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        <div className="drawer-head"><div><h3>{order.title}</h3><p>{memberName} · {order.platform} · {new Date(order.order_date).toLocaleDateString()}</p></div></div>
        <div style={{ marginBottom: 16 }}><OrderStatusPill status={order.status} /></div>
        {err && <p className="form-error">{err}</p>}

        <Step n={1} title="Order details">
          <OrderBreakdown order={order} charges={charges} />
        </Step>

        <Step n={2} title="Platform settlement">
          {order.settled_amount != null ? (
            <p className="md-muted">Settled {money(order.settled_amount, order.settlement_currency ?? order.currency)} on {order.settled_on ? new Date(order.settled_on).toLocaleDateString() : '—'} (deduction {money(order.platform_deduction ?? 0, order.currency)}).</p>
          ) : locked ? <p className="md-muted">—</p> : (
            <SettlementForm order={order} busy={busy} onSubmit={(v) => run(() => recordSettlement({ orderId: order.id, ...v }))} />
          )}
        </Step>

        <Step n={3} title="Currency conversion">
          {order.settled_amount == null ? <p className="md-muted">Record the settlement first.</p> : order.converted ? (
            <>
              <p className="md-muted">1 {order.from_currency} = {order.exchange_rate} {order.to_currency} → {money(order.converted_amount ?? 0, order.to_currency ?? '')} on {order.conversion_date ? new Date(order.conversion_date).toLocaleDateString() : '—'}</p>
              {!locked && <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(() => clearConversion(order.id))}>Clear conversion</button>}
            </>
          ) : locked ? <p className="md-muted">No conversion.</p> : (
            <ConversionForm order={order} baseCurrency={orgBaseCurrency} busy={busy}
              onSubmit={(v) => run(() => recordConversion({ orderId: order.id, ...v }))} />
          )}
        </Step>

        <Step n={4} title="Charges">
          {charges.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {charges.map((c) => (
                <div className="fin-row" key={c.id}>
                  <span className={c.voided ? 'md-muted' : undefined} style={{ textDecoration: c.voided ? 'line-through' : undefined }}>
                    {CHARGE_TYPE_LABEL[c.charge_type] ?? c.charge_type} · {money(c.amount, c.currency)}
                  </span>
                  {!c.voided && !locked && (
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
                      const reason = prompt('Reason for voiding this charge?') ?? ''
                      if (reason) run(() => voidCharge(c.id, reason))
                    }}>Void</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {order.settled_amount != null && !locked && (
            <ChargeForm order={order} busy={busy} onSubmit={(v) => run(() => addCharge({ orderId: order.id, ...v }))} />
          )}
        </Step>

        <Step n={5} title="Final member credit">
          {order.credited_at ? (
            <p className="md-muted">Credited {money(order.available_amount ?? 0, order.available_currency ?? '')} on {new Date(order.credited_at).toLocaleDateString()}.</p>
          ) : order.settled_amount == null ? <p className="md-muted">Settle the order first.</p> : (
            <>
              {preview && (
                <div className="fin-breakdown" style={{ marginBottom: 12 }}>
                  <div className="fin-row"><span className="md-muted">Base ({preview.baseCurrency})</span><span>{money(preview.base, preview.baseCurrency)}</span></div>
                  <div className="fin-row"><span className="md-muted">Charges</span><span>− {money(preview.chargeTotal, preview.baseCurrency)}</span></div>
                  <div className="fin-row fin-row-total"><span>Member available credit</span><span style={{ fontSize: 16, fontWeight: 700 }}>{money(preview.final, preview.baseCurrency)}</span></div>
                </div>
              )}
              <button type="button" disabled={busy || !!preview?.currencyMismatch} onClick={() => run(() => creditAvailable(order.id))}>
                Confirm & credit member
              </button>
            </>
          )}
        </Step>

        {!locked && order.status !== 'cancelled' && order.credited_at == null && (
          <button type="button" className="btn-ghost" style={{ marginTop: 16 }} disabled={busy} onClick={() => {
            const reason = prompt('Reason for cancelling this order?') ?? ''
            if (reason) run(() => cancelOrder(order.id, reason))
          }}>Cancel order</button>
        )}
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="fin-step">
      <h4>{n}. {title}</h4>
      {children}
    </div>
  )
}

function SettlementForm({ order, busy, onSubmit }: {
  order: FinanceOrder; busy: boolean
  onSubmit: (v: { platformDeduction: number; settledAmount: number; settledOn: string; settlementCurrency?: string }) => void
}) {
  const [deduction, setDeduction] = useState('0')
  const [settled, setSettled] = useState(String(order.gross_amount))
  const [on, setOn] = useState(localDateString())
  const [ccy, setCcy] = useState(order.currency)
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ platformDeduction: Number(deduction), settledAmount: Number(settled), settledOn: on, settlementCurrency: ccy }) }}>
      <div className="field-row">
        <label>Platform deduction<input type="number" min="0" step="0.01" value={deduction} onChange={(e) => setDeduction(e.target.value)} /></label>
        <label>Net settled amount<input type="number" min="0" step="0.01" value={settled} onChange={(e) => setSettled(e.target.value)} /></label>
      </div>
      <div className="field-row">
        <label>Settlement currency
          <select value={ccy} onChange={(e) => setCcy(e.target.value)}>{COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>Settlement date<input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
      <button type="submit" disabled={busy}>Record settlement</button>
    </form>
  )
}

function ConversionForm({ order, baseCurrency, busy, onSubmit }: {
  order: FinanceOrder; baseCurrency: string; busy: boolean
  onSubmit: (v: { fromCurrency: string; toCurrency: string; rate: number; conversionDate: string }) => void
}) {
  const [from] = useState(order.settlement_currency ?? order.currency)
  const [to, setTo] = useState(baseCurrency)
  const [rate, setRate] = useState('')
  const [on, setOn] = useState(localDateString())
  const converted = Number(order.settled_amount ?? 0) * Number(rate || 0)
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ fromCurrency: from, toCurrency: to, rate: Number(rate), conversionDate: on }) }}>
      <div className="field-row">
        <label>From<input value={from} disabled /></label>
        <label>To<select value={to} onChange={(e) => setTo(e.target.value)}>{COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>
      <div className="field-row">
        <label>Exchange rate used<input type="number" min="0" step="0.000001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="1500" /></label>
        <label>Conversion date<input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
      {Number(rate) > 0 && <p className="md-muted" style={{ fontSize: 12 }}>{money(Number(order.settled_amount ?? 0), from)} × {rate} = {money(Math.round(converted * 100) / 100, to)}</p>}
      <button type="submit" disabled={busy || !(Number(rate) > 0)}>Record conversion</button>
    </form>
  )
}

function ChargeForm({ order, busy, onSubmit }: {
  order: FinanceOrder; busy: boolean
  onSubmit: (v: { type: string; amount: number; currency: string; description?: string; chargeDate?: string }) => void
}) {
  const defCcy = order.converted ? order.to_currency ?? order.currency : order.settlement_currency ?? order.currency
  const [type, setType] = useState('platform_fee')
  const [amount, setAmount] = useState('')
  const [ccy, setCcy] = useState(defCcy)
  const [desc, setDesc] = useState('')
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (Number(amount) >= 0) onSubmit({ type, amount: Number(amount), currency: ccy, description: desc || undefined }) }}>
      <div className="field-row">
        <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(CHARGE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Currency<select value={ccy} onChange={(e) => setCcy(e.target.value)}>{COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>
      <label>Description (optional)<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <button type="submit" disabled={busy || amount === ''}>Add charge</button>
    </form>
  )
}

// ---------------- Withdrawals queue ----------------

const WD_FILTERS: { key: string; label: string; match: (w: WithdrawalRequest) => boolean }[] = [
  { key: 'needs_approval', label: 'Needs approval', match: (w) => w.status === 'requested' || w.status === 'under_review' },
  { key: 'needs_authorization', label: 'Needs authorization', match: (w) => w.status === 'approved' },
  { key: 'needs_payment', label: 'Awaiting payment', match: (w) => w.status === 'authorized_for_payment' },
  { key: 'needs_confirmation', label: 'Awaiting confirmation', match: (w) => w.status === 'payment_recorded' },
  { key: 'failed', label: 'Failed', match: (w) => w.status === 'failed' },
  { key: 'paid', label: 'Paid', match: (w) => w.status === 'paid' },
  { key: 'closed', label: 'Rejected / Cancelled', match: (w) => w.status === 'rejected' || w.status === 'cancelled' || w.status === 'reversed' },
  { key: 'all', label: 'All', match: () => true },
]

function WithdrawalsQueue({
  withdrawals, memberName, cfg, onChange, onErr,
}: {
  withdrawals: WithdrawalRequest[]; memberName: (id: string) => string
  cfg: OrgFinanceConfig; onChange: () => void; onErr: (m: string) => void
}) {
  const [filter, setFilter] = useState('needs_approval')
  const [busy, setBusy] = useState(false)
  const [payFor, setPayFor] = useState<WithdrawalRequest | null>(null)
  const caps = cfg.viewer_capabilities
  const f = WD_FILTERS.find((x) => x.key === filter) ?? WD_FILTERS[0]
  const list = withdrawals.filter(f.match)
  const restricted = cfg.finance_status !== 'active'

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); onChange() } catch (e) { onErr(e instanceof Error ? e.message : 'Action failed.') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="view-tabs" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {WD_FILTERS.map((x) => (
          <button key={x.key} type="button" className={`view-tab ${filter === x.key ? 'active' : ''}`} onClick={() => setFilter(x.key)}>
            {x.label} · {withdrawals.filter(x.match).length}
          </button>
        ))}
      </div>

      {list.length === 0 ? <p className="empty-row">Nothing here.</p> : list.map((w) => {
        const dest = w.payout_snapshot
        const tail = dest?.masked_account_number
          ?? (dest?.account_number ? '••••' + dest.account_number.slice(-4) : null)
        return (
          <div className="fin-wd" key={w.id} style={{ flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <strong>{memberName(w.member_id)}</strong> · {money(w.amount, w.currency)} · <span className="md-muted">{w.reference}</span>
              <div className="md-muted" style={{ fontSize: 12 }}>
                Requested {new Date(w.created_at).toLocaleString()} · Available before {w.available_before != null ? money(w.available_before, w.currency) : '—'}
                {dest ? ` · ${dest.bank_name ?? 'Bank'} ${tail ?? ''} · ${dest.account_name ?? ''}` : ''}
              </div>
              <div className="md-muted" style={{ fontSize: 12 }}>
                Approvals {w.approvals_count}/{w.approvals_required}
                {w.authorized_at ? ` · authorized ${new Date(w.authorized_at).toLocaleDateString()}` : ''}
                {w.payment_recorded_at ? ` · payment recorded ${new Date(w.payment_recorded_at).toLocaleDateString()}` : ''}
                {w.failure_reason ? ` · ${w.failure_reason}` : ''}
              </div>
              {w.member_note && <div className="md-muted" style={{ fontSize: 12 }}>“{w.member_note}”</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <WithdrawalStatusPill status={w.status} />

              {(w.status === 'requested' || w.status === 'under_review') && caps.approve && <>
                <button type="button" disabled={busy} onClick={() => act(() => reviewWithdrawal(w.id, 'approve'))}>
                  {w.approvals_count + 1 >= w.approvals_required ? 'Approve' : `Approve (${w.approvals_count + 1}/${w.approvals_required})`}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
                  const r = prompt('Reason for rejecting?') ?? ''
                  if (r) act(() => reviewWithdrawal(w.id, 'reject', r))
                }}>Reject</button>
              </>}

              {w.status === 'approved' && caps.authorize && (
                <button type="button" disabled={busy || restricted} onClick={() => act(() => authorizeWithdrawal(w.id))}>
                  Authorize for payment
                </button>
              )}

              {w.status === 'authorized_for_payment' && cfg.automation_available && caps.initiate_payout && (
                <button type="button" disabled={busy || restricted} onClick={() => act(() => sendPayout(w.id))}>Send payout</button>
              )}
              {w.status === 'authorized_for_payment' && caps.record_payment && (
                <button
                  type="button"
                  className={cfg.automation_available && caps.initiate_payout ? 'btn-ghost' : ''}
                  disabled={busy || restricted}
                  onClick={() => setPayFor(w)}
                >
                  Record payment{cfg.automation_available ? ' (manual)' : ''}
                </button>
              )}

              {w.status === 'payment_recorded' && caps.confirm_payment && (
                <button type="button" disabled={busy} onClick={() => act(() => confirmWithdrawalPayment(w.id))}>Confirm payment</button>
              )}

              {(w.status === 'authorized_for_payment' || w.status === 'payment_recorded' || w.status === 'failed') && caps.record_payment && <>
                {w.status === 'failed' && <button type="button" disabled={busy || restricted} onClick={() => setPayFor(w)}>Retry payment</button>}
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
                  const r = prompt('Mark this payment as failed — reason?') ?? ''
                  if (!r) return
                  const back = confirm('Return the reserved funds to the member now? Cancel = keep held for a retry.')
                  act(() => failWithdrawal(w.id, r, back))
                }}>Mark failed</button>
              </>}

              {w.status === 'paid' && caps.reconcile && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
                  const r = prompt('Reverse this paid withdrawal — reason? (funds return to the member)') ?? ''
                  if (r) act(() => reverseWithdrawal(w.id, r))
                }}>Reverse</button>
              )}
            </div>
          </div>
        )
      })}

      {payFor && (
        <RecordPaymentModal
          withdrawal={payFor}
          onClose={() => setPayFor(null)}
          onDone={() => { setPayFor(null); onChange() }}
          onErr={onErr}
        />
      )}
    </>
  )
}

function RecordPaymentModal({
  withdrawal, onClose, onDone, onErr,
}: { withdrawal: WithdrawalRequest; onClose: () => void; onDone: () => void; onErr: (m: string) => void }) {
  const w = withdrawal
  const [channel, setChannel] = useState<FinancePaymentChannel>('office_bank_transfer')
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  const [bankOrProvider, setBankOrProvider] = useState(w.payout_snapshot?.bank_name ?? '')
  const [paymentDate, setPaymentDate] = useState(localDateString())
  const [proofUrl, setProofUrl] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!reference.trim()) { onErr('A transaction reference is required.'); return }
    setBusy(true)
    try {
      await recordWithdrawalPayment({
        withdrawalId: w.id, channel, method: method.trim() || undefined, reference: reference.trim(),
        paymentDate: new Date(paymentDate).toISOString(), bankOrProvider: bankOrProvider.trim() || undefined,
        proofUrl: proofUrl.trim() || undefined, note: note.trim() || undefined,
      })
      onDone()
    } catch (e2) { onErr(e2 instanceof Error ? e2.message : 'Could not record the payment.'); setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <h2>Record payment</h2>
          <p className="md-muted" style={{ fontSize: 13 }}>
            {w.reference} · approved amount <strong>{money(w.amount, w.currency)}</strong>
            {w.payout_snapshot ? ` · ${w.payout_snapshot.bank_name ?? ''} ${w.payout_snapshot.masked_account_number ?? ''} · ${w.payout_snapshot.account_name ?? ''}` : ''}
          </p>
          <div className="field-row">
            <label>Payment method
              <select value={channel} onChange={(e) => setChannel(e.target.value as FinancePaymentChannel)}>
                {(['office_bank_transfer', 'provider_transfer', 'other'] as FinancePaymentChannel[]).map((c) => (
                  <option key={c} value={c}>{PAYMENT_CHANNEL_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label>Payment date<input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label>Transaction reference<input value={reference} onChange={(e) => setReference(e.target.value)} required placeholder="Bank / provider reference" /></label>
            <label>Bank / provider (optional)<input value={bankOrProvider} onChange={(e) => setBankOrProvider(e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label>Method detail (optional)<input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. NIP transfer" /></label>
            <label>Proof URL (optional)<input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://…" /></label>
          </div>
          <label>Internal note (optional)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ReconciliationView({ orgId, onGo }: { orgId: string; onGo: (t: Tab) => void }) {
  const [r, setR] = useState<FinanceReconciliation | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { loadReconciliation(orgId).then(setR).catch((e) => setErr(e.message)) }, [orgId])
  if (err) return <p className="form-error">{err}</p>
  if (!r) return <p className="empty-row">Loading…</p>

  const rows: { label: string; n: number; hint: string; go?: Tab }[] = [
    { label: 'Authorized > 48h without payment', n: r.stuck_authorized, hint: 'Payment authorized but not yet recorded', go: 'withdrawals' },
    { label: 'Payments awaiting confirmation', n: r.awaiting_confirmation, hint: 'Recorded but not confirmed as paid', go: 'withdrawals' },
    { label: 'Failed payouts', n: r.failed, hint: 'A payment attempt failed and is unresolved', go: 'withdrawals' },
    { label: 'Settled earnings not credited', n: r.settled_not_credited, hint: 'Settlement recorded, member not yet credited', go: 'orders' },
    { label: 'Duplicate payment references', n: r.duplicate_payment_refs, hint: 'Same transaction reference used more than once' },
    { label: 'Negative member balances', n: r.negative_balances, hint: 'A member/currency ledger sums below zero — investigate' },
    { label: 'Paid without a payout record', n: r.paid_without_payout_row, hint: 'Marked paid but no finance_payouts row exists' },
  ]
  const clean = rows.every((x) => x.n === 0)

  return (
    <>
      <p className="md-muted" style={{ marginBottom: 12 }}>
        Compares Bizzlivo's records against the withdrawal workflow. Nothing here changes money — it flags divergence for a person to resolve.
      </p>
      {clean ? <p className="empty-row">Everything reconciles. No open discrepancies.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Check</th><th style={{ textAlign: 'right' }}>Count</th><th>What it means</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.label} style={{ cursor: x.go ? 'pointer' : undefined }} onClick={() => x.go && onGo(x.go)}>
                <td>{x.label}</td>
                <td style={{ textAlign: 'right', color: x.n > 0 ? 'var(--tint-attn)' : 'var(--tint-ok)', fontWeight: 700 }}>{x.n}</td>
                <td className="cell-dim">{x.hint}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ---------------- Members ----------------

function MembersView({
  members, orders, withdrawals, payouts, onOpen,
}: {
  orgId: string; members: Profile[]; orders: FinanceOrder[]
  withdrawals: WithdrawalRequest[]; payouts: FinancePayout[]; onOpen: (o: FinanceOrder) => void
}) {
  const [sel, setSel] = useState<string>('')
  const withFinance = members.filter((m) => orders.some((o) => o.member_id === m.id) || withdrawals.some((w) => w.member_id === m.id))
  const list = withFinance.length ? withFinance : members
  const member = list.find((m) => m.id === sel)

  const mOrders = orders.filter((o) => o.member_id === sel)
  const mWd = withdrawals.filter((w) => w.member_id === sel)
  const mPaid = payouts.filter((p) => p.member_id === sel)

  return (
    <div className="fin-members">
      <div className="fin-members-list">
        {list.map((m) => (
          <button key={m.id} type="button" className={`fin-member-row ${sel === m.id ? 'active' : ''}`} onClick={() => setSel(m.id)}>{m.full_name}</button>
        ))}
      </div>
      <div className="fin-members-detail">
        {!member ? <p className="empty-row">Select a member.</p> : (
          <>
            <h3>{member.full_name}</h3>
            <div className="fin-balances" style={{ marginTop: 12 }}>
              <Card label="Lifetime Gross" value={moneyList(byCcy(mOrders.filter((o) => o.status !== 'cancelled').map((o) => ({ currency: o.currency, amount: o.gross_amount }))))} />
              <Card label="Available Credit" value={moneyList(byCcy(mOrders.filter((o) => o.available_amount != null).map((o) => ({ currency: o.available_currency ?? o.currency, amount: o.available_amount ?? 0 }))))} tone="ok" />
              <Card label="Pending Withdrawal" value={moneyList(byCcy(mWd.filter((w) => ['requested', 'approved', 'processing'].includes(w.status)).map((w) => ({ currency: w.currency, amount: w.amount }))))} tone="primary" />
              <Card label="Total Paid" value={moneyList(byCcy(mPaid.map((p) => ({ currency: p.currency, amount: p.amount_paid }))))} />
            </div>
            <h4 className="overview-heading" style={{ marginTop: 20 }}>ORDERS</h4>
            <MiniOrdersClickable orders={mOrders} onOpen={onOpen} />
            <h4 className="overview-heading" style={{ marginTop: 16 }}>WITHDRAWALS</h4>
            {mWd.length === 0 ? <p className="empty-row">None.</p> : (
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Ref</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
                <tbody>{mWd.map((w) => <tr key={w.id}><td>{w.reference}</td><td>{money(w.amount, w.currency)}</td><td><WithdrawalStatusPill status={w.status} /></td><td className="cell-dim">{new Date(w.created_at).toLocaleDateString()}</td></tr>)}</tbody>
              </table></div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MiniOrdersClickable({ orders, onOpen }: { orders: FinanceOrder[]; onOpen: (o: FinanceOrder) => void }) {
  if (orders.length === 0) return <p className="empty-row">No orders.</p>
  return (
    <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Project</th><th>Gross</th><th>Available</th><th>Status</th></tr></thead>
      <tbody>{orders.map((o) => (
        <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o)}>
          <td>{o.title}</td><td>{money(o.gross_amount, o.currency)}</td>
          <td>{o.available_amount != null ? money(o.available_amount, o.available_currency ?? o.currency) : '—'}</td>
          <td><OrderStatusPill status={o.status} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

function byCcy(rows: { currency: string; amount: number }[]) {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? 0) + Number(r.amount))
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount }))
}

// ---------------- Transactions ----------------

function TransactionsTable({
  ledger, orders, memberName,
}: { ledger: FinanceLedgerEntry[]; orders: FinanceOrder[]; memberName: (id: string) => string }) {
  if (ledger.length === 0) return <p className="empty-row">No ledger activity yet.</p>
  return (
    <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Detail</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
      <tbody>
        {ledger.map((t) => (
          <tr key={t.id}>
            <td className="cell-dim">{new Date(t.created_at).toLocaleDateString()}</td>
            <td>{memberName(t.member_id)}</td>
            <td>{LEDGER_TYPE_LABEL[t.entry_type] ?? t.entry_type}</td>
            <td className="cell-dim">{(t.order_id && orders.find((o) => o.id === t.order_id)?.title) || t.note || '—'}</td>
            <td style={{ textAlign: 'right', color: Number(t.amount) < 0 ? 'var(--tint-attn)' : undefined }}>
              {Number(t.amount) === 0 ? '—' : money(Number(t.amount), t.currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  )
}

// ---------------- Record order modal ----------------

function RecordOrderModal({
  orgId, members, onClose, onDone,
}: { orgId: string; members: Profile[]; onClose: () => void; onDone: () => void }) {
  const [memberId, setMemberId] = useState('')
  const [platform, setPlatform] = useState('')
  const [title, setTitle] = useState('')
  const [reference, setReference] = useState('')
  const [orderDate, setOrderDate] = useState(localDateString())
  const [gross, setGross] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [description, setDescription] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!memberId || !platform.trim() || !title.trim() || !(Number(gross) >= 0)) { setErr('Fill in member, platform, project and gross amount.'); return }
    setBusy(true); setErr(null)
    try {
      await recordOrder({
        orgId, memberId, platform: platform.trim(), title: title.trim(), orderDate,
        gross: Number(gross), currency, reference: reference || undefined,
        description: description || undefined, proofUrl: proofUrl || undefined,
      })
      onDone()
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not record the order.'); setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <h2>Record order</h2>
          <label>Member
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
              <option value="">— Select —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <div className="field-row">
            <label>Platform<input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Fiverr" required /></label>
            <label>Order / project title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Logo Design" required /></label>
          </div>
          <div className="field-row">
            <label>Gross amount<input type="number" min="0" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} required /></label>
            <label>Currency<select value={currency} onChange={(e) => setCurrency(e.target.value)}>{COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Order date<input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label>Order reference (optional)<input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <label>Proof / reference URL (optional)<input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://…" /></label>
          </div>
          <label>Description (optional)<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          {err && <p className="form-error">{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record order'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
