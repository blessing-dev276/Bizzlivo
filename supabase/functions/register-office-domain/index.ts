// Supabase Edge Function (Deno): DEPRECATED — now a no-op.
//
// Office subdomains are served by a single wildcard domain
// `*.bizzlivo.com` on the Vercel project (DNS hosted on Vercel, wildcard
// TLS cert issued automatically). Every <slug>.bizzlivo.com routes and
// gets HTTPS with zero per-office setup, so there is nothing to register.
//
// Kept deployed only so an older client build that still calls this
// endpoint gets a clean success response instead of a 404. Safe to
// delete once no deployed frontend references it.
//
// POST /functions/v1/register-office-domain  ->  { skipped: true }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return new Response(
    JSON.stringify({
      skipped: true,
      reason: 'Office subdomains use the *.bizzlivo.com wildcard domain; no per-office registration is needed.',
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
