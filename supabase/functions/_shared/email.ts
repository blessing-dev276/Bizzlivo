// The one place that talks to the Resend API.
//
// Nothing else in the codebase calls https://api.resend.com directly.
// RESEND_API_KEY is read here only, never returned in a response, never
// logged.
//
// Two entry points:
//   sendEmail()            — low-level: render + POST to Resend.
//   sendTransactionalEmail()— orchestrator used by the outbox worker &
//                             the send-email function: resolves branding,
//                             renders the template, sends, and reports a
//                             structured result (never throws).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { renderTemplate } from './email-templates.ts'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function fromAddress(): string {
  const email = Deno.env.get('RESEND_FROM_EMAIL') ?? 'notifications@bizzlivo.com'
  const name = Deno.env.get('RESEND_FROM_NAME') ?? 'Bizzlivo'
  return `${name} <${email}>`
}

export function supportAddress(): string {
  return Deno.env.get('SUPPORT_EMAIL') ?? 'support@bizzlivo.com'
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
  tags?: { name: string; value: string }[]
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  error?: string
  status?: number
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const to = (Array.isArray(input.to) ? input.to : [input.to])
    .map((a) => String(a || '').trim().toLowerCase())
    .filter((a) => a.includes('@'))
  if (to.length === 0) return { ok: false, error: 'no valid recipient' }

  const body: Record<string, unknown> = {
    from: input.from || fromAddress(),
    to,
    subject: input.subject,
    html: input.html,
  }
  if (input.replyTo) body.reply_to = input.replyTo
  if (input.tags?.length) body.tags = input.tags

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      // Never surface the key; Resend errors are safe to pass through.
      return { ok: false, error: text.slice(0, 500), status: res.status }
    }
    let id: string | undefined
    try {
      id = JSON.parse(text)?.id
    } catch {
      /* ignore */
    }
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

// ------------------------------------------------------------------
// Branding lookup — only apply the org logo / colour when the org's
// plan actually grants custom_branding.
// ------------------------------------------------------------------
async function loadBranding(
  db: SupabaseClient,
  orgId?: string | null,
): Promise<{ org_name: string; org_logo_url: string | null; brand_color: string | null }> {
  if (!orgId) return { org_name: 'Bizzlivo', org_logo_url: null, brand_color: null }
  const { data: org } = await db
    .from('organizations')
    .select('name, logo_url, brand_color, plan_tier')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return { org_name: 'Bizzlivo', org_logo_url: null, brand_color: null }

  let customBranding = false
  const { data: limit } = await db
    .from('plan_limits')
    .select('custom_branding')
    .eq('plan_tier', org.plan_tier)
    .maybeSingle()
  customBranding = !!limit?.custom_branding

  return {
    org_name: org.name || 'Bizzlivo',
    org_logo_url: customBranding ? org.logo_url ?? null : null,
    brand_color: customBranding ? org.brand_color ?? null : null,
  }
}

export interface TransactionalInput {
  db: SupabaseClient
  orgId?: string | null
  emailType: string
  templateType?: string // defaults to emailType
  templateData: Record<string, unknown>
  recipientEmail: string
  replyTo?: string
}

export interface TransactionalResult {
  ok: boolean
  id?: string
  subject?: string
  error?: string
}

// Render + send. Does NOT write email_log — the caller (outbox worker
// via email_outbox_mark, or send-email via log_email_send) records the
// outcome so logging stays transactional with queue state.
export async function sendTransactionalEmail(input: TransactionalInput): Promise<TransactionalResult> {
  try {
    const branding = await loadBranding(input.db, input.orgId)
    const data = { ...branding, ...input.templateData }
    const { subject, html } = renderTemplate(input.templateType || input.emailType, data)
    const res = await sendEmail({
      to: input.recipientEmail,
      subject,
      html,
      replyTo: input.replyTo,
      tags: [{ name: 'type', value: input.emailType.slice(0, 60).replace(/[^a-zA-Z0-9_-]/g, '_') }],
    })
    return res.ok
      ? { ok: true, id: res.id, subject }
      : { ok: false, error: res.error, subject }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'render/send failed' }
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
