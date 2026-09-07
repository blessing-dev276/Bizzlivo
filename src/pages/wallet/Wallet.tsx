import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { localDateString } from '../../lib/date'
import { useAuth } from '../../lib/AuthContext'
import type {
  FinanceCharge,
  FinanceLedgerEntry,
  FinanceMemberBalances,
  FinanceOrder,
  IncomeDevelopmentIncomeEntry,
  MemberPayoutAccount,
  WithdrawalRequest,
} from '../../types/database'
import {
  LEDGER_TYPE_LABEL,
  loadMemberBalances,
  listCharges,
  listLedger,
  listOrders,
  listPayoutAccounts,
  listWithdrawals,
  listNigerianBanks,
  resolveBankAccount,
  money,
  moneyList,
  requestWithdrawal,
  cancelWithdrawal,
  type NigerianBank,
} from '../../lib/finance'
import { OrderBreakdown, OrderStatusPill, WithdrawalStatusPill } from '../finance/shared'

type TxFilter = 'all' | 'order_recorded' | 'settlement' | 'available_credit' | 'charge' | 'withdrawal' | 'payout'

const FILTERS: { key: TxFilter; label: string; match: (t: FinanceLedgerEntry) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'order_recorded', label: 'Orders', match: (t) => t.entry_type === 'order_recorded' },
  { key: 'settlement', label: 'Settlements', match: (t) => t.entry_type === 'settlement' || t.entry_type === 'conversion' },
  { key: 'available_credit', label: 'Credits', match: (t) => t.entry_type === 'available_credit' },
  { key: 'charge', label: 'Charges', match: (t) => t.entry_type === 'charge' || t.entry_type === 'charge_reversal' },
  { key: 'withdrawal', label: 'Withdrawals', match: (t) => t.entry_type === 'withdrawal_reserve' || t.entry_type === 'withdrawal_release' },
  { key: 'payout', label: 'Payouts', match: (t) => t.entry_type === 'payout' },
]

export default function Wallet() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const userId = profile?.id

  const [balances, setBalances] = useState<FinanceMemberBalances | null>(null)
  const [orders, setOrders] = useState<FinanceOrder[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [ledger, setLedger] = useState<FinanceLedgerEntry[]>([])
  const [accounts, setAccounts] = useState<MemberPayoutAccount[]>([])
  const [personal, setPersonal] = useState<IncomeDevelopmentIncomeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filter, setFilter] = useState<TxFilter>('all')
  const [detail, setDetail] = useState<{ order: FinanceOrder; charges: FinanceCharge[] } | null>(null)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showPersonal, setShowPersonal] = useState(false)

  const reload = useCallback(async () => {
    if (!orgId || !userId) return
    setLoading(true)
    try {
      const [b, o, w, l, a, p] = await Promise.all([
        loadMemberBalances(orgId, userId),
        listOrders(orgId, { memberId: userId }),
        listWithdrawals(orgId, { memberId: userId }),
        listLedger(orgId, { memberId: userId }),
        listPayoutAccounts(orgId, userId),
        supabase.from('income_development_income_entries').select('*').eq('org_id', orgId).eq('user_id', userId).order('earned_on', { ascending: false }),
      ])
      setBalances(b); setOrders(o); setWithdrawals(w); setLedger(l); setAccounts(a)
      setPersonal((p.data as IncomeDevelopmentIncomeEntry[]) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your wallet.')
    }
    setLoading(false)
  }, [orgId, userId])

  useEffect(() => { reload() }, [reload])

  const visibleTx = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
    return ledger.filter(f.match)
  }, [ledger, filter])

  const availableList = balances?.available ?? []
  const canWithdraw = availableList.some((r) => Number(r.amount) > 0)

  async function openDetail(order: FinanceOrder) {
    const charges = await listCharges(order.id)
    setDetail({ order, charges })
  }

  if (loading) return <div className="page"><h1>My Wallet</h1><p className="empty-row">Loading…</p></div>

  return (
    <div className="page fin">
      <div className="lc-head">
        <h1>My Wallet</h1>
        <p>Every amount here is a verified office earning — you can trace exactly where it came from, what was deducted, and what became available.</p>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="fin-balances">
        <Balance label="Available to Withdraw" value={moneyList(availableList)} tone="ok" />
        <Balance label="Pending Platform Funds" value={moneyList(balances?.pending_platform)} tone="events" />
        <Balance label="Pending Withdrawal" value={moneyList(balances?.pending_withdrawal)} tone="primary" />
        <Balance label="Total Paid Out" value={moneyList(balances?.total_paid_out)} />
        <Balance label="Lifetime Earnings" value={moneyList(balances?.lifetime_gross)} />
      </div>

      {canWithdraw && (
        <button type="button" className="md-btn" style={{ marginTop: 4 }} onClick={() => setShowWithdraw(true)}>
          Request Withdrawal
        </button>
      )}

      <section className="fin-section">
        <h4 className="overview-heading">RECENT EARNINGS</h4>
        {orders.length === 0 ? (
          <p className="empty-row">No verified earnings yet. Your office earnings appear here once an admin records an order.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Project</th><th>Platform</th><th>Gross</th><th>Status</th><th /></tr></thead>
              <tbody>
                {orders.slice(0, 12).map((o) => (
                  <tr key={o.id}>
                    <td>{o.title}</td>
                    <td className="cell-dim">{o.platform}</td>
                    <td>{money(o.gross_amount, o.currency)}</td>
                    <td><OrderStatusPill status={o.status} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn-ghost" onClick={() => openDetail(o)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fin-section">
        <h4 className="overview-heading">WITHDRAWALS</h4>
        {withdrawals.length === 0 ? (
          <p className="empty-row">No withdrawal requests yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Request #</th><th>Amount</th><th>Status</th><th>Requested</th><th /></tr></thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td>{w.reference}</td>
                    <td>{money(w.amount, w.currency)}</td>
                    <td><WithdrawalStatusPill status={w.status} /></td>
                    <td className="cell-dim">{new Date(w.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      {w.status === 'requested' && (
                        <button type="button" className="btn-ghost" onClick={async () => {
                          if (!confirm('Cancel this withdrawal request? The funds return to your available balance.')) return
                          try { await cancelWithdrawal(w.id); await reload() }
                          catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel.') }
                        }}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fin-section">
        <h4 className="overview-heading">TRANSACTION HISTORY</h4>
        <div className="view-tabs" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`view-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        {visibleTx.length === 0 ? (
          <p className="empty-row">Nothing here yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Detail</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {visibleTx.map((t) => {
                  const order = t.order_id ? orders.find((o) => o.id === t.order_id) : null
                  return (
                    <tr key={t.id} style={{ cursor: order ? 'pointer' : undefined }} onClick={() => order && openDetail(order)}>
                      <td className="cell-dim">{new Date(t.created_at).toLocaleDateString()}</td>
                      <td>{LEDGER_TYPE_LABEL[t.entry_type] ?? t.entry_type}</td>
                      <td className="cell-dim">{order?.title ?? t.note ?? '—'}</td>
                      <td style={{ textAlign: 'right', color: Number(t.amount) < 0 ? 'var(--tint-attn)' : undefined }}>
                        {Number(t.amount) === 0 ? '—' : money(Number(t.amount), t.currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fin-section">
        <h4 className="overview-heading">PAYOUT ACCOUNTS</h4>
        <PayoutAccounts orgId={orgId!} userId={userId!} accounts={accounts} onChange={reload} />
      </section>

      <section className="fin-section">
        <button type="button" className="btn-ghost" onClick={() => setShowPersonal((v) => !v)}>
          {showPersonal ? '▾' : '▸'} Personal income log
        </button>
        {showPersonal && (
          <PersonalIncome orgId={orgId!} userId={userId!} entries={personal} onChange={reload} />
        )}
      </section>

      {detail && (
        <div className="drawer-overlay open" onClick={() => setDetail(null)}>
          <div className="drawer open" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setDetail(null)}>✕</button>
            <div className="drawer-head"><div><h3>{detail.order.title}</h3><p>{detail.order.platform} · {new Date(detail.order.order_date).toLocaleDateString()}</p></div></div>
            <div style={{ marginBottom: 16 }}><OrderStatusPill status={detail.order.status} /></div>
            <OrderBreakdown order={detail.order} charges={detail.charges} />
            {detail.order.proof_url && (
              <p style={{ marginTop: 14 }}><a href={detail.order.proof_url} target="_blank" rel="noreferrer" className="md-btn ghost sm">Open proof / reference</a></p>
            )}
          </div>
        </div>
      )}

      {showWithdraw && (
        <WithdrawModal
          orgId={orgId!}
          available={availableList}
          accounts={accounts}
          onClose={() => setShowWithdraw(false)}
          onDone={async () => { setShowWithdraw(false); await reload() }}
        />
      )}
    </div>
  )
}

function Balance({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'events' | 'primary' }) {
  const color = tone === 'ok' ? 'var(--tint-ok)' : tone === 'events' ? 'var(--tint-events)' : tone === 'primary' ? 'var(--tint-primary)' : undefined
  return (
    <div className="kpi">
      <div className="kpi-top"><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color, fontSize: 18 }}>{value}</div>
    </div>
  )
}

function WithdrawModal({
  orgId, available, accounts, onClose, onDone,
}: {
  orgId: string
  available: { currency: string; amount: number }[]
  accounts: MemberPayoutAccount[]
  onClose: () => void
  onDone: () => void
}) {
  const usable = available.filter((r) => Number(r.amount) > 0)
  const [currency, setCurrency] = useState(usable[0]?.currency ?? 'NGN')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Bank Transfer')
  const [accountId, setAccountId] = useState(accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const avail = Number(usable.find((r) => r.currency === currency)?.amount ?? 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!(value > 0)) { setErr('Enter an amount greater than zero.'); return }
    if (value > avail) { setErr(`You can request at most ${money(avail, currency)}.`); return }
    setBusy(true); setErr(null)
    try {
      await requestWithdrawal({ orgId, amount: value, currency, method, accountId: accountId || undefined, note: note || undefined })
      onDone()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not submit the request.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <h2>Request withdrawal</h2>
          <div className="field-row">
            <label>Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {usable.map((r) => <option key={r.currency} value={r.currency}>{r.currency}</option>)}
              </select>
            </label>
            <label>Amount
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(avail)} />
            </label>
          </div>
          <p className="md-muted" style={{ fontSize: 12 }}>Available: {money(avail, currency)}</p>
          <label>Payment method
            <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bank Transfer" />
          </label>
          <label>Payout account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— None on file —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name} · {a.account_number}</option>)}
            </select>
          </label>
          <label>Note (optional)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {err && <p className="form-error">{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PayoutAccounts({
  orgId, userId, accounts, onChange,
}: { orgId: string; userId: string; accounts: MemberPayoutAccount[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  // Bank picker (searchable list of every Nigerian bank).
  const [banks, setBanks] = useState<NigerianBank[]>([])
  const [banksError, setBanksError] = useState<string | null>(null)
  const [bankQuery, setBankQuery] = useState('')
  const [bankOpen, setBankOpen] = useState(false)
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')

  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('') // resolved, never typed
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  function resetForm() {
    setBankQuery(''); setBankOpen(false); setBankCode(''); setBankName('')
    setAccountNumber(''); setAccountName(''); setResolving(false); setResolveError(null)
  }

  // Load the bank list the first time the form is opened.
  useEffect(() => {
    if (!adding || banks.length > 0) return
    let cancelled = false
    setBanksError(null)
    listNigerianBanks()
      .then((list) => { if (!cancelled) setBanks(list) })
      .catch((e) => { if (!cancelled) setBanksError(e instanceof Error ? e.message : 'Could not load banks.') })
    return () => { cancelled = true }
  }, [adding, banks.length])

  // Auto-confirm the account name from the number + bank (debounced).
  useEffect(() => {
    setAccountName('')
    setResolveError(null)
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return
    let cancelled = false
    setResolving(true)
    const t = setTimeout(() => {
      resolveBankAccount(accountNumber, bankCode)
        .then((name) => { if (!cancelled) setAccountName(name) })
        .catch((e) => { if (!cancelled) setResolveError(e instanceof Error ? e.message : 'Could not verify account.') })
        .finally(() => { if (!cancelled) setResolving(false) })
    }, 450)
    return () => { cancelled = true; clearTimeout(t) }
  }, [accountNumber, bankCode])

  const filteredBanks = useMemo(() => {
    const q = bankQuery.trim().toLowerCase()
    const list = q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks
    return list.slice(0, 40)
  }, [banks, bankQuery])

  const canSave = !!bankCode && /^\d{10}$/.test(accountNumber) && !!accountName && !resolving

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    await supabase.from('member_payout_accounts').insert({
      org_id: orgId, user_id: userId, bank_name: bankName.trim(), account_name: accountName.trim(),
      account_number: accountNumber.trim(), is_default: accounts.length === 0,
    })
    setBusy(false); setAdding(false); resetForm()
    onChange()
  }

  async function makeDefault(id: string) {
    await supabase.from('member_payout_accounts').update({ is_default: false }).eq('user_id', userId).eq('org_id', orgId)
    await supabase.from('member_payout_accounts').update({ is_default: true }).eq('id', id)
    onChange()
  }

  async function remove(id: string) {
    if (!confirm('Remove this payout account?')) return
    await supabase.from('member_payout_accounts').delete().eq('id', id)
    onChange()
  }

  return (
    <div>
      <p className="md-muted" style={{ fontSize: 12, marginBottom: 10 }}>Only you and the office admin can see these details.</p>
      {accounts.map((a) => (
        <div className="fin-row" key={a.id}>
          <span>{a.bank_name} · {a.account_name} · {a.account_number} {a.is_default && <span className="badge active">Default</span>}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            {!a.is_default && <button type="button" className="btn-ghost" onClick={() => makeDefault(a.id)}>Make default</button>}
            <button type="button" className="btn-ghost" onClick={() => remove(a.id)}>Remove</button>
          </span>
        </div>
      ))}
      {adding ? (
        <form onSubmit={add} className="upload-panel" style={{ marginTop: 10 }}>
          <div className="field-row">
            {/* Bank — searchable list of every Nigerian bank */}
            <label style={{ position: 'relative' }}>
              Bank
              <input
                value={bankOpen ? bankQuery : bankName}
                onChange={(e) => { setBankQuery(e.target.value); setBankOpen(true); setBankCode(''); setBankName('') }}
                onFocus={() => { setBankQuery(''); setBankOpen(true) }}
                onBlur={() => setTimeout(() => setBankOpen(false), 150)}
                placeholder={banksError ? 'Bank list unavailable' : 'Search banks…'}
                autoComplete="off"
                required
              />
              {bankOpen && (
                <div className="combo-menu">
                  {banks.length === 0 && !banksError && <div className="combo-empty">Loading banks…</div>}
                  {banksError && <div className="combo-empty">{banksError}</div>}
                  {banks.length > 0 && filteredBanks.length === 0 && <div className="combo-empty">No match</div>}
                  {filteredBanks.map((b) => (
                    <button
                      type="button"
                      key={b.code}
                      className="combo-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setBankCode(b.code); setBankName(b.name); setBankQuery(''); setBankOpen(false) }}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </label>

            {/* Account number comes before the name, which is derived from it */}
            <label>
              Account number
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                placeholder="10 digits"
                required
              />
            </label>

            <label>
              Account name
              <input
                value={resolving ? 'Verifying…' : accountName}
                readOnly
                placeholder="Auto-filled from your account number"
                tabIndex={-1}
              />
            </label>
          </div>
          {resolveError && <p className="form-error" style={{ marginTop: 6 }}>{resolveError}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" disabled={busy || !canSave}>Save account</button>
            <button type="button" className="secondary" onClick={() => { setAdding(false); resetForm() }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>+ Add payout account</button>
      )}
    </div>
  )
}

function PersonalIncome({
  orgId, userId, entries, onChange,
}: { orgId: string; userId: string; entries: IncomeDevelopmentIncomeEntry[]; onChange: () => void }) {
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('')
  const [earnedOn, setEarnedOn] = useState(localDateString())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!(value > 0)) { setErr('Enter an amount greater than zero.'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('income_development_income_entries').insert({
      org_id: orgId, user_id: userId, amount: value, source: source.trim() || null, earned_on: earnedOn,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setAmount(''); setSource(''); onChange()
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="md-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        This is for your own tracking only. It does <strong>not</strong> affect your Bizzlivo withdrawable balance.
      </p>
      <form onSubmit={add} className="upload-panel" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <label style={{ maxWidth: 160 }}>Amount (₦)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label>Source (optional)<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Logo design" /></label>
          <label style={{ maxWidth: 170 }}>Date<input type="date" value={earnedOn} onChange={(e) => setEarnedOn(e.target.value)} /></label>
        </div>
        {err && <p className="form-error">{err}</p>}
        <button type="submit" disabled={busy || !amount}>{busy ? 'Saving…' : 'Add entry'}</button>
      </form>
      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Source</th><th>Amount</th><th /></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="cell-dim">{new Date(e.earned_on).toLocaleDateString()}</td>
                  <td>{e.source ?? '—'}</td>
                  <td>{money(Number(e.amount), 'NGN')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-ghost" onClick={async () => {
                      if (!confirm('Delete this entry?')) return
                      await supabase.from('income_development_income_entries').delete().eq('id', e.id)
                      onChange()
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
