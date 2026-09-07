// Supabase Edge Function (Deno): Flutterwave webhook receiver.
//
// The authoritative path for turning a payment into an active
// subscription — the frontend's post-checkout call to
// verify-flutterwave-transaction is a same-request shortcut for instant
// UI feedback, but a browser tab can close before that call fires.
//
// Flutterwave doesn't HMAC-sign the body; instead it sends the exact
// string you set as the webhook "Secret hash" in the dashboard, in the
// `verif-hash` header. We compare it to FLUTTERWAVE_WEBHOOK_HASH and then
// re-verify the transaction against the API before granting anything.
//
// Required secrets (set via `supabase secrets set`):
//   FLUTTERWAVE_SECRET_KEY   — re-verify the transaction server-side
//   FLUTTERWAVE_WEBHOOK_HASH — must equal the dashboard "Secret hash"
// Auto-provided by the Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  activatePaidPlan,
  isValidPlanCode,
  toKobo,
  verifyFlutterwaveTransaction,
} from '../_shared/flutterwave.ts'
import type { BillingCycle } from '../_shared/flutterwave.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const secretKey = Deno.env.get('FLUTTERWAVE_SECRET_KEY')
    const webhookHash = Deno.env.get('FLUTTERWAVE_WEBHOOK_HASH')
    if (!secretKey || !webhookHash) {
      return jsonResponse({ error: 'Server misconfigured: FLUTTERWAVE_SECRET_KEY / FLUTTERWAVE_WEBHOOK_HASH not set.' }, 500)
    }

    if (req.headers.get('verif-hash') !== webhookHash) {
      return jsonResponse({ error: 'Invalid signature.' }, 401)
    }

    const payload = await req.json()
    const event = payload.event as string | undefined
    const data = payload.data

    // charge.completed with a successful status is the only thing we act on.
    if ((event && event !== 'charge.completed') || !data?.id || data?.status !== 'successful') {
      return jsonResponse({ received: true, skipped: 'not a completed charge' })
    }

    // Never trust the webhook body's own claim — re-verify against the API.
    const verified = await verifyFlutterwaveTransaction(secretKey, data.id)
    if (verified.status !== 'success' || verified.data?.status !== 'successful') {
      return jsonResponse({ received: true, skipped: 'not a successful transaction' })
    }

    const meta = (verified.data.meta ?? {}) as Record<string, unknown>
    const orgId = meta.org_id
    const plan = meta.plan
    const billingCycle = meta.billing_cycle as BillingCycle | undefined
    if (typeof orgId !== 'string' || !isValidPlanCode(plan) || plan === 'free' || (billingCycle !== 'monthly' && billingCycle !== 'yearly')) {
      return jsonResponse({ received: true, skipped: 'missing/invalid metadata on transaction' })
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const result = await activatePaidPlan(db, {
      orgId,
      plan,
      billingCycle,
      amountKobo: toKobo(verified.data.amount),
      currency: verified.data.currency,
      providerRef: verified.data.tx_ref,
      providerCustomerId: verified.data.customer?.id != null ? String(verified.data.customer.id) : null,
      provider: 'flutterwave',
    })

    return jsonResponse({ received: true, alreadyProcessed: result.alreadyProcessed })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
