// Drains email_outbox -> Resend.
//
// No pg_cron in this project yet, so this is invoked:
//   * lazily by the app (piggy-backed on an existing app-load sync call),
//   * or manually by a platform admin,
//   * or by an external scheduler later (set EMAIL_WORKER_SECRET and hit
//     this with header x-worker-secret).
//
// Auth: a valid x-worker-secret OR a platform-admin JWT. Everything the
// worker does runs through the service-role client; email_outbox_claim /
// _mark refuse authenticated non-service callers at the DB level too.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendTransactionalEmail, serviceClient } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  // --- authorise -------------------------------------------------
  const workerSecret = Deno.env.get('EMAIL_WORKER_SECRET')
  const providedSecret = req.headers.get('x-worker-secret')
  let authorised = !!workerSecret && providedSecret === workerSecret

  if (!authorised) {
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: u } = await caller.auth.getUser()
      if (u?.user) {
        const { data: isAdmin } = await caller.rpc('is_platform_admin')
        authorised = isAdmin === true
      }
    }
  }
  if (!authorised) return json({ error: 'Not authorised.' }, 403)

  // --- drain ---------------------------------------------------
  const db = serviceClient()
  let batchSize = 25
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.limit === 'number') batchSize = Math.max(1, Math.min(body.limit, 100))
  } catch {
    /* no body */
  }

  const { data: claimed, error: claimErr } = await db.rpc('email_outbox_claim', { p_limit: batchSize })
  if (claimErr) return json({ error: claimErr.message }, 500)

  const rows = (claimed ?? []) as Array<{
    id: string
    org_id: string | null
    recipient_email: string
    email_type: string
    category: string
    template_data: Record<string, unknown>
  }>

  let sent = 0
  let failed = 0
  for (const row of rows) {
    const res = await sendTransactionalEmail({
      db,
      orgId: row.org_id,
      emailType: row.email_type,
      templateType: (row.template_data?.template_type as string) || row.email_type,
      templateData: row.template_data ?? {},
      recipientEmail: row.recipient_email,
      replyTo: row.category === 'support' ? Deno.env.get('SUPPORT_EMAIL') ?? undefined : undefined,
    })
    await db.rpc('email_outbox_mark', {
      p_id: row.id,
      p_status: res.ok ? 'sent' : 'failed',
      p_provider_message_id: res.id ?? null,
      p_error: res.ok ? null : (res.error ?? 'unknown').slice(0, 500),
    })
    res.ok ? sent++ : failed++
  }

  return json({ claimed: rows.length, sent, failed })
})
