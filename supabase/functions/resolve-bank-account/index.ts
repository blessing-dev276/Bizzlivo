// Supabase Edge Function (Deno): backs the "Add payout account" form in the
// wallet. Two jobs, picked by the request body:
//
//   { action: 'banks' }
//     -> { banks: [{ name, code }] }  — every Nigerian bank Paystack knows,
//        sorted by name. Cached for the life of the (warm) instance.
//
//   { action: 'resolve', account_number, bank_code }
//     -> { account_name }             — Paystack NUBAN resolution, so the
//        account name is confirmed from the number and never typed by hand.
//
// Requires a valid Supabase session (Authorization header). Uses the same
// PAYSTACK_SECRET_KEY as the billing functions.
//
// Required secrets: PAYSTACK_SECRET_KEY
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

interface Bank {
  name: string
  code: string
}

// Populated on first successful fetch, reused while the instance stays warm.
let bankCache: Bank[] | null = null

async function fetchNigerianBanks(secretKey: string): Promise<Bank[]> {
  if (bankCache) return bankCache
  const seen = new Map<string, string>() // code -> name (dedupes across pages)
  let next: string | null = 'https://api.paystack.co/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100'

  while (next) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${secretKey}` } })
    const body = await res.json()
    if (!body?.status || !Array.isArray(body.data)) break
    for (const b of body.data) {
      if (b?.code && b?.name && !seen.has(b.code)) seen.set(b.code, b.name)
    }
    const cursor = body.meta?.next
    next = cursor ? `https://api.paystack.co/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100&next=${encodeURIComponent(cursor)}` : null
  }

  const banks = [...seen.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (banks.length > 0) bankCache = banks
  return banks
}

async function resolveAccount(secretKey: string, accountNumber: string, bankCode: string): Promise<string | null> {
  const url = `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secretKey}` } })
  const body = await res.json()
  if (!body?.status || !body.data?.account_name) return null
  return String(body.data.account_name)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY')
    if (!secretKey) return jsonResponse({ error: 'Server misconfigured: PAYSTACK_SECRET_KEY not set.' }, 500)

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'banks') {
      const banks = await fetchNigerianBanks(secretKey)
      if (banks.length === 0) return jsonResponse({ error: 'Could not load the bank list. Please try again.' }, 502)
      return jsonResponse({ banks })
    }

    if (action === 'resolve') {
      const accountNumber = String(body?.account_number ?? '').trim()
      const bankCode = String(body?.bank_code ?? '').trim()
      if (!/^\d{10}$/.test(accountNumber)) return jsonResponse({ error: 'Enter a valid 10-digit account number.' }, 400)
      if (!bankCode) return jsonResponse({ error: 'Select a bank first.' }, 400)

      const accountName = await resolveAccount(secretKey, accountNumber, bankCode)
      if (!accountName) {
        return jsonResponse({ error: 'We could not verify that account. Check the number and bank.' }, 422)
      }
      return jsonResponse({ account_name: accountName })
    }

    return jsonResponse({ error: 'Unknown action.' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500)
  }
})
