// Supabase Edge Function (Deno): attach an office's branded subdomain
// (<slug>.bizzlivo.com) to the Vercel project so it gets its own TLS
// certificate and routes to the app.
//
// Called best-effort right after an office is created (see
// completeOfficeSignup). Safe to call again for the same office — an
// already-registered domain is reported as alreadyExists, not an error.
//
// Why per-domain instead of a wildcard: *.bizzlivo.com can't get a
// wildcard cert while DNS is hosted off Vercel (the DNS-01 challenge
// record can't be written into the registrar, and the `*` CNAME shadows
// it). A per-host domain validates over HTTP through the same `*` CNAME
// with no extra DNS, so unlimited offices "just work".
//
// POST /functions/v1/register-office-domain
// Body: { orgId }
//
// Required function secrets:
//   VERCEL_TOKEN       - Vercel access token with project access
//   VERCEL_PROJECT_ID  - e.g. prj_xxx (or the project name)
// Optional:
//   VERCEL_TEAM_ID     - required if the project lives under a team
//   OFFICE_ROOT_DOMAIN - defaults to "bizzlivo.com"

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_ROLES = ['owner', 'admin']

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Mirrors the frontend slugify() in src/lib/slug.ts — a defensive
// normalisation only; org.slug is already slugified at creation.
function normaliseSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
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

    const vercelToken = Deno.env.get('VERCEL_TOKEN')
    const vercelProjectId = Deno.env.get('VERCEL_PROJECT_ID')
    const vercelTeamId = Deno.env.get('VERCEL_TEAM_ID') // optional
    const rootDomain = Deno.env.get('OFFICE_ROOT_DOMAIN') ?? 'bizzlivo.com'

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    const { orgId } = await req.json()
    if (!orgId) return jsonResponse({ error: 'orgId is required.' }, 400)

    const db = createClient(supabaseUrl, serviceKey)

    // Caller must be an active admin/owner of the office.
    const { data: membership } = await db
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership || !ADMIN_ROLES.includes(membership.role)) {
      return jsonResponse({ error: 'You do not have permission to manage this office.' }, 403)
    }

    const { data: org, error: orgError } = await db
      .from('organizations')
      .select('slug')
      .eq('id', orgId)
      .single()
    if (orgError || !org?.slug) return jsonResponse({ error: 'Office not found.' }, 404)

    const slug = normaliseSlug(org.slug)
    if (!slug) return jsonResponse({ error: 'Office has no usable slug.' }, 422)
    const domain = `${slug}.${rootDomain}`

    // Not configured yet (e.g. a preview environment): don't fail signup.
    if (!vercelToken || !vercelProjectId) {
      return jsonResponse({ domain, skipped: true, reason: 'Vercel domain automation is not configured.' })
    }

    const qs = vercelTeamId ? `?teamId=${encodeURIComponent(vercelTeamId)}` : ''
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(vercelProjectId)}/domains${qs}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      },
    )
    const payload = await res.json().catch(() => ({}))

    if (res.ok) {
      return jsonResponse({ domain, added: true })
    }

    // Already attached to THIS project on a previous run — treat as success.
    const code = payload?.error?.code
    if (res.status === 409 || code === 'domain_already_in_use' || code === 'domain_already_exists') {
      return jsonResponse({ domain, alreadyExists: true })
    }

    return jsonResponse(
      { domain, error: payload?.error?.message ?? `Vercel API responded ${res.status}.` },
      502,
    )
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
