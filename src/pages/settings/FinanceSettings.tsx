import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { COMMON_CURRENCIES, loadFinanceConfig, loadFinanceGrants,
  updateFinanceConfig, updateFinanceConnection, setFinanceGrant, revokeFinanceGrant } from '../../lib/finance'
import { formatMoney } from '../../lib/money'
import type { OrgFinanceConfig, OrgFinanceGrant, Profile } from '../../types/database'

// Grant capability rows shown in the Payout Permissions editor.
const GRANT_FIELDS: { key: keyof OrgFinanceGrant; label: string; help: string }[] = [
  { key: 'can_view_finance', label: 'View finance', help: 'See the Finance Operations workspace' },
  { key: 'can_verify_settlement', label: 'Verify settlements', help: 'Record earnings, settlements and credit members' },
  { key: 'can_review_withdrawal', label: 'Review withdrawals', help: 'Open and assess requests' },
  { key: 'can_approve_withdrawal', label: 'Approve withdrawals', help: 'Give an approval on a request' },
  { key: 'can_authorize_payment', label: 'Authorize payment', help: 'Release an approved request for the office to pay' },
  { key: 'can_record_payment', label: 'Record payment', help: 'Enter the payment reference after the office pays' },
  { key: 'can_confirm_payment', label: 'Confirm payment', help: 'Second-person confirmation that finalises PAID' },
  { key: 'can_initiate_payout', label: 'Initiate payout', help: 'Send an automated provider transfer (when enabled)' },
  { key: 'can_manage_reconciliation', label: 'Reconciliation', help: 'Run reconciliation and reverse a paid withdrawal' },
]

export default function FinanceSettings() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [cfg, setCfg] = useState<OrgFinanceConfig | null>(null)
  const [grants, setGrants] = useState<OrgFinanceGrant[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const [c, g, m] = await Promise.all([
        loadFinanceConfig(orgId),
        loadFinanceGrants(orgId),
        supabase.from('memberships').select('profile:profiles(*)').eq('org_id', orgId).eq('status', 'active')
          .returns<{ profile: Profile }[]>(),
      ])
      setCfg(c); setGrants(g)
      setMembers(((m.data ?? []).map((r) => r.profile)).filter(Boolean))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load finance settings.') }
  }, [orgId])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<unknown>, done = 'Saved.') => {
    setBusy(true); setErr(null); setOk(null)
    try { await fn(); await load(); setOk(done) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.') }
    finally { setBusy(false) }
  }

  if (!orgId) return null
  if (!cfg) return <div><div className="page-head"><h1>Finance</h1></div><p className="empty-row">{err ?? 'Loading…'}</p></div>

  const conn = cfg.connection
  const connected = conn?.status === 'active'

  return (
    <div>
      <div className="page-head">
        <h1>Office Finance</h1>
        <p className="set-hint">
          Bizzlivo is the accounting and authorization layer. It records verified earnings, member balances,
          withdrawals and approvals. Your office pays each authorized withdrawal from its own financial account —
          Bizzlivo never holds member funds.
        </p>
      </div>

      {err && <p className="form-error">{err}</p>}
      {ok && <p className="md-muted">{ok}</p>}

      {/* ---- Finance Account ---- */}
      <section className="set-card">
        <div className="set-card-head"><h2>Finance Account</h2>
          <p>How this office settles member payouts.</p>
        </div>
        {!connected ? (
          <div className="entitlement-lock">
            <strong>Not connected</strong>
            <span className="set-hint">Add a settlement account to enable member payouts.</span>
          </div>
        ) : (
          <div className="set-field-grid">
            <Field label="Provider">{conn?.provider ? conn.provider[0].toUpperCase() + conn.provider.slice(1) : '—'}</Field>
            <Field label="Connection">{conn?.connection_type === 'external_manual' ? 'External (office-operated)' : conn?.connection_type}</Field>
            <Field label="Settlement account">
              {conn?.settlement_bank_name || conn?.settlement_masked_number
                ? `${conn?.settlement_bank_name ?? ''} ${conn?.settlement_masked_number ?? ''}`.trim()
                : 'Not set'}
            </Field>
            <Field label="Account name">{conn?.settlement_account_name ?? 'Not set'}</Field>
            <Field label="Status"><span className="gl-tag green">Connected</span></Field>
            <Field label="Automated payouts">
              {cfg.automation_available ? 'Enabled — provider transfers'
                : cfg.automated_payout_enabled ? 'On, but the provider connection does not support transfers'
                : 'Off — payouts are recorded manually'}
            </Field>
          </div>
        )}
        <SettlementForm
          conn={conn}
          busy={busy}
          onSubmit={(patch) => run(() => updateFinanceConnection(orgId, { ...patch, status: 'active' }), 'Finance account updated.')}
        />
        {conn?.capabilities?.supports_transfers ? (
          <ToggleRow
            label="Enable automated provider transfers for authorized withdrawals"
            checked={cfg.automated_payout_enabled}
            disabled={busy}
            onChange={(v) => run(() => updateFinanceConfig(orgId, { automated_payout_enabled: v }), 'Updated.')}
          />
        ) : (
          <p className="set-hint" style={{ marginTop: 10 }}>
            <strong>Automated payouts unavailable.</strong> Your payment provider connection does not currently support
            transfers, so authorized withdrawals are paid from your office account and the reference recorded here.
            Bizzlivo's subscription billing is separate and is never used to fund payouts.
          </p>
        )}
      </section>

      {/* ---- Withdrawal Rules ---- */}
      <section className="set-card">
        <div className="set-card-head"><h2>Withdrawal Rules</h2><p>Limits and approval policy. Every change is audited.</p></div>
        <RulesForm cfg={cfg} busy={busy} onSubmit={(patch) => run(() => updateFinanceConfig(orgId, patch), 'Rules updated.')} />
      </section>

      {/* ---- Currency ---- */}
      <section className="set-card">
        <div className="set-card-head"><h2>Currency</h2><p>The office base currency for limits and reporting.</p></div>
        <div className="set-field-col" style={{ maxWidth: 220 }}>
          <label>Base currency
            <select
              defaultValue={cfg.base_currency}
              disabled={busy}
              onChange={(e) => run(() => updateFinanceConfig(orgId, { base_currency: e.target.value }), 'Base currency updated.')}
            >
              {COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <span className="set-hint">Historical settlements keep the exchange rate used at the time — changing this never re-values past records.</span>
        </div>
      </section>

      {/* ---- Payout Permissions ---- */}
      <section className="set-card">
        <div className="set-card-head"><h2>Payout Permissions</h2>
          <p>Office Admins already have every finance permission. Grant specific permissions to other members to act
            as Finance Admins. A member can never approve or be paid on their own withdrawal.</p>
        </div>
        <GrantsEditor
          grants={grants} members={members} busy={busy}
          onSet={(userId, patch) => run(() => setFinanceGrant(orgId, userId, patch), 'Permissions updated.')}
          onRevoke={(userId) => run(() => revokeFinanceGrant(orgId, userId), 'Permissions removed.')}
        />
      </section>

      {/* ---- Audit / Reconciliation ---- */}
      <section className="set-card">
        <div className="set-card-head"><h2>Audit &amp; Reconciliation</h2>
          <p>Every settlement, approval, authorization, payment and adjustment is recorded in the finance audit trail.</p>
        </div>
        <p><Link to="/finance?tab=reconciliation" className="md-btn ghost sm">Open reconciliation</Link></p>
      </section>

      {/* ---- Finance status ---- */}
      <section className="set-card" style={{ borderColor: cfg.finance_status !== 'active' ? 'var(--danger, #dc2626)' : undefined }}>
        <div className="set-card-head"><h2>Finance Status</h2>
          <p>Restrict finance without suspending the whole office. Ledger and history stay readable; payouts cannot be initiated while restricted or suspended.</p>
        </div>
        <div className="set-field-col" style={{ maxWidth: 320 }}>
          <label>Status
            <select
              defaultValue={cfg.finance_status}
              disabled={busy}
              onChange={(e) => run(() => updateFinanceConfig(orgId, { finance_status: e.target.value }), 'Finance status updated.')}
            >
              <option value="active">Active</option>
              <option value="restricted">Restricted</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
          <ToggleRow
            label="Pause new withdrawal requests"
            checked={cfg.withdrawals_paused}
            disabled={busy}
            onChange={(v) => run(() => updateFinanceConfig(orgId, { withdrawals_paused: v }), 'Updated.')}
          />
        </div>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="set-field">
      <span className="set-field-label">{label}</span>
      <span className="set-field-value">{children}</span>
    </div>
  )
}

function ToggleRow({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="toggle-row" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function SettlementForm({ conn, busy, onSubmit }: {
  conn: OrgFinanceConfig['connection']; busy: boolean
  onSubmit: (patch: Record<string, string>) => void
}) {
  const [bank, setBank] = useState(conn?.settlement_bank_name ?? '')
  const [name, setName] = useState(conn?.settlement_account_name ?? '')
  const [masked, setMasked] = useState(conn?.settlement_masked_number ?? '')
  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({
        settlement_bank_name: bank.trim(), settlement_account_name: name.trim(), settlement_masked_number: masked.trim(),
      }) }}
      style={{ marginTop: 14 }}
    >
      <div className="field-row">
        <label>Settlement bank<input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="GTBank" /></label>
        <label>Account name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Synergy Office" /></label>
        <label>Masked number<input value={masked} onChange={(e) => setMasked(e.target.value)} placeholder="••••4821" /></label>
      </div>
      <button type="submit" disabled={busy}>Save finance account</button>
    </form>
  )
}

function RulesForm({ cfg, busy, onSubmit }: {
  cfg: OrgFinanceConfig; busy: boolean; onSubmit: (patch: Record<string, unknown>) => void
}) {
  const [min, setMin] = useState(String(cfg.minimum_withdrawal_amount))
  const [max, setMax] = useState(cfg.maximum_withdrawal_amount != null ? String(cfg.maximum_withdrawal_amount) : '')
  const [daily, setDaily] = useState(cfg.daily_payout_limit != null ? String(cfg.daily_payout_limit) : '')
  const [secondOn, setSecondOn] = useState(cfg.second_approval_enabled)
  const [secondAt, setSecondAt] = useState(cfg.second_approval_threshold != null ? String(cfg.second_approval_threshold) : '')
  const [confirm, setConfirm] = useState(cfg.require_payment_confirmation)
  const [separation, setSeparation] = useState(cfg.enforce_separation_of_duties)
  const [memberCancel, setMemberCancel] = useState(cfg.allow_member_cancel)

  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({
        minimum_withdrawal_amount: Number(min) || 0,
        maximum_withdrawal_amount: max === '' ? '' : Number(max),
        daily_payout_limit: daily === '' ? '' : Number(daily),
        second_approval_enabled: secondOn,
        second_approval_threshold: secondAt === '' ? '' : Number(secondAt),
        require_payment_confirmation: confirm,
        enforce_separation_of_duties: separation,
        allow_member_cancel: memberCancel,
      }) }}
    >
      <div className="field-row">
        <label>Minimum withdrawal ({cfg.base_currency})
          <input type="number" min="0" step="0.01" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label>Per-request limit ({cfg.base_currency}, blank = none)
          <input type="number" min="0" step="0.01" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <label>Daily payout limit ({cfg.base_currency}, blank = none)
          <input type="number" min="0" step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </label>
      </div>
      <ToggleRow label="Require a second approval for large withdrawals" checked={secondOn} onChange={setSecondOn} />
      {secondOn && (
        <label style={{ maxWidth: 260, display: 'block', marginTop: 8 }}>Second approval at or above ({cfg.base_currency})
          <input type="number" min="0" step="0.01" value={secondAt} onChange={(e) => setSecondAt(e.target.value)} />
        </label>
      )}
      <ToggleRow label="Require a separate person to confirm payment before it counts as PAID" checked={confirm} onChange={setConfirm} />
      <ToggleRow label="Enforce separation of duties (different people for approve / authorize / confirm, where possible)" checked={separation} onChange={setSeparation} />
      <ToggleRow label="Let members cancel their own request before review" checked={memberCancel} onChange={setMemberCancel} />
      <div style={{ marginTop: 14 }}>
        <button type="submit" disabled={busy}>Save rules</button>
      </div>
      <p className="set-hint" style={{ marginTop: 8 }}>
        These are your office's values — the figures shipped by default are only a starting point.
      </p>
    </form>
  )
}

function GrantsEditor({ grants, members, busy, onSet, onRevoke }: {
  grants: OrgFinanceGrant[]; members: Profile[]; busy: boolean
  onSet: (userId: string, patch: Record<string, unknown>) => void
  onRevoke: (userId: string) => void
}) {
  const [addId, setAddId] = useState('')
  const granted = new Set(grants.map((g) => g.user_id))
  const addable = members.filter((m) => !granted.has(m.id))

  return (
    <>
      {grants.length === 0 ? (
        <p className="empty-row">No extra finance permissions granted. Only Office Admins can act on finance.</p>
      ) : grants.map((g) => (
        <div key={g.user_id} className="fin-grant" style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{g.full_name}</strong>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
              if (confirm(`Remove all finance permissions from ${g.full_name}?`)) onRevoke(g.user_id)
            }}>Remove</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 6, marginTop: 8 }}>
            {GRANT_FIELDS.map((f) => (
              <label key={String(f.key)} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!g[f.key]}
                  disabled={busy}
                  onChange={(e) => onSet(g.user_id, { [f.key]: e.target.checked })}
                />
                <span title={f.help}>{f.label}</span>
              </label>
            ))}
          </div>
          <label style={{ display: 'block', maxWidth: 240, marginTop: 8, fontSize: 13 }}>Approval limit (blank = unlimited)
            <input
              type="number" min="0" step="0.01"
              defaultValue={g.approval_limit_amount ?? ''}
              disabled={busy}
              onBlur={(e) => onSet(g.user_id, { approval_limit_amount: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </label>
          {g.approval_limit_amount != null && (
            <span className="set-hint">Cannot approve above {formatMoney(g.approval_limit_amount, 'NGN')}</span>
          )}
        </div>
      ))}

      {addable.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'flex-end' }}>
          <label style={{ flex: 1, maxWidth: 320 }}>Add a Finance Admin
            <select value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">— Select a member —</option>
              {addable.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !addId}
            onClick={() => { onSet(addId, { can_view_finance: true, can_review_withdrawal: true }); setAddId('') }}
          >Add</button>
        </div>
      )}
    </>
  )
}
