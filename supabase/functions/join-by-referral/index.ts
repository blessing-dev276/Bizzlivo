// Supabase Edge Function (Deno): self-serve referral join.
//
// GET  ?code=<referral_code>   -> public preview { orgName, orgSlug, referrerName }
// POST { code }  (authenticated) -> joins the caller to that office as an
//   active member and records the code's owner as their sponsor.
//
// profiles.referral_code is only readable per-RLS by the owner and their
// org-mates, so a brand-new user can't resolve it client-side. This
// function uses the service role to bridge that gap safely: it validates
// the code itself and never trusts client input beyond the code string.
// It mirrors accept-invite.

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

  async function resolveCode(code: string) {
    const { data: referrer } = await db
      .from('profiles')
      .select('id, full_name')
      .eq('referral_code', code)
      .maybeSingle()
    if (!referrer) return null

    // A referral only makes sense inside an office the referrer actually
    // belongs to. Use their most recent active membership.
    const { data: membership } = await db
      .from('memberships')
      .select('org_id, organizations(name, slug)')
      .eq('user_id', referrer.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!membership) return null

    const org = membership.organizations as unknown as { name: string; slug: string } | null
    return {
      referrerId: referrer.id as string,
      referrerName: referrer.full_name as string,
      orgId: membership.org_id as string,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
    }
  }

  try {
    if (req.method === 'GET') {
      const code = new URL(req.url).searchParams.get('code')
      if (!code) return jsonResponse({ error: 'Missing referral code.' }, 400)
      const resolved = await resolveCode(code)
      if (!resolved) return jsonResponse({ error: 'This referral link is not valid.' }, 404)
      return jsonResponse({
        orgName: resolved.orgName,
        orgSlug: resolved.orgSlug,
        referrerName: resolved.referrerName,
      })
    }

    if (req.method === 'POST') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) return jsonResponse({ error: 'You must be logged in to join.' }, 401)

      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: userData, error: userError } = await callerClient.auth.getUser()
      if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)
      const user = userData.user

      const { code, fullName } = await req.json()
      if (!code) return jsonResponse({ error: 'Missing referral code.' }, 400)

      const resolved = await resolveCode(code)
      if (!resolved) return jsonResponse({ error: 'This referral link is not valid.' }, 404)

      const { data: existingProfile } = await db
        .from('profiles')
        .select('id, sponsor_member_id, sponsor_name')
        .eq('id', user.id)
        .maybeSingle()

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
        .eq('org_id', resolved.orgId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existingMembership) {
        const { error: membershipError } = await db.from('memberships').insert({
          org_id: resolved.orgId,
          user_id: user.id,
          role: 'member',
          status: 'active',
        })
        if (membershipError) return jsonResponse({ error: membershipError.message }, 500)
      }

      // Record the sponsor — only if the joiner has no sponsor yet and
      // isn't somehow their own referrer.
      const hasSponsor = !!(existingProfile?.sponsor_member_id || existingProfile?.sponsor_name)
      if (!hasSponsor && resolved.referrerId !== user.id) {
        await db.from('profiles').update({ sponsor_member_id: resolved.referrerId }).eq('id', user.id)
      }

      // Carry over any guest exam attempts taken at this email.
      if (user.email) {
        await db
          .from('attempts')
          .update({ user_id: user.id })
          .eq('org_id', resolved.orgId)
          .eq('is_guest', true)
          .is('user_id', null)
          .ilike('taker_email', user.email)
      }

      return jsonResponse({ orgId: resolved.orgId })
    }

    return jsonResponse({ error: 'Method not allowed.' }, 405)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
