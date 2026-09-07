// Supabase Edge Function (Deno): called by the frontend immediately after
// Flutterwave's inline checkout reports success, so the Billing page can
// flip to "active" without waiting on webhook delivery. The
// flutterwave-webhook function is the durable path that still fires
// independently — activatePaidPlan() is idempotent on provider_ref, so
// whichever of the two runs first wins and the other is a no-op.
//
// Required secrets (set via `supabase secrets set`):
//   FLUTTERWAVE_SECRET_KEY
// Auto-provided by the Supabase runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  activatePaidPlan,
  isValidPlanCode,
  toKobo,
  verifyFlutterwaveTransaction,
} from '../_shared/flutterwave.ts'
import type { BillingCycle } from '../_shared/flutterwave.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const secretKey = Deno.env.get('FLUTTERWAVE_SECRET_KEY')
    if (!secretKey) return jsonResponse({ error: 'Server misconfigured: FLUTTERWAVE_SECRET_KEY not set.' }, 500)

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    const { transactionId } = await req.json()
    if (!transactionId) return jsonResponse({ error: 'transactionId is required.' }, 400)

    const verified = await verifyFlutterwaveTransaction(secretKey, transactionId)
    if (verified.status !== 'success' || verified.data?.status !== 'successful') {
      return jsonResponse({ error: 'Transaction was not successful.' }, 402)
    }

    const meta = (verified.data.meta ?? {}) as Record<string, unknown>
    const orgId = meta.org_id
    const plan = meta.plan
    const billingCycle = meta.billing_cycle as BillingCycle | undefined
    if (typeof orgId !== 'string' || !isValidPlanCode(plan) || plan === 'free' || (billingCycle !== 'monthly' && billingCycle !== 'yearly')) {
      return jsonResponse({ error: 'Transaction is missing valid plan metadata.' }, 400)
    }

    const db = createClient(supabaseUrl, serviceKey)
    const { data: membership } = await db
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return jsonResponse({ error: 'You do not have permission to manage billing for this office.' }, 403)
    }

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

    return jsonResponse({ activated: true, alreadyProcessed: result.alreadyProcessed, plan, billingCycle })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
