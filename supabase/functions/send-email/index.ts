// JWT-verified entry point for CLIENT-triggered transactional email.
//
// Server-forces the From address, re-derives the caller identity,
// re-checks org role for the specific action, applies a rate limit,
// sends synchronously (so the UI can show "sent" vs "couldn't send"),
// and records the result via log_email_send.
//
// Background / trigger-originated mail does NOT come here — it goes
// through email_outbox + process-email-outbox.
//
// POST /functions/v1/send-email
// Body: { action, ... }
//   action = 'invite_resend'  { inviteId, siteUrl }
//   action = 'finance_notice' { orgId, memberId, subject, message }

import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendTransactionalEmail, serviceClient, supportAddress } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const ADMIN_ROLES = ['admin']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userErr } = await caller.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401)
    const uid = userData.user.id

    const payload = await req.json()
    const action = String(payload?.action || '')
    const db = serviceClient()

    async function requireOrgAdmin(orgId: string) {
      const { data: m } = await db
        .from('memberships')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', uid)
        .eq('status', 'active')
        .maybeSingle()
      return !!m && ADMIN_ROLES.includes(m.role)
    }

    async function rateLimited(emailType: string, relatedId: string | null, maxPerHour: number) {
      const { data } = await db.rpc('recent_email_count', {
        p_email_type: emailType,
        p_related_id: relatedId,
        p_since: '01:00:00',
      })
      return (data ?? 0) >= maxPerHour
    }

    // --------------------------------------------------------
    if (action === 'invite_resend') {
      const inviteId = String(payload.inviteId || '')
      const siteUrl = String(payload.siteUrl || Deno.env.get('APP_URL') || 'https://bizzlivo.com')
      if (!inviteId) return json({ error: 'inviteId is required.' }, 400)

      const { data: invite } = await db
        .from('invites')
        .select('id, org_id, email, token, status, expires_at')
        .eq('id', inviteId)
        .maybeSingle()
      if (!invite) return json({ error: 'Invite not found.' }, 404)
      if (invite.status !== 'pending') return json({ error: 'This invite is no longer pending.' }, 410)
      if (!(await requireOrgAdmin(invite.org_id)))
        return json({ error: 'You cannot manage invites for this office.' }, 403)

      if (await rateLimited('invite_resend', invite.id, 3))
        return json({ error: 'This invite was re-sent very recently. Try again in a little while.' }, 429)

      const { data: org } = await db
        .from('organizations')
        .select('name, slug')
        .eq('id', invite.org_id)
        .maybeSingle()
      const expiresDays = invite.expires_at
        ? Math.max(1, Math.round((new Date(invite.expires_at).getTime() - Date.now()) / 86_400_000))
        : 7

      const res = await sendTransactionalEmail({
        db,
        orgId: invite.org_id,
        emailType: 'invite_resend',
        templateType: 'member_invite',
        templateData: {
          subject: `You've been invited to join ${org?.name ?? 'your office'} on Bizzlivo`,
          headline: `Join ${org?.name ?? 'your office'} on Bizzlivo`,
          invite_url: `${siteUrl}/invite/${invite.token}`,
          login_url: `${siteUrl}/o/${org?.slug ?? ''}/login`,
          expires_in_days: expiresDays,
        },
        recipientEmail: invite.email,
      })

      await db.rpc('log_email_send', {
        p_org: invite.org_id,
        p_recipient_user: null,
        p_recipient_email: invite.email,
        p_email_type: 'invite_resend',
        p_category: 'invite',
        p_subject: res.subject ?? null,
        p_status: res.ok ? 'sent' : 'failed',
        p_provider_message_id: res.id ?? null,
        p_dedupe_key: null,
        p_related_type: 'invite',
        p_related_id: invite.id,
        p_error: res.ok ? null : (res.error ?? '').slice(0, 500),
      })

      return res.ok
        ? json({ sent: true })
        : json({ sent: false, error: 'The invite email could not be sent right now.' }, 200)
    }

    // --------------------------------------------------------
    if (action === 'finance_notice') {
      const orgId = String(payload.orgId || '')
      const memberId = String(payload.memberId || '')
      const subject = String(payload.subject || '').trim().slice(0, 160)
      const message = String(payload.message || '').trim().slice(0, 4000)
      if (!orgId || !memberId || !subject || !message)
        return json({ error: 'orgId, memberId, subject and message are required.' }, 400)
      if (!(await requireOrgAdmin(orgId)))
        return json({ error: 'You cannot send finance notices for this office.' }, 403)

      const { data: target } = await db
        .from('memberships')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('user_id', memberId)
        .eq('status', 'active')
        .maybeSingle()
      if (!target) return json({ error: 'That member is not in this office.' }, 404)

      if (await rateLimited('finance_notice', null, 10))
        return json({ error: 'Too many finance notices sent in the last hour.' }, 429)

      const { data: authUser } = await db.auth.admin.getUserById(memberId)
      const email = authUser?.user?.email
      if (!email) return json({ error: 'That member has no email on file.' }, 422)

      const res = await sendTransactionalEmail({
        db,
        orgId,
        emailType: 'finance_notice',
        templateType: 'withdrawal_update',
        templateData: {
          subject,
          headline: subject,
          status: 'notice',
          note: message,
          cta_label: 'View wallet',
          cta_path: '/wallet',
        },
        recipientEmail: email,
        replyTo: supportAddress(),
      })

      await db.rpc('log_email_send', {
        p_org: orgId,
        p_recipient_user: memberId,
        p_recipient_email: email,
        p_email_type: 'finance_notice',
        p_category: 'finance',
        p_subject: subject,
        p_status: res.ok ? 'sent' : 'failed',
        p_provider_message_id: res.id ?? null,
        p_dedupe_key: null,
        p_related_type: 'org',
        p_related_id: orgId,
        p_error: res.ok ? null : (res.error ?? '').slice(0, 500),
      })

      await db.from('finance_events').insert({
        org_id: orgId,
        actor_id: uid,
        member_id: memberId,
        action: 'finance_notice_emailed',
        entity_type: 'org',
        entity_id: orgId,
        reason: subject,
      })

      return res.ok ? json({ sent: true }) : json({ sent: false, error: 'The notice could not be emailed.' }, 200)
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
