// Resolves an office's slug from a wildcard subdomain, e.g.
// "blaze-office.hq360.space" -> "blaze-office". Requires the DNS/proxy
// side (wildcard record + Cloudflare Worker in front of Firebase Hosting)
// to actually route that subdomain here — this just reads whatever
// hostname the browser already landed on.
const ROOT_DOMAIN = 'hq360.space'
const RESERVED_SUBDOMAINS = new Set(['www'])

export function getOfficeSlugFromHost(hostname: string): string | null {
  const suffix = `.${ROOT_DOMAIN}`
  if (!hostname.endsWith(suffix)) return null
  const sub = hostname.slice(0, -suffix.length)
  if (!sub || sub.includes('.') || RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}
