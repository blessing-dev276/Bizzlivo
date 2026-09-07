// Supabase Edge Function (Deno): initiate a provider payout for an
// AUTHORIZED withdrawal (Finance Phase 2 — automated A2).
//
// The frontend NEVER calls a payment provider. It calls this function
// with only a withdrawal id; everything else — org, member, amount,
// recipient, capability — is resolved server-side from the database.
//
//   1. verify the caller's session
//   2. confirm the caller holds the org 'initiate_payout' capability
//   3. confirm the provider + office connection support transfers
//   4. lazily create the provider transfer recipient if missing
//   5. finance_transfer_begin()  -> reserves the attempt + idempotency key
//   6. provider.initiateTransfer(reference = idempotency key)
//   7. finance_transfer_ack()    -> store the provider transfer id
//   8. terminal result arrives via finance-transfer-webhook
//
// Required secrets: PAYSTACK_SECRET_KEY (+ FINANCE_PAYSTACK_TRANSFERS_ENABLED=true to arm)
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getFinanceProvider } from '../_shared/finance/index.ts'
import { toMinorUnits } from '../_shared/finance/money.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userErr } = await caller.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401)
    const actorId = userData.user.id

    const { withdrawal_id } = await req.json().catch(() => ({}))
    if (typeof withdrawal_id !== 'string') return json({ error: 'withdrawal_id is required.' }, 400)

    const db = createClient(url, service)

    // ---- load the withdrawal (server-side; nothing from the request body is trusted) ----
    const { data: w } = await db
      .from('withdrawal_requests')
      .select('id, org_id, member_id, status, amount, currency, payout_account_id')
      .eq('id', withdrawal_id)
      .maybeSingle()
    if (!w) return json({ error: 'Withdrawal not found.' }, 404)

    // ---- capability check as the caller ----
    const { data: canInitiate } = await caller.rpc('fin_can', { p_org: w.org_id, p_cap: 'initiate_payout' })
    if (canInitiate !== true) return json({ error: 'You are not permitted to initiate payouts.' }, 403)

    // ---- provider must actually support transfers ----
    let provider
    try { provider = getFinanceProvider('paystack') } catch { return json({ error: 'Finance provider not configured.' }, 500) }
    if (!provider.capabilities().supports_transfers) {
      return json({ error: 'Automated payouts are not enabled for this provider account.' }, 503)
    }

    // ---- lazily ensure a transfer recipient ----
    const { data: acct } = await db
      .from('member_payout_accounts')
      .select('id, account_number, bank_code, account_name, provider_recipient_code')
      .eq('id', w.payout_account_id ?? '')
      .maybeSingle()
    if (!acct) return json({ error: 'This withdrawal has no payout account.' }, 400)

    if (!acct.provider_recipient_code) {
      if (!acct.bank_code) return json({ error: 'Payout account is missing its bank code — the member should re-verify it.' }, 400)
      try {
        const { recipientCode } = await provider.createTransferRecipient({
          accountNumber: acct.account_number, bankCode: acct.bank_code,
          accountName: acct.account_name, currency: w.currency,
        })
        await db.rpc('finance_set_recipient', { p_account: acct.id, p_recipient_code: recipientCode })
        acct.provider_recipient_code = recipientCode
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Could not create the payout recipient.' }, 502)
      }
    }

    // ---- reserve the attempt + get the idempotency key ----
    const { data: begun, error: beginErr } = await db.rpc('finance_transfer_begin', {
      p_withdrawal: withdrawal_id, p_actor: actorId,
    })
    if (beginErr) return json({ error: beginErr.message }, 409)
    const b = begun as {
      payment_id: string; idempotency_key: string; recipient_code: string; amount: number; currency: string
    }

    // ---- initiate the transfer (reference = idempotency key; provider rejects dupes) ----
    try {
      const { providerTransferId, status } = await provider.initiateTransfer({
        recipientCode: b.recipient_code,
        amountMinor: toMinorUnits(b.amount, b.currency),
        currency: b.currency,
        reference: b.idempotency_key,
        reason: `Bizzlivo withdrawal ${b.idempotency_key}`,
      })
      await db.rpc('finance_transfer_ack', {
        p_payment: b.payment_id, p_provider_transfer_id: providerTransferId, p_provider_status: status,
      })
      // Paystack usually returns 'pending' and confirms via webhook; handle a rare synchronous success.
      if (status === 'success') {
        await db.rpc('finance_transfer_settle', {
          p_payment: b.payment_id, p_result: 'success', p_provider_transfer_id: providerTransferId,
        })
      } else if (status === 'failed') {
        await db.rpc('finance_transfer_settle', {
          p_payment: b.payment_id, p_result: 'failed', p_detail: 'provider rejected the transfer',
        })
        return json({ error: 'The provider rejected the transfer.' }, 502)
      }
      return json({ ok: true, status: status === 'success' ? 'paid' : 'processing' })
    } catch (e) {
      // roll the attempt to failed so the withdrawal is retryable, not stuck
      await db.rpc('finance_transfer_settle', {
        p_payment: b.payment_id, p_result: 'failed',
        p_detail: e instanceof Error ? e.message : 'transfer initiation failed',
      })
      return json({ error: e instanceof Error ? e.message : 'Could not initiate the transfer.' }, 502)
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
