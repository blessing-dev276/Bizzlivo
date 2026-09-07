// AES-GCM encryption for the Google refresh token, done entirely in the
// edge runtime. INTEGRATION_ENC_KEY is a base64-encoded 32-byte key.
// Stored form: base64( iv(12 bytes) || ciphertext ).

function keyBytes(): Uint8Array {
  const b64 = Deno.env.get('INTEGRATION_ENC_KEY')
  if (!b64) throw new Error('INTEGRATION_ENC_KEY not set')
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  if (raw.length !== 32) throw new Error('INTEGRATION_ENC_KEY must decode to 32 bytes')
  return raw
}

async function subtleKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes(), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await subtleKey()
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return btoa(String.fromCharCode(...out))
}

export async function decryptSecret(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const key = await subtleKey()
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

export function integrationConfigured(): boolean {
  return !!(Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') && Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') && Deno.env.get('INTEGRATION_ENC_KEY'))
}
