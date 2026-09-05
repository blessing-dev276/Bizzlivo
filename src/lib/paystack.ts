// Thin wrapper around Paystack's inline popup script. Loaded on demand (not
// in index.html) since it's only ever needed on the Billing page — every
// other screen shouldn't pay for a third-party script tag.

export interface PaystackCheckoutOptions {
  key: string
  email: string
  amount: number // kobo
  currency: string
  ref: string
  metadata: { org_id: string; plan: string; billing_cycle: string }
  callback: (response: { reference: string }) => void
  onClose: () => void
}

declare global {
  interface Window {
    PaystackPop?: {
      setup: (options: PaystackCheckoutOptions) => { openIframe: () => void }
    }
  }
}

const SCRIPT_SRC = 'https://js.paystack.co/v1/inline.js'
let loadPromise: Promise<void> | null = null

function loadPaystackScript(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load the Paystack checkout script.'))
    document.body.appendChild(script)
  })
  return loadPromise
}

export async function openPaystackCheckout(options: PaystackCheckoutOptions): Promise<void> {
  await loadPaystackScript()
  if (!window.PaystackPop) throw new Error('Paystack checkout failed to initialize.')
  window.PaystackPop.setup(options).openIframe()
}
