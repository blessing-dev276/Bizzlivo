// Supabase Edge Function (Deno): public exam link, pre-step — check
// whether an email already has an account, so the client can render a
// login form instead of a signup form. Anon-callable (the visitor
// isn't authenticated yet), runs on the service role key since
// `profiles` isn't readable by anon per RLS.
//
// GET /functions/v1/check-exam-link-account?token={public_token}&email=

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
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    const email = url.searchParams.get('email')?.trim()
    if (!token) return jsonResponse({ error: 'Missing token.' }, 400)
    if (!email) return jsonResponse({ error: 'Missing email.' }, 400)

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

    const { data: profile } = await db.from('profiles').select('id').ilike('email', email).maybeSingle()

    return jsonResponse({ hasAccount: !!profile })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
