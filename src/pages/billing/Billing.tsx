import { useEffect, useMemo, useRef, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { openPaystackCheckout } from '../../lib/paystack'
import { fetchPlanLimits, trialDaysLeft, useOrgUsage } from '../../lib/plans'
import {
  PLAN_META,
  PLAN_ORDER,
  COMPARE_ROWS,
  nairaFromKobo,
  monthlyEquivalent,
  annualSavingsKobo,
  monthsFreeLabel,
  seatState,
  subscriptionStatusLabel,
} from '../../lib/entitlements'
import type { BillingCycle, PlanLimits, PlanTier, PaymentEvent } from '../../types/database'

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function UsageMeter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const s = seatState(used, max)
  return (
    <div className="usage-meter">
      <div className="um-head">
        <span className="um-label">{label}</span>
        <span className={`um-count ${s.atLimit ? 'at' : s.near ? 'near' : ''}`}>
          {used}{max != null ? ` / ${max}` : ' · unlimited'}
        </span>
      </div>
      {max != null && (
        <div className="usage-bar">
          <div className={`usage-bar-fill ${s.atLimit ? 'attn' : s.near ? 'near' : ''}`} style={{ width: `${s.pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function Billing() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const orgName = currentMembership?.organization.name ?? 'your office'
  const canManage = currentMembership?.role === 'admin'

  const { usage, loading: usageLoading, refresh: refreshUsage } = useOrgUsage(orgId)
  const [limits, setLimits] = useState<PlanLimits[]>([])
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [payments, setPayments] = useState<PaymentEvent[]>([])
  const [checkoutPlan, setCheckoutPlan] = useState<PlanTier | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchPlanLimits().then(setLimits).catch(() => setError('Could not load plan pricing.'))
  }, [])

  useEffect(() => {
    if (!orgId || !canManage) return
    supabase
      .from('payment_events')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setPayments((data as PaymentEvent[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, canManage])

  const limitByPlan = useMemo(() => new Map(limits.map((l) => [l.plan, l])), [limits])

  async function handleUpgrade(plan: Exclude<PlanTier, 'free'>) {
    if (!orgId || !profile) return
    if (!PAYSTACK_PUBLIC_KEY) {
      setError('Payments are not configured yet (missing Paystack public key).')
      return
    }
    const pl = limitByPlan.get(plan)
    if (!pl) return

    setError(null)
    setNotice(null)
    setCheckoutPlan(plan)
    const amountKobo = cycle === 'monthly' ? pl.price_monthly_kobo : pl.price_yearly_kobo
    const reference = `bizzlivo-${orgId}-${plan}-${cycle}-${Date.now()}`

    try {
      await openPaystackCheckout({
        key: PAYSTACK_PUBLIC_KEY,
        ref: reference,
        amount: amountKobo,
        currency: 'NGN',
        email: profile.email ?? '',
        metadata: { org_id: orgId, plan, billing_cycle: cycle },
        callback: async (response) => {
          try {
            const { data, error: fnError } = await supabase.functions.invoke('verify-paystack-transaction', {
              body: { reference: response.reference },
            })
            if (fnError) {
              if (fnError instanceof FunctionsHttpError) {
                const body = await fnError.context.json().catch(() => null)
                throw new Error(body?.error ?? fnError.message)
              }
              throw fnError
            }
            if (data?.error) throw new Error(data.error)
            setNotice(`You're now on the ${PLAN_META[plan].label} plan.`)
            await refreshUsage()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not confirm the payment. Contact support with your transaction reference.')
          } finally {
            setCheckoutPlan(null)
          }
        },
        onClose: () => setCheckoutPlan(null),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open checkout.')
      setCheckoutPlan(null)
    }
  }

  async function runRpc(fn: string, ok: string, confirmMsg?: string) {
    if (!orgId) return
    if (confirmMsg && !confirm(confirmMsg)) return
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc(fn, { target_org_id: orgId })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else {
      setNotice(ok)
      await refreshUsage()
    }
  }

  if (!canManage) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Billing &amp; Plan</h1>
          <p>Only your office's admin can manage billing.</p>
        </div>
      </div>
    )
  }

  const daysLeft = usage ? trialDaysLeft(usage) : null
  const currentPlan: PlanTier = usage?.plan ?? 'free'
  const isPaid = currentPlan !== 'free'
  const currentLimit = limitByPlan.get(currentPlan)
  const paidAmount = usage?.amount_kobo ?? (currentLimit
    ? (usage?.billing_cycle === 'yearly' ? currentLimit.price_yearly_kobo : currentLimit.price_monthly_kobo)
    : 0)

  const renewLine = (() => {
    if (!usage || currentPlan === 'free') return 'Not applicable'
    if (usage.status === 'trialing') return `Trial ends ${fmtDate(usage.trial_ends_at)}`
    if (usage.cancel_at_period_end) return `Access ends ${fmtDate(usage.current_period_end)}`
    return usage.current_period_end ? `Renews ${fmtDate(usage.current_period_end)}` : '—'
  })()

  return (
    <div className="page billing">
      <div className="page-head">
        <h1>Billing &amp; Plan</h1>
        <p>Manage your Bizzlivo subscription, usage and organization plan.</p>
      </div>

      {usage?.status === 'trialing' && daysLeft !== null && (
        <div className={`billing-banner ${daysLeft <= 3 ? 'warn' : ''}`}>
          <p><strong>Trial — {daysLeft} day{daysLeft === 1 ? '' : 's'} left.</strong> Choose a plan below to keep Growth-tier access.</p>
          <span className="badge trialing">Trial</span>
        </div>
      )}
      {usage && usage.status !== 'trialing' && isPaid && usage.cancel_at_period_end && (
        <div className="billing-banner warn">
          <p>Your plan won't renew — access continues until {fmtDate(usage.current_period_end)}, then reverts to Free.</p>
          <button type="button" className="secondary" disabled={busy} onClick={() => runRpc('resume_subscription', "Your plan will keep renewing.")}>
            Keep my plan
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-info">{notice}</p>}

      {/* ── current plan + usage ─────────────────────────────── */}
      <div className="billing-status-grid">
        <section className="billing-panel">
          <span className="bp-eyebrow">Current plan</span>
          <div className="bp-plan-row">
            <span className={`bp-plan-name plan-${currentPlan}`}>{PLAN_META[currentPlan].label}</span>
            <span className={`badge ${usage?.status ?? 'free'}`}>{subscriptionStatusLabel(usage)}</span>
          </div>
          <p className="bp-org">{orgName}</p>
          <dl className="bp-facts">
            <div>
              <dt>Members</dt>
              <dd>{currentLimit?.max_members == null ? 'Unlimited' : `${currentLimit.max_members} seat${currentLimit.max_members === 1 ? '' : 's'}`}</dd>
            </div>
            {isPaid && (
              <div>
                <dt>Price</dt>
                <dd>{nairaFromKobo(paidAmount)} / {usage?.billing_cycle === 'yearly' ? 'year' : 'month'}</dd>
              </div>
            )}
            <div>
              <dt>{isPaid && !usage?.cancel_at_period_end ? 'Renews' : 'Status'}</dt>
              <dd>{renewLine}</dd>
            </div>
          </dl>

          <div className="bp-actions">
            {currentPlan === 'free' ? (
              <button type="button" onClick={() => cardsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Upgrade plan
              </button>
            ) : (
              <>
                {!usage?.cancel_at_period_end && (
                  <button type="button" className="secondary" disabled={busy}
                    onClick={() => runRpc('request_cancel_subscription', "Got it — your plan won't renew. You keep access until the period ends.",
                      `Cancel your ${PLAN_META[currentPlan].label} subscription?\n\nYou'll keep ${PLAN_META[currentPlan].label} access until ${fmtDate(usage?.current_period_end)}, then the office moves to Free.`)}>
                    Cancel subscription
                  </button>
                )}
                <button type="button" className="danger" disabled={busy}
                  onClick={() => runRpc('downgrade_to_free_now', "You're on the Free plan now.",
                    'Downgrade to Free right now? Nothing is deleted, but usage is capped at Free limits immediately.')}>
                  Downgrade to Free now
                </button>
              </>
            )}
          </div>
        </section>

        <section className="billing-panel">
          <span className="bp-eyebrow">Current usage</span>
          {usage && !usageLoading ? (
            <div className="usage-grid">
              <UsageMeter label="Members" used={usage.member_count} max={usage.max_members} />
              <UsageMeter label="Admin seats" used={usage.admin_count} max={usage.max_admins} />
              <UsageMeter label="AI generations · this month" used={usage.ai_exam_generations_used} max={usage.ai_exam_generations_per_month} />
              <UsageMeter label="AI questions · this month" used={usage.ai_questions_used} max={usage.ai_questions_per_month} />
            </div>
          ) : (
            <p className="md-muted">Loading usage…</p>
          )}
          {usage && seatState(usage.member_count, usage.max_members).near && (
            <p className={`bp-seat-note ${seatState(usage.member_count, usage.max_members).atLimit ? 'at' : ''}`}>
              {seatState(usage.member_count, usage.max_members).atLimit
                ? `Member limit reached — your ${PLAN_META[currentPlan].label} plan supports up to ${usage.max_members}.`
                : `You're using ${usage.member_count} of ${usage.max_members} member seats.`}
            </p>
          )}
        </section>
      </div>

      {/* ── plan picker ─────────────────────────────────────── */}
      <div className="billing-cycle-row" ref={cardsRef}>
        <div className="cycle-toggle">
          <button type="button" className={cycle === 'monthly' ? 'active' : ''} onClick={() => setCycle('monthly')}>Monthly</button>
          <button type="button" className={cycle === 'yearly' ? 'active' : ''} onClick={() => setCycle('yearly')}>
            Yearly<span className="cycle-save">Save 2 months</span>
          </button>
        </div>
      </div>

      <div className="plan-cards" role="list">
        {PLAN_ORDER.map((plan) => {
          const pl = limitByPlan.get(plan)
          if (!pl) return null
          const meta = PLAN_META[plan]
          const isCurrent = currentPlan === plan
          const mobileOrder = isCurrent ? 0 : plan === 'growth' ? 1 : 2 + PLAN_ORDER.indexOf(plan)
          const monthly = pl.price_monthly_kobo === 0
          const yearMode = cycle === 'yearly' && !monthly
          const shownKobo = yearMode ? pl.price_yearly_kobo : pl.price_monthly_kobo
          const saveKobo = annualSavingsKobo(pl)

          return (
            <div
              role="listitem"
              className={`plan-card ${isCurrent ? 'current' : ''} ${meta.recommended ? 'recommended' : ''}`}
              key={plan}
              style={{ ['--m-order' as string]: mobileOrder }}
            >
              {meta.recommended && !isCurrent && <span className="pc-flag popular">Most popular</span>}
              {isCurrent && <span className="pc-flag current">Current plan</span>}

              <h3 className={`pc-name plan-${plan}`}>{meta.label}</h3>
              <p className="pc-tagline">{meta.tagline}</p>

              <div className="pc-price">
                <span className="pc-amt">{monthly ? '₦0' : nairaFromKobo(shownKobo)}</span>
                <span className="pc-per">/ {yearMode ? 'year' : 'month'}</span>
              </div>
              {yearMode ? (
                <p className="pc-price-sub">
                  Equivalent to {monthlyEquivalent(pl.price_yearly_kobo)}
                  {saveKobo > 0 && <> · <strong>save {nairaFromKobo(saveKobo)}/year</strong></>}
                </p>
              ) : monthly ? (
                <p className="pc-price-sub">Always free</p>
              ) : (
                <p className="pc-price-sub">{nairaFromKobo(pl.price_yearly_kobo)}/year · {monthsFreeLabel(pl)}</p>
              )}

              <p className="pc-members">{pl.max_members == null ? 'Unlimited members' : `Up to ${pl.max_members} members`}</p>

              <ul className="pc-features">
                {meta.bullets(pl).map((f) => <li key={f}>{f}</li>)}
              </ul>

              <div className="pc-cta">
                {isCurrent ? (
                  <button type="button" className="secondary" disabled>Current plan</button>
                ) : plan === 'free' ? (
                  <button type="button" className="secondary" disabled={busy}
                    onClick={() => runRpc('downgrade_to_free_now', "You're on the Free plan now.",
                      'Move to the Free plan now? Usage is capped at Free limits immediately.')}>
                    Switch to Free
                  </button>
                ) : (
                  <button type="button" onClick={() => handleUpgrade(plan)} disabled={checkoutPlan === plan}>
                    {checkoutPlan === plan ? 'Opening checkout…' : `Upgrade to ${meta.label}`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── comparison ─────────────────────────────────────── */}
      {limits.length === 3 && (
        <section className="compare-plans">
          <h2>Compare plans</h2>
          <div className="compare-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th></th>
                  {PLAN_ORDER.map((p) => (
                    <th key={p} className={currentPlan === p ? 'is-current' : ''}>{PLAN_META[p].label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {PLAN_ORDER.map((p) => {
                      const v = row.cell(limitByPlan.get(p)!)
                      return <td key={p} className={`${currentPlan === p ? 'is-current' : ''} ${v === '—' ? 'muted' : ''}`}>{v}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── history ────────────────────────────────────────── */}
      <section className="billing-history">
        <h2>Billing history</h2>
        {payments.length === 0 ? (
          <p className="md-muted">No payments yet.</p>
        ) : (
          <div className="compare-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Amount</th><th>Status</th><th>Reference</th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>₦{Number(p.amount).toLocaleString('en-NG')}</td>
                    <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                    <td className="cell-dim">{p.provider_ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
