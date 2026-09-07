// Supabase Edge Function (Deno): provider payout-transfer webhook
// (Finance Phase 2). Turns a provider `transfer.*` event into a terminal
// withdrawal state.
//
//   1. verify the provider signature over the RAW body
//   2. dedupe on a hash of the raw body (finance_record_webhook_event)
//   3. parse -> map the transfer reference to a withdrawal_payments row
//   4. RE-VERIFY the transfer against the provider API (never trust the body)
//   5. finance_transfer_settle(success | failed | reversed)
//
// Mirrors the billing paystack-webhook: signature check, re-verify, act
// idempotently. Unknown / non-transfer events are acknowledged (200) so
// the provider stops retrying.
//
// Required secrets: PAYSTACK_SECRET_KEY
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getFinanceProvider } from '../_shared/finance/index.ts'
import { sha256Hex } from '../_shared/finance/money.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    let provider
    try { provider = getFinanceProvider('paystack') } catch {
      return json({ error: 'Finance provider not configured.' }, 500)
    }

    const rawBody = await req.text()
    if (!(await provider.verifyWebhook(rawBody, req.headers))) {
      return json({ error: 'Invalid signature.' }, 401)
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const sigHash = await sha256Hex(rawBody)

    let eventType = 'unknown'
    try { eventType = String(JSON.parse(rawBody)?.event ?? 'unknown') } catch { /* keep default */ }
    let providerEventId = ''
    try { providerEventId = String(JSON.parse(rawBody)?.data?.id ?? '') } catch { /* ignore */ }

    const { data: isNew } = await db.rpc('finance_record_webhook_event', {
      p_provider: 'paystack', p_event_type: eventType, p_event_id: providerEventId, p_sig_hash: sigHash,
    })
    if (isNew !== true) return json({ received: true, duplicate: true })

    const ev = provider.parseWebhook(rawBody)
    if (!ev || !ev.reference) {
      await db.rpc('finance_mark_webhook_event', { p_sig_hash: sigHash, p_result: 'ignored', p_detail: eventType })
      return json({ received: true, ignored: 'not a transfer event' })
    }

    const { data: pay } = await db
      .from('withdrawal_payments')
      .select('id, status')
      .eq('idempotency_key', ev.reference)
      .maybeSingle()
    if (!pay) {
      await db.rpc('finance_mark_webhook_event', { p_sig_hash: sigHash, p_result: 'ignored', p_detail: 'unknown reference' })
      return json({ received: true, ignored: 'unknown reference' })
    }

    // never trust the webhook body's own status — re-verify
    let status = ev.status
    try {
      const verified = await provider.getTransferStatus(ev.reference)
      if (verified.status !== 'unknown') status = verified.status
    } catch { /* fall back to the event-derived status */ }

    const result = status === 'success' ? 'success'
      : status === 'reversed' ? 'reversed'
      : status === 'failed' ? 'failed'
      : null
    if (!result) {
      await db.rpc('finance_mark_webhook_event', { p_sig_hash: sigHash, p_result: 'ignored', p_detail: `status ${status}` })
      return json({ received: true, ignored: `non-terminal status ${status}` })
    }

    const { error: settleErr } = await db.rpc('finance_transfer_settle', {
      p_payment: pay.id, p_result: result,
      p_provider_transfer_id: ev.providerTransferId ?? '',
      p_detail: result === 'success' ? null : `provider transfer ${result}`,
    })
    await db.rpc('finance_mark_webhook_event', {
      p_sig_hash: sigHash, p_result: settleErr ? 'error' : 'applied', p_detail: settleErr?.message ?? result,
    })
    if (settleErr) return json({ error: settleErr.message }, 500)
    return json({ received: true, applied: result })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
