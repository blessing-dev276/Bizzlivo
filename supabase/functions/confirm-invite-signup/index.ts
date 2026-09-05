// Supabase Edge Function (Deno): confirm a brand-new account created while
// accepting an invite, without making the person click a second "confirm
// your email" message on top of the invite they already received.
//
// Receiving the invite at that exact email address is already proof of
// ownership — Supabase's own signup-confirmation step is redundant for this
// path, so this function admin-confirms the freshly-created auth user
// directly, scoped strictly to a still-pending, still-unexpired invite whose
// email matches the account being confirmed.
//
// POST /functions/v1/confirm-invite-signup
// Body: { token, userId }

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const { token, userId } = await req.json()
    if (!token || !userId) return jsonResponse({ error: 'token and userId are required.' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supabaseUrl, serviceKey)

    const { data: invite, error: inviteError } = await db.from('invites').select('*').eq('token', token).maybeSingle()
    if (inviteError || !invite) return jsonResponse({ error: 'Invite not found.' }, 404)
    if (invite.status !== 'pending') return jsonResponse({ error: 'This invite has already been used.' }, 410)
    if (new Date(invite.expires_at) < new Date()) return jsonResponse({ error: 'This invite has expired.' }, 410)

    const { data: userData, error: userError } = await db.auth.admin.getUserById(userId)
    if (userError || !userData.user) return jsonResponse({ error: 'Account not found.' }, 404)
    if ((userData.user.email ?? '').toLowerCase() !== (invite.email ?? '').toLowerCase()) {
      return jsonResponse({ error: 'This account does not match the invited email address.' }, 403)
    }

    if (!userData.user.email_confirmed_at) {
      const { error: confirmError } = await db.auth.admin.updateUserById(userId, { email_confirm: true })
      if (confirmError) return jsonResponse({ error: confirmError.message }, 500)
    }

    return jsonResponse({ confirmed: true })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
