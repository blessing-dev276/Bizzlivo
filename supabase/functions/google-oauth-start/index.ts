// Admin starts connecting the office Google account. Returns the consent
// URL; the browser navigates there. State is a random token persisted in
// oauth_states (CSRF) and validated by google-oauth-callback.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, INTEGRATION_ENC_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import { consentUrl } from '../_shared/google.ts'
import { integrationConfigured } from '../_shared/googleCrypto.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!integrationConfigured()) return json({ error: 'not_configured', message: 'Google integration is not set up on this deployment.' }, 200)

  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing Authorization.' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const { data: u } = await caller.auth.getUser()
    if (!u.user) return json({ error: 'Invalid session.' }, 401)

    const { orgId } = await req.json()
    if (!orgId) return json({ error: 'orgId required.' }, 400)

    const db = createClient(url, svc)
    const { data: m } = await db.from('memberships').select('role').eq('org_id', orgId).eq('user_id', u.user.id).eq('status', 'active').maybeSingle()
    if (!m || m.role !== 'admin') return json({ error: 'Only an office admin can connect Google.' }, 403)

    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
    const { error } = await db.from('oauth_states').insert({ state, org_id: orgId, user_id: u.user.id, provider: 'google' })
    if (error) return json({ error: error.message }, 500)

    return json({ url: consentUrl(state) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
