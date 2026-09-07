// Provider-boundary money conversion (Decision D). Stored amounts are
// numeric(14,2); providers want integer minor units. Convert only here.

const DECIMALS: Record<string, number> = {
  NGN: 2, USD: 2, GBP: 2, EUR: 2, GHS: 2, KES: 2, ZAR: 2, CAD: 2, JPY: 0, KWD: 3, BHD: 3,
}

export function currencyDecimals(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2
}

export function toMinorUnits(amount: number | string, currency: string): number {
  const factor = 10 ** currencyDecimals(currency)
  return Math.round(Number(amount) * factor)
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
