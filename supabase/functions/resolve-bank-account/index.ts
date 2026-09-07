// Supabase Edge Function (Deno): backs the "Payout Account" form in the
// wallet. Two jobs, picked by the request body:
//
//   { action: 'banks' }
//     -> { banks: [{ name, code }] }  — every Nigerian bank the finance
//        provider knows, sorted by name. Cached for the warm instance.
//
//   { action: 'resolve', account_number, bank_code }
//     -> { account_name }             — provider NUBAN resolution, so the
//        account name is confirmed from the number and never typed by hand.
//
// Requires a valid Supabase session. Delegates to the FinanceProvider
// abstraction (_shared/finance) so another licensed provider can be added
// later without touching this endpoint.
//
// Required secrets: PAYSTACK_SECRET_KEY
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getFinanceProvider } from '../_shared/finance/index.ts'

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

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    let provider
    try {
      provider = getFinanceProvider('paystack')
    } catch {
      return jsonResponse({ error: 'Server misconfigured: finance provider not set up.' }, 500)
    }
    if (!provider.capabilities().supports_bank_resolution) {
      return jsonResponse({ error: 'Bank verification is not available for this office.' }, 503)
    }

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'banks') {
      const banks = await provider.listBanks('nigeria')
      if (banks.length === 0) return jsonResponse({ error: 'Could not load the bank list. Please try again.' }, 502)
      return jsonResponse({ banks })
    }

    if (action === 'resolve') {
      const accountNumber = String(body?.account_number ?? '').trim()
      const bankCode = String(body?.bank_code ?? '').trim()
      if (!/^\d{10}$/.test(accountNumber)) return jsonResponse({ error: 'Enter a valid 10-digit account number.' }, 400)
      if (!bankCode) return jsonResponse({ error: 'Select a bank first.' }, 400)

      try {
        const { accountName } = await provider.verifyBankAccount({ accountNumber, bankCode })
        return jsonResponse({ account_name: accountName })
      } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'We could not verify that account.' }, 422)
      }
    }

    return jsonResponse({ error: 'Unknown action.' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500)
  }
})
