// Supabase Edge Function (Deno): approve a pending_members join request
// (from a public exam link or an office-login "request to join").
// Creates the real invite row and emails the person a link to set a
// password plus their office's branded login URL — all server-side so
// the Resend API key never touches the browser.
//
// POST /functions/v1/approve-pending-member
// Body: { pendingMemberId, siteUrl }   (siteUrl = window.location.origin of the caller)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendTransactionalEmail } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_ROLES = ['owner', 'admin']
const INVITE_EXPIRY_DAYS = 7

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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // RESEND_API_KEY absence no longer blocks approval — the invite is
    // still created and the link returned; the email step just reports
    // emailSent:false (handled below).

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    const { pendingMemberId, siteUrl } = await req.json()
    if (!pendingMemberId || !siteUrl) {
      return jsonResponse({ error: 'pendingMemberId and siteUrl are required.' }, 400)
    }

    const db = createClient(supabaseUrl, serviceKey)

    const { data: pending, error: pendingError } = await db
      .from('pending_members')
      .select('id, org_id, full_name, email, status')
      .eq('id', pendingMemberId)
      .single()
    if (pendingError || !pending) return jsonResponse({ error: 'Join request not found.' }, 404)
    if (pending.status !== 'pending') return jsonResponse({ error: 'This request has already been reviewed.' }, 410)

    const { data: membership } = await db
      .from('memberships')
      .select('role')
      .eq('org_id', pending.org_id)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership || !ADMIN_ROLES.includes(membership.role)) {
      return jsonResponse({ error: 'You do not have permission to approve members for this office.' }, 403)
    }

    const { data: org, error: orgError } = await db.from('organizations').select('name, slug').eq('id', pending.org_id).single()
    if (orgError || !org) return jsonResponse({ error: 'Office not found.' }, 404)

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { error: inviteError } = await db.from('invites').insert({
      org_id: pending.org_id,
      email: pending.email,
      role: 'member',
      token,
      invited_by: userData.user.id,
      expires_at: expiresAt,
    })
    if (inviteError) return jsonResponse({ error: inviteError.message }, 500)

    const { error: updateError } = await db
      .from('pending_members')
      .update({ status: 'approved', reviewed_by: userData.user.id, reviewed_at: new Date().toISOString() })
      .eq('id', pendingMemberId)
    if (updateError) return jsonResponse({ error: updateError.message }, 500)

    const inviteUrl = `${siteUrl}/invite/${token}`
    const loginUrl = `${siteUrl}/o/${org.slug}/login`

    const emailRes = await sendTransactionalEmail({
      db,
      orgId: pending.org_id,
      emailType: 'member_invite',
      templateType: 'member_invite',
      templateData: {
        subject: `You've been invited to join ${org.name} on Bizzlivo`,
        headline: `Join ${org.name} on Bizzlivo`,
        recipient_name: pending.full_name,
        invite_url: inviteUrl,
        login_url: loginUrl,
        expires_in_days: INVITE_EXPIRY_DAYS,
      },
      recipientEmail: pending.email,
    })

    await db.rpc('log_email_send', {
      p_org: pending.org_id,
      p_recipient_user: null,
      p_recipient_email: pending.email,
      p_email_type: 'member_invite',
      p_category: 'invite',
      p_subject: emailRes.subject ?? null,
      p_status: emailRes.ok ? 'sent' : 'failed',
      p_provider_message_id: emailRes.id ?? null,
      p_dedupe_key: `invite:${token}`,
      p_related_type: 'invite',
      p_related_id: null,
      p_error: emailRes.ok ? null : (emailRes.error ?? '').slice(0, 500),
    })

    if (!emailRes.ok) {
      // Invite + approval already succeeded — surface the email failure separately
      // so the admin can still hand the link over manually rather than losing the approval.
      return jsonResponse({ approved: true, emailSent: false, inviteUrl, error: 'Email failed to send.' }, 200)
    }

    return jsonResponse({ approved: true, emailSent: true, inviteUrl })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
