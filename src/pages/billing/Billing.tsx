import { useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { openPaystackCheckout } from '../../lib/paystack'
import {
  PLAN_COPY,
  PLAN_ORDER,
  fetchPlanLimits,
  formatNaira,
  planFeatureList,
  trialDaysLeft,
  useOrgUsage,
  yearlySavingsLabel,
} from '../../lib/plans'
import type { BillingCycle, PlanLimits, PlanTier, PaymentEvent } from '../../types/database'

const MANAGE_ROLES = new Set(['admin'])
const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined

function UsageMeter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0
  const attn = max !== null && used >= max
  return (
    <div className="usage-meter">
      <div className="um-head">
        <span className="um-label">{label}</span>
        <span className="um-count">{used}{max !== null ? ` / ${max}` : ' / unlimited'}</span>
      </div>
      {max !== null && (
        <div className="usage-bar">
          <div className={`usage-bar-fill ${attn ? 'attn' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function Billing() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false

  const { usage, loading: usageLoading, refresh: refreshUsage } = useOrgUsage(orgId)
  const [limits, setLimits] = useState<PlanLimits[]>([])
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [payments, setPayments] = useState<PaymentEvent[]>([])
  const [checkoutPlan, setCheckoutPlan] = useState<PlanTier | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

  async function handleUpgrade(plan: Exclude<PlanTier, 'free'>) {
    if (!orgId || !profile) return
    if (!PAYSTACK_PUBLIC_KEY) {
      setError('Paystack is not configured yet (VITE_PAYSTACK_PUBLIC_KEY missing).')
      return
    }
    const planLimits = limits.find((l) => l.plan === plan)
    if (!planLimits) return

    setError(null)
    setNotice(null)
    setCheckoutPlan(plan)
    const amountKobo = cycle === 'monthly' ? planLimits.price_monthly_kobo : planLimits.price_yearly_kobo
    const reference = `hq360-${orgId}-${plan}-${cycle}-${Date.now()}`

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
            setNotice(`You're now on the ${PLAN_COPY[plan].label} plan.`)
            await refreshUsage()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not confirm payment. Contact support with your transaction reference.')
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

  async function handleCancel() {
    if (!orgId) return
    if (!confirm("Your plan won't renew after the current period ends. Continue?")) return
    const { error: rpcError } = await supabase.rpc('request_cancel_subscription', { target_org_id: orgId })
    if (rpcError) setError(rpcError.message)
    else {
      setNotice("Got it — your plan won't renew. You'll keep access until the current period ends.")
      await refreshUsage()
    }
  }

  async function handleDowngradeNow() {
    if (!orgId) return
    if (!confirm('Downgrade to Free now? Nothing is deleted, but new usage will be capped at Free limits immediately.')) return
    const { error: rpcError } = await supabase.rpc('downgrade_to_free_now', { target_org_id: orgId })
    if (rpcError) setError(rpcError.message)
    else {
      setNotice("You're on the Free plan now.")
      await refreshUsage()
    }
  }

  if (!canManage) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Billing</h1>
          <p>Only your office's admin can manage billing.</p>
        </div>
      </div>
    )
  }

  const daysLeft = usage ? trialDaysLeft(usage) : null

  return (
    <div className="page">
      <div className="page-head">
        <h1>Billing</h1>
        <p>Current plan, usage, and upgrade options for {currentMembership?.organization.name}.</p>
      </div>

      {usage?.status === 'trialing' && daysLeft !== null && (
        <div className={`billing-banner ${daysLeft <= 3 ? 'warn' : ''}`}>
          <p><strong>Trial — {daysLeft} day{daysLeft === 1 ? '' : 's'} left.</strong> Add a plan below before it ends to keep Growth-tier access.</p>
          <span className="badge trialing">Trialing</span>
        </div>
      )}
      {usage && usage.status !== 'trialing' && usage.plan !== 'free' && usage.cancel_at_period_end && (
        <div className="billing-banner warn">
          <p>Your plan won't renew — access continues until {usage.current_period_end ? new Date(usage.current_period_end).toLocaleDateString() : 'the end of this period'}, then reverts to Free.</p>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-info">{notice}</p>}

      {usage && !usageLoading && (
        <div className="usage-grid">
          <UsageMeter label="Members" used={usage.member_count} max={usage.max_members} />
          <UsageMeter label="Resources" used={usage.resource_count} max={usage.max_resources} />
          <UsageMeter label="Published exams" used={usage.published_exam_count} max={usage.max_published_exams} />
          <UsageMeter label="AI exam generations this month" used={usage.ai_exam_generations_used} max={usage.ai_exam_generations_per_month} />
          <UsageMeter label="AI questions this month" used={usage.ai_questions_used} max={usage.ai_questions_per_month} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <div className="cycle-toggle">
          <button type="button" className={cycle === 'monthly' ? 'active' : ''} onClick={() => setCycle('monthly')}>Monthly</button>
          <button type="button" className={cycle === 'yearly' ? 'active' : ''} onClick={() => setCycle('yearly')}>Yearly</button>
        </div>
        <span className="save-pill">2 months free on yearly</span>
      </div>

      <div className="plan-cards">
        {PLAN_ORDER.map((plan) => {
          const planLimits = limits.find((l) => l.plan === plan)
          if (!planLimits) return null
          const isCurrent = usage?.plan === plan
          const price = cycle === 'monthly' ? planLimits.price_monthly_kobo : planLimits.price_yearly_kobo
          const savings = cycle === 'yearly' ? yearlySavingsLabel(planLimits) : null

          return (
            <div className={`plan-card ${isCurrent ? 'current' : ''}`} key={plan}>
              {isCurrent && <span className="pc-current-flag">Current plan</span>}
              <h3>{PLAN_COPY[plan].label}</h3>
              <p className="pc-who">{PLAN_COPY[plan].who}</p>
              <div className="pc-price">
                <span className="amt">{formatNaira(price)}</span>
                <span className="per">/ {cycle === 'monthly' ? 'month' : 'year'}{savings ? ` · ${savings}` : ''}</span>
              </div>
              <ul>
                {planFeatureList(planLimits).map((f) => <li key={f}>{f}</li>)}
              </ul>
              {plan === 'free' ? (
                isCurrent ? (
                  <button type="button" className="secondary" disabled>Current plan</button>
                ) : (
                  <button type="button" className="secondary" onClick={handleDowngradeNow}>Downgrade to Free</button>
                )
              ) : isCurrent ? (
                usage?.cancel_at_period_end ? (
                  <button type="button" className="secondary" disabled>Ending soon</button>
                ) : (
                  <button type="button" className="secondary" onClick={handleCancel}>Cancel plan</button>
                )
              ) : (
                <button type="button" onClick={() => handleUpgrade(plan)} disabled={checkoutPlan === plan}>
                  {checkoutPlan === plan ? 'Opening checkout…' : 'Upgrade'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <h2 style={{ marginTop: 32 }}>Payment history</h2>
      {payments.length === 0 ? (
        <p className="payment-history-empty">No payments yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Date</th><th>Amount</th><th>Status</th><th>Reference</th></tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>₦{p.amount.toLocaleString('en-NG')}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td className="cell-dim">{p.provider_ref ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
