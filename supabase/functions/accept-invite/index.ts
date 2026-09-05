// Supabase Edge Function (Deno): public invite lookup (GET) + invite
// acceptance (POST, requires an authenticated caller).
//
// The `invites` table's RLS only lets org owners/admins read rows, so an
// invitee who isn't a member yet can't look up their own invite client-side.
// This function uses the service role to bridge that gap safely, validating
// token/expiry/email itself instead of relying on RLS.

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(supabaseUrl, serviceKey)

  try {
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token')
      if (!token) return jsonResponse({ error: 'Missing token.' }, 400)

      const { data: invite } = await db
        .from('invites')
        .select('email, role, status, expires_at, organizations(name)')
        .eq('token', token)
        .maybeSingle()

      if (!invite) return jsonResponse({ error: 'Invite not found.' }, 404)
      const expired = invite.status !== 'pending' || new Date(invite.expires_at) < new Date()

      return jsonResponse({
        orgName: (invite.organizations as unknown as { name: string } | null)?.name ?? null,
        email: invite.email,
        role: invite.role,
        expired,
      })
    }

    if (req.method === 'POST') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) return jsonResponse({ error: 'You must be logged in to accept an invite.' }, 401)

      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: userData, error: userError } = await callerClient.auth.getUser()
      if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

      const { token, fullName } = await req.json()
      if (!token) return jsonResponse({ error: 'Missing token.' }, 400)

      const { data: invite, error: inviteError } = await db
        .from('invites')
        .select('*')
        .eq('token', token)
        .maybeSingle()
      if (inviteError || !invite) return jsonResponse({ error: 'Invite not found.' }, 404)
      if (invite.status !== 'pending') return jsonResponse({ error: 'This invite has already been used.' }, 410)
      if (new Date(invite.expires_at) < new Date()) return jsonResponse({ error: 'This invite has expired.' }, 410)

      const user = userData.user

      const { data: existingProfile } = await db.from('profiles').select('id').eq('id', user.id).maybeSingle()
      if (!existingProfile) {
        const { error: profileError } = await db.from('profiles').insert({
          id: user.id,
          full_name: fullName || user.email || 'New member',
          email: user.email,
        })
        if (profileError) return jsonResponse({ error: profileError.message }, 500)
      }

      const { data: existingMembership } = await db
        .from('memberships')
        .select('id')
        .eq('org_id', invite.org_id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existingMembership) {
        const { error: membershipError } = await db.from('memberships').insert({
          org_id: invite.org_id,
          user_id: user.id,
          role: invite.role,
          status: 'active',
        })
        if (membershipError) return jsonResponse({ error: membershipError.message }, 500)
      }

      // If they took a public-link exam as a guest before joining, link that
      // attempt to their new member profile — the score carries over into
      // their exam history instead of vanishing once they're a real member.
      if (invite.email) {
        await db
          .from('attempts')
          .update({ user_id: user.id })
          .eq('org_id', invite.org_id)
          .eq('is_guest', true)
          .is('user_id', null)
          .ilike('taker_email', invite.email)
      }

      await db.from('invites').update({ status: 'accepted' }).eq('id', invite.id)

      return jsonResponse({ orgId: invite.org_id })
    }

    return jsonResponse({ error: 'Method not allowed.' }, 405)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
