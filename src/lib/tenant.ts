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
