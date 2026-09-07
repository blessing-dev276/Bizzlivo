// Supabase Edge Function (Deno): start an office signup with a
// Bizzlivo-branded email confirmation.
//
// The default supabase.auth.signUp() confirmation email is sent by
// Supabase's own mailer and links to <ref>.supabase.co. This function
// creates the account UNCONFIRMED, generates the confirmation link, and
// sends it through Resend from the Bizzlivo domain instead (same setup
// the rest of the app's transactional mail uses). The office itself is
// still created on the user's first login after confirming — see
// completeOfficeSignup — so an unconfirmed signup leaves no org behind.
//
// POST /functions/v1/office-signup   (public — no session yet)
//   { action?: 'start' | 'resend', fullName, officeName, email, password, siteUrl }
//
// Always replies 200 for user-facing outcomes:
//   { ok: true }
//   { ok: false, error, code?: 'already_confirmed' | 'email_failed' }

import { createClient } from 'npm:@supabase/supabase-js@2'
import { fromAddress, sendEmail } from '../_shared/email.ts'
import { renderTemplate } from '../_shared/email-templates.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function resolveSiteUrl(raw: unknown): string {
  const fallback = Deno.env.get('APP_URL') ?? 'https://bizzlivo.com'
  const v = String(raw ?? '').trim()
  if (!v) return fallback
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback
    return `${u.protocol}//${u.host}`
  } catch {
    return fallback
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supabaseUrl, serviceKey)

    const payload = await req.json().catch(() => ({}))
    const fullName = String(payload.fullName ?? '').trim()
    const officeName = String(payload.officeName ?? '').trim()
    const email = String(payload.email ?? '').trim().toLowerCase()
    const password = String(payload.password ?? '')
    const siteUrl = resolveSiteUrl(payload.siteUrl)
    const redirectTo = `${siteUrl}/login?confirmed=1`

    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a valid email address.' })
    if (password.length < 8) return json({ ok: false, error: 'Password must be at least 8 characters.' })
    if (!fullName || !officeName) return json({ ok: false, error: 'Your name and office name are both required.' })

    // Is there already an account on this email?
    const { data: existing } = await db
      .schema('auth')
      .from('users')
      .select('id, email_confirmed_at')
      .eq('email', email)
      .maybeSingle()

    if (existing?.email_confirmed_at) {
      return json({
        ok: false,
        code: 'already_confirmed',
        error: 'An account with this email is already confirmed. Please log in instead.',
      })
    }

    const userMeta = { full_name: fullName, office_name: officeName }

    if (!existing?.id) {
      const { error: createErr } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: userMeta,
      })
      if (createErr) return json({ ok: false, error: createErr.message })
    } else {
      // Unconfirmed account already exists (a first attempt, or a resend
      // with a corrected password / details). Refresh it.
      await db.auth.admin.updateUserById(existing.id, { password, user_metadata: userMeta })
    }

    // Generate the confirmation link WITHOUT sending Supabase's own email.
    let confirmUrl: string | undefined
    const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: { redirectTo, data: userMeta },
    })
    confirmUrl = linkData?.properties?.action_link
    if (!confirmUrl) {
      // Some auth versions won't re-issue a 'signup' link for an existing
      // user; a magic link verifies ownership just as well.
      const { data: mag } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo },
      })
      confirmUrl = mag?.properties?.action_link
    }
    if (!confirmUrl) {
      return json({ ok: false, error: linkErr?.message ?? 'Could not generate a confirmation link.' })
    }

    const { subject, html } = renderTemplate('account_confirm', {
      subject: 'Confirm your email to finish creating your office',
      headline: 'Confirm your email',
      recipient_name: fullName,
      office_name: officeName,
      confirm_url: confirmUrl,
    })

    const res = await sendEmail({
      to: email,
      subject,
      html,
      from: fromAddress(),
      tags: [{ name: 'type', value: 'account_confirm' }],
    })

    if (!res.ok) {
      return json({
        ok: false,
        code: 'email_failed',
        error: `Your account was created, but the confirmation email could not be sent (${res.error}). Try again in a moment.`,
      })
    }

    return json({ ok: true })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
