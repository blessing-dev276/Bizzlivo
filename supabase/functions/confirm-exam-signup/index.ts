// Supabase Edge Function (Deno): confirm a brand-new account created
// while signing up on a public exam link, without making the person
// click a second "confirm your email" message before they can start
// the exam they just registered for.
//
// Unlike confirm-invite-signup (which validates against a specific,
// admin-issued, single-email invite), this is self-service — anyone
// with a valid, still-public exam link can sign up with any email, so
// there's no invite row to check the email against. The only gate is
// that the exam link itself is still valid; this is the deliberate
// trust-model tradeoff of "register them immediately" auto-signup.
//
// POST /functions/v1/confirm-exam-signup
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

    const { data: exam, error: examError } = await db
      .from('exams')
      .select('id, public_link_enabled, status')
      .eq('public_token', token)
      .maybeSingle()
    if (examError || !exam || !exam.public_link_enabled || exam.status !== 'published') {
      return jsonResponse({ error: 'This exam link is not available.' }, 404)
    }

    const { data: userData, error: userError } = await db.auth.admin.getUserById(userId)
    if (userError || !userData.user) return jsonResponse({ error: 'Account not found.' }, 404)

    if (!userData.user.email_confirmed_at) {
      const { error: confirmError } = await db.auth.admin.updateUserById(userId, { email_confirm: true })
      if (confirmError) return jsonResponse({ error: confirmError.message }, 500)
    }

    return jsonResponse({ confirmed: true })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
