// Supabase Edge Function (Deno): short Claude-generated summary of an
// office's activity today, for the Dashboard "AI Welcome" panel.
//
// Cached one-per-org-per-day on organizations.ai_summary_text/date so a
// dashboard reload doesn't re-call Claude — only the first admin to load
// the dashboard on a given day pays for a generation.
//
// Required secrets (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY
// Auto-provided by the Supabase runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_ROLES = ['owner', 'admin', 'instructor']
const CLAUDE_MODEL = 'claude-opus-4-8'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return jsonResponse({ error: 'Server misconfigured: ANTHROPIC_API_KEY not set.' }, 500)

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    const { orgId } = await req.json()
    if (!orgId) return jsonResponse({ error: 'orgId is required.' }, 400)

    const db = createClient(supabaseUrl, serviceKey)

    const { data: membership } = await db
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership || !ADMIN_ROLES.includes(membership.role)) {
      return jsonResponse({ error: 'You do not have permission to view this office.' }, 403)
    }

    const { data: org, error: orgError } = await db
      .from('organizations')
      .select('name, ai_summary_text, ai_summary_date')
      .eq('id', orgId)
      .single()
    if (orgError || !org) return jsonResponse({ error: 'Office not found.' }, 404)

    const today = todayUTC()
    if (org.ai_summary_text && org.ai_summary_date === today) {
      return jsonResponse({ summary: org.ai_summary_text, cached: true })
    }

    const todayStart = `${today}T00:00:00.000Z`
    const [resourcesRes, attemptsRes, courseworkRes, membersRes, invitesRes] = await Promise.all([
      db.from('resources').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', todayStart),
      db.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'submitted').gte('submitted_at', todayStart),
      db.from('coursework_submissions').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('submitted_at', todayStart),
      db.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active').gte('joined_at', todayStart),
      db.from('invites').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', todayStart),
    ])

    const stats = {
      resourcesUploaded: resourcesRes.count ?? 0,
      examsCompleted: attemptsRes.count ?? 0,
      courseworkSubmitted: courseworkRes.count ?? 0,
      newMembers: membersRes.count ?? 0,
      invitesSent: invitesRes.count ?? 0,
    }
    const totalActivity = Object.values(stats).reduce((a, b) => a + b, 0)

    const anthropic = new Anthropic({ apiKey: anthropicKey })
    let summary: string

    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        output_config: { effort: 'low' },
        system: `You write a single short, warm sentence (max ~30 words) summarizing today's activity for an office admin's dashboard. Only reference the exact numbers given below — never invent activity, names, or events that weren't provided. If every count is zero, write an encouraging "quiet day" sentence instead of listing zeros. No markdown, no preamble, just the sentence.`,
        messages: [{
          role: 'user',
          content: `Office: "${org.name}". Today's activity — resources uploaded: ${stats.resourcesUploaded}, exams completed: ${stats.examsCompleted}, coursework submitted: ${stats.courseworkSubmitted}, new members joined: ${stats.newMembers}, invites sent: ${stats.invitesSent}.`,
        }],
      })
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      summary = textBlock?.text.trim() ?? ''
      if (!summary) throw new Error('empty response')
    } catch {
      // Fall back to a plain templated sentence rather than failing the whole panel.
      summary = totalActivity === 0
        ? `Quiet so far today at ${org.name} — nothing logged yet.`
        : `${totalActivity} update${totalActivity === 1 ? '' : 's'} at ${org.name} today.`
    }

    await db.from('organizations').update({ ai_summary_text: summary, ai_summary_date: today }).eq('id', orgId)

    return jsonResponse({ summary, cached: false })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
