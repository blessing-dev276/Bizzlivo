// Google redirects here with ?code&state. Validates state, exchanges the
// code server-side, encrypts the refresh token in the edge runtime, and
// upserts organization_integrations. Then redirects the browser back to
// Settings → Integrations. This function must be deployed with JWT
// verification OFF (Google calls it directly) — see config note in README.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID/SECRET, INTEGRATION_ENC_KEY, APP_URL

import { createClient } from 'npm:@supabase/supabase-js@2'
import { exchangeCode, fetchUserInfo, GOOGLE_SCOPES } from '../_shared/google.ts'
import { encryptSecret, integrationConfigured } from '../_shared/googleCrypto.ts'

function back(path: string): Response {
  const appUrl = Deno.env.get('APP_URL') ?? 'https://www.bizzlivo.com'
  return new Response(null, { status: 302, headers: { Location: `${appUrl}${path}` } })
}

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  const err = u.searchParams.get('error')
  if (err) return back(`/settings/integrations?google=denied`)
  if (!code || !state) return back(`/settings/integrations?google=error`)
  if (!integrationConfigured()) return back(`/settings/integrations?google=not_configured`)

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: st } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle()
    if (!st || new Date(st.expires_at) < new Date()) return back(`/settings/integrations?google=expired`)
    await db.from('oauth_states').delete().eq('state', state)

    const tok = await exchangeCode(code)
    if (tok.error || !tok.access_token) return back(`/settings/integrations?google=error`)
    if (!tok.refresh_token) {
      // Google only returns a refresh token on first consent; prompt=consent
      // forces it, but if a stale grant exists the admin must revoke access
      // in their Google account and retry.
      return back(`/settings/integrations?google=no_refresh`)
    }

    const info = await fetchUserInfo(tok.access_token)
    const encrypted = await encryptSecret(tok.refresh_token)

    await db.from('organization_integrations').upsert({
      org_id: st.org_id,
      provider: 'google',
      connected_by: st.user_id,
      google_account_email: info.email ?? null,
      google_account_id: info.sub ?? null,
      calendar_id: 'primary',
      encrypted_refresh_token: encrypted,
      scopes: GOOGLE_SCOPES,
      status: 'connected',
      connected_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: 'org_id,provider' })

    return back(`/settings/integrations?google=connected`)
  } catch {
    return back(`/settings/integrations?google=error`)
  }
})
