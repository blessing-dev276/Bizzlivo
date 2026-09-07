// Thin wrapper around Flutterwave's v3 inline checkout script. Loaded on
// demand (not in index.html) since it's only ever needed on the Billing
// page — mirrors lib/paystack.ts.

export interface FlutterwaveCheckoutOptions {
  publicKey: string
  txRef: string
  amount: number // MAJOR units (naira), not kobo — Flutterwave's convention
  currency: string
  email: string
  meta: { org_id: string; plan: string; billing_cycle: string }
  title?: string
  description?: string
  callback: (response: { transaction_id: number; tx_ref: string; status: string }) => void
  onClose: () => void
}

interface FlutterwaveInlineConfig {
  public_key: string
  tx_ref: string
  amount: number
  currency: string
  payment_options: string
  customer: { email: string }
  meta: Record<string, string>
  customizations: { title: string; description: string }
  callback: (response: { transaction_id: number; tx_ref: string; status: string }) => void
  onclose: () => void
}

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: FlutterwaveInlineConfig) => { close: () => void }
    closePaymentModal?: () => void
  }
}

const SCRIPT_SRC = 'https://checkout.flutterwave.com/v3.js'
let loadPromise: Promise<void> | null = null

function loadFlutterwaveScript(): Promise<void> {
  if (window.FlutterwaveCheckout) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load the Flutterwave checkout script.'))
    document.body.appendChild(script)
  })
  return loadPromise
}

export async function openFlutterwaveCheckout(options: FlutterwaveCheckoutOptions): Promise<void> {
  await loadFlutterwaveScript()
  if (!window.FlutterwaveCheckout) throw new Error('Flutterwave checkout failed to initialize.')

  window.FlutterwaveCheckout({
    public_key: options.publicKey,
    tx_ref: options.txRef,
    amount: options.amount,
    currency: options.currency,
    payment_options: 'card,banktransfer,ussd',
    customer: { email: options.email },
    meta: options.meta,
    customizations: {
      title: options.title ?? 'Bizzlivo',
      description: options.description ?? 'Subscription payment',
    },
    callback: (response) => {
      // Dismiss Flutterwave's iframe; it doesn't auto-close on callback.
      window.closePaymentModal?.()
      options.callback(response)
    },
    onclose: options.onClose,
  })
}
