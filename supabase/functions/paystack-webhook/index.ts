// Supabase Edge Function (Deno): Paystack webhook receiver.
//
// This is the authoritative path for turning a payment into an active
// subscription — the frontend's post-checkout call to
// verify-paystack-transaction is a same-request shortcut for instant UI
// feedback, but a browser tab can close before that call fires. The webhook
// is what guarantees the org gets upgraded even then.
//
// Required secrets (set via `supabase secrets set`):
//   PAYSTACK_SECRET_KEY — used both to re-verify the transaction server-side
//                         and to check the webhook's HMAC signature
// Auto-provided by the Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import { activatePaidPlan, isValidPlanCode, verifyPaystackTransaction } from '../_shared/paystack.ts'
import type { BillingCycle } from '../_shared/paystack.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Paystack signs the raw request body with your secret key (HMAC-SHA512)
// and sends the hex digest in x-paystack-signature — unlike a static shared
// hash, this must be computed from the exact bytes Paystack sent, which is
// why the body is read as text before any JSON.parse below.
async function isValidSignature(secretKey: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === signature
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY')
    if (!secretKey) {
      return jsonResponse({ error: 'Server misconfigured: PAYSTACK_SECRET_KEY not set.' }, 500)
    }

    const rawBody = await req.text()
    if (!(await isValidSignature(secretKey, rawBody, req.headers.get('x-paystack-signature')))) {
      return jsonResponse({ error: 'Invalid signature.' }, 401)
    }

    const payload = JSON.parse(rawBody)
    const event = payload.event as string | undefined
    const data = payload.data

    if (event !== 'charge.success' || !data?.reference) {
      // Other event types (e.g. subscription.disable) aren't acted on yet —
      // acknowledge with 200 so Paystack doesn't retry a webhook we simply
      // don't have a handler for.
      return jsonResponse({ received: true })
    }

    // Never trust the webhook body's own "success" claim — re-verify
    // against Paystack's API using the secret key before granting access.
    const verified = await verifyPaystackTransaction(secretKey, data.reference)
    if (!verified.status || verified.data?.status !== 'success') {
      return jsonResponse({ received: true, skipped: 'not a successful transaction' })
    }

    const metadata = (verified.data.metadata ?? {}) as Record<string, unknown>
    const orgId = metadata.org_id
    const plan = metadata.plan
    const billingCycle = metadata.billing_cycle as BillingCycle | undefined
    if (typeof orgId !== 'string' || !isValidPlanCode(plan) || (billingCycle !== 'monthly' && billingCycle !== 'yearly')) {
      return jsonResponse({ received: true, skipped: 'missing/invalid metadata on transaction' })
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const result = await activatePaidPlan(db, {
      orgId,
      plan,
      billingCycle,
      amountKobo: verified.data.amount,
      currency: verified.data.currency,
      providerRef: verified.data.reference,
      providerCustomerId: verified.data.customer?.customer_code ?? null,
    })

    return jsonResponse({ received: true, alreadyProcessed: result.alreadyProcessed })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
