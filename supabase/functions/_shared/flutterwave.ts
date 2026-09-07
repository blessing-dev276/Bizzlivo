// Flutterwave-specific verification, mirroring _shared/paystack.ts. The
// "now activate the plan" step is provider-neutral and shared — see
// activatePaidPlan in ./paystack.ts, re-exported here so the flutterwave
// functions have a single import.

export { activatePaidPlan, isValidPlanCode } from './paystack.ts'
export type { BillingCycle, PlanCode, PaymentProvider } from './paystack.ts'

export interface FlutterwaveVerifyResponse {
  status: string // 'success' | 'error'
  message?: string
  data?: {
    id: number
    tx_ref: string
    status: string // 'successful' when paid
    amount: number // MAJOR units (e.g. 5000 = ₦5,000), unlike Paystack's kobo
    currency: string
    customer?: { email?: string; id?: number; name?: string }
    meta?: Record<string, unknown> | null
  }
}

// GET /v3/transactions/{id}/verify — `id` is Flutterwave's numeric
// transaction id (response.transaction_id from the inline callback, or
// data.id from the webhook), NOT our tx_ref.
export async function verifyFlutterwaveTransaction(
  secretKey: string,
  transactionId: string | number,
): Promise<FlutterwaveVerifyResponse> {
  const res = await fetch(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  )
  return res.json()
}

// Flutterwave quotes amounts in major units; activatePaidPlan works in
// kobo/subunit (Paystack's native unit, and how plan_limits stores price).
export function toKobo(majorAmount: number): number {
  return Math.round(majorAmount * 100)
}
