// Shared by paystack-webhook and verify-paystack-transaction: both paths
// end with the same "a Paystack transaction was confirmed successful, now
// make it true in our database" step, so it lives in one place instead of
// being duplicated (and drifting) across two functions.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PLAN_CODES = ['free', 'growth', 'business'] as const
export type PlanCode = (typeof PLAN_CODES)[number]
export type BillingCycle = 'monthly' | 'yearly'

export interface PaystackVerifyResponse {
  status: boolean
  data?: {
    id: number
    reference: string
    status: string
    amount: number // kobo — Paystack always quotes/returns NGN amounts in the subunit
    currency: string
    customer?: { email?: string; customer_code?: string }
    metadata?: Record<string, unknown> | string | null
  }
}

export async function verifyPaystackTransaction(secretKey: string, reference: string): Promise<PaystackVerifyResponse> {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  })
  return res.json()
}

export function isValidPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (PLAN_CODES as readonly string[]).includes(value)
}

function periodEndFor(cycle: BillingCycle, from: Date): string {
  const end = new Date(from)
  if (cycle === 'yearly') end.setFullYear(end.getFullYear() + 1)
  else end.setMonth(end.getMonth() + 1)
  return end.toISOString()
}

/**
 * Activates (or renews) a paid plan for an org from a verified Paystack
 * transaction. Idempotent on provider_ref — the webhook and the client-side
 * verify call both reach here for the same transaction in the common case
 * (webhook delivery isn't instant), so a duplicate call must be a no-op
 * rather than double-charging period_end or double-logging the payment.
 */
export async function activatePaidPlan(
  db: SupabaseClient,
  params: {
    orgId: string
    plan: Exclude<PlanCode, 'free'>
    billingCycle: BillingCycle
    amountKobo: number
    currency: string
    providerRef: string
    providerCustomerId: string | null
  },
): Promise<{ alreadyProcessed: boolean }> {
  const { data: existingEvent } = await db
    .from('payment_events')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('provider_ref', params.providerRef)
    .maybeSingle()
  if (existingEvent) return { alreadyProcessed: true }

  // The charge amount is set client-side from plan_limits — re-check it
  // against the DB here so a tampered checkout can't buy a higher plan
  // for less. plan_limits is the single source of truth for price.
  const { data: pl, error: plError } = await db
    .from('plan_limits')
    .select('price_monthly_kobo, price_yearly_kobo')
    .eq('plan', params.plan)
    .maybeSingle()
  if (plError || !pl) throw new Error('Could not verify plan pricing.')
  const expected = params.billingCycle === 'yearly' ? pl.price_yearly_kobo : pl.price_monthly_kobo
  if (params.amountKobo !== expected) {
    throw new Error(`Paid amount (${params.amountKobo}) does not match the ${params.plan}/${params.billingCycle} price (${expected}).`)
  }

  const now = new Date()
  const periodEnd = periodEndFor(params.billingCycle, now)

  const { error: subError } = await db
    .from('subscriptions')
    .upsert(
      {
        org_id: params.orgId,
        plan: params.plan,
        status: 'active',
        provider: 'paystack',
        provider_customer_id: params.providerCustomerId,
        billing_cycle: params.billingCycle,
        amount_kobo: params.amountKobo,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd,
        cancel_at_period_end: false,
      },
      { onConflict: 'org_id' },
    )
  if (subError) throw subError

  const { error: eventError } = await db.from('payment_events').insert({
    org_id: params.orgId,
    amount: params.amountKobo / 100,
    currency: params.currency,
    status: 'successful',
    provider_ref: params.providerRef,
  })
  if (eventError) throw eventError

  const { error: orgError } = await db
    .from('organizations')
    .update({ plan_tier: params.plan })
    .eq('id', params.orgId)
  if (orgError) throw orgError

  // Billing confirmation email to office admins — best-effort, never
  // blocks activation. Paystack already sent the payer a card receipt;
  // this is the "your plan is now active" notice, not a receipt.
  try {
    const { data: admins } = await db
      .from('memberships')
      .select('user_id')
      .eq('org_id', params.orgId)
      .eq('status', 'active')
      .eq('role', 'admin')
    const planLabel = params.plan.charAt(0).toUpperCase() + params.plan.slice(1)
    for (const a of admins ?? []) {
      await db.rpc('enqueue_email', {
        p_org: params.orgId,
        p_recipient_user: a.user_id,
        p_email_type: 'billing_update',
        p_category: 'billing',
        p_template_data: {
          template_type: 'billing_update',
          subject: `Your ${planLabel} plan is active`,
          headline: `Your ${planLabel} plan is now active`,
          message: `Your office is now on the ${planLabel} plan (${params.billingCycle}). Thanks for upgrading.`,
          plan: planLabel,
          renews_on: new Date(periodEnd).toLocaleDateString('en-NG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          cta_label: 'View billing',
          cta_path: '/settings',
        },
        p_dedupe_key: `bill:${params.orgId}:${params.plan}:${periodEnd}:${a.user_id}`,
        p_related_type: 'org',
        p_related_id: params.orgId,
      })
    }
  } catch {
    /* email is non-critical */
  }

  return { alreadyProcessed: false }
}
