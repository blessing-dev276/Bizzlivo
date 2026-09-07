// Admin disconnects the office Google account. Revokes the token at
// Google, then clears the stored credential and marks the integration
// disconnected. Bizzlivo events and their history are NOT touched.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { revokeToken } from '../_shared/google.ts'
import { decryptSecret } from '../_shared/googleCrypto.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing Authorization.' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await caller.auth.getUser()
    if (!u.user) return json({ error: 'Invalid session.' }, 401)

    const { orgId } = await req.json()
    if (!orgId) return json({ error: 'orgId required.' }, 400)

    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: m } = await db.from('memberships').select('role').eq('org_id', orgId).eq('user_id', u.user.id).eq('status', 'active').maybeSingle()
    if (!m || m.role !== 'admin') return json({ error: 'Only an office admin can manage integrations.' }, 403)

    const { data: integ } = await db.from('organization_integrations').select('encrypted_refresh_token').eq('org_id', orgId).eq('provider', 'google').maybeSingle()
    if (integ?.encrypted_refresh_token) {
      try { await revokeToken(await decryptSecret(integ.encrypted_refresh_token)) } catch { /* best effort */ }
    }

    await db.from('organization_integrations').update({
      status: 'disconnected', encrypted_refresh_token: null, scopes: [], last_error: null,
    }).eq('org_id', orgId).eq('provider', 'google')

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
