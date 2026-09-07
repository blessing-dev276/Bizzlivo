// Centralized money handling (Decision D).
//
// Authoritative amounts live in Postgres as numeric(14,2) — exact, never
// floating point. The client only ever *displays* and *collects* amounts;
// every balance-changing calculation is done by the database RPCs.
//
// Minor units (kobo, cents) are used ONLY at a payment-provider boundary,
// converted here. Never assume every currency has 2 decimal places.

export const CURRENCY_DECIMALS: Record<string, number> = {
  NGN: 2, USD: 2, GBP: 2, EUR: 2, GHS: 2, KES: 2, ZAR: 2, CAD: 2,
  JPY: 0, KWD: 3, BHD: 3,
}

export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2
}

/** numeric(14,2) major-unit value -> integer minor units for a provider API. */
export function toMinorUnits(amount: number | string, currency: string): number {
  const factor = 10 ** currencyDecimals(currency)
  // round on the scaled integer to avoid binary-float drift on values like 12500.50
  return Math.round(Number(amount) * factor)
}

/** integer minor units from a provider -> major-unit number for display/records. */
export function fromMinorUnits(minor: number, currency: string): number {
  const factor = 10 ** currencyDecimals(currency)
  return Math.round(Number(minor)) / factor
}

const SYMBOL: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' }

/** Display a major-unit amount. Pure formatting — not used for math. */
export function formatMoney(amount: number, currency: string): string {
  const d = currencyDecimals(currency)
  const n = Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
  const sym = SYMBOL[currency.toUpperCase()]
  return sym ? `${sym}${n}` : `${n} ${currency.toUpperCase()}`
}

/** Parse user input into a major-unit number, or null if not a positive amount. */
export function parseAmount(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}
