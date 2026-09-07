// Resolves an office's slug from a wildcard subdomain, e.g.
// "blaze-office.bizzlivo.com" -> "blaze-office". Requires a wildcard DNS
// record (*.bizzlivo.com) + the `*.bizzlivo.com` domain added to the
// Vercel project for that subdomain to actually route — this just reads
// whatever hostname the browser already landed on. The bare apex / www
// serves the marketing + generic login (returns null).
const ROOT_DOMAIN = 'bizzlivo.com'
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'admin', 'api', 'mail', 'notifications', 'staging', 'assets', 'cdn', 'static',
])

export function getOfficeSlugFromHost(hostname: string): string | null {
  const suffix = `.${ROOT_DOMAIN}`
  if (!hostname.endsWith(suffix)) return null
  const sub = hostname.slice(0, -suffix.length)
  if (!sub || sub.includes('.') || RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}

// Are per-office subdomains live? True when the build opts in
// (VITE_OFFICE_SUBDOMAINS=true, set once the Vercel wildcard domain
// *.bizzlivo.com is active) OR when the app is *already* being served
// from an office subdomain (proof the wildcard resolves).
export function officeSubdomainsEnabled(): boolean {
  if (import.meta.env.VITE_OFFICE_SUBDOMAINS === 'true') return true
  if (typeof window === 'undefined') return false
  return getOfficeSlugFromHost(window.location.hostname) !== null
}

// The shareable branded sign-in URL for an office.
//
// With subdomains live this is the clean root of the office's own
// subdomain — https://<slug>.bizzlivo.com — whose root already renders
// that office's branded login/join screen (OfficeAwareRoot in App.tsx).
// Otherwise it falls back to the path form https://<origin>/o/<slug>/login,
// a real route that works on every deployment with no per-office setup.
export function officeLoginUrl(slug: string): string {
  if (!slug) return ''
  if (officeSubdomainsEnabled()) return `https://${slug}.${ROOT_DOMAIN}`
  const origin = typeof window !== 'undefined' ? window.location.origin : `https://${ROOT_DOMAIN}`
  return `${origin}/o/${slug}/login`
}

// The origin an office's app is served from once subdomains are live —
// https://<slug>.bizzlivo.com. Used to move a signed-in user off the apex
// onto their office's own subdomain.
export function officeSubdomainOrigin(slug: string): string {
  return `https://${slug}.${ROOT_DOMAIN}`
}
