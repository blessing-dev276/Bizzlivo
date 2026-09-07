// Resolves an office's slug from a wildcard subdomain, e.g.
// "blaze-office.bizzlivo.com" -> "blaze-office". Requires a wildcard DNS
// record (*.bizzlivo.com) pointed here for that subdomain to actually
// route — this just reads whatever hostname the browser already landed on.
// The bare apex / www serves the marketing + generic login (returns null).
const ROOT_DOMAIN = 'bizzlivo.com'
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api', 'mail', 'staging', 'assets', 'cdn'])

export function getOfficeSlugFromHost(hostname: string): string | null {
  const suffix = `.${ROOT_DOMAIN}`
  if (!hostname.endsWith(suffix)) return null
  const sub = hostname.slice(0, -suffix.length)
  if (!sub || sub.includes('.') || RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}

// The shareable branded sign-in URL for an office.
//
// The wildcard-subdomain form (https://<slug>.bizzlivo.com) only routes if
// a `*.bizzlivo.com` DNS record + host config points at this deployment.
// That is NOT set up, so by default we generate the path form
// (https://<current-origin>/o/<slug>/login), which is a real route
// (OfficeLogin) that works on every deployment and for every new office
// with no per-office setup.
//
// Set VITE_OFFICE_SUBDOMAINS=true once wildcard DNS is live to switch to
// the prettier subdomain form.
export function officeLoginUrl(slug: string): string {
  if (!slug) return ''
  const useSubdomains = import.meta.env.VITE_OFFICE_SUBDOMAINS === 'true'
  if (useSubdomains) return `https://${slug}.${ROOT_DOMAIN}/o/${slug}/login`
  const origin = typeof window !== 'undefined' ? window.location.origin : `https://${ROOT_DOMAIN}`
  return `${origin}/o/${slug}/login`
}
