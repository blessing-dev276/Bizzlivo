// PaystackFinanceProvider — the first FinanceProvider implementation.
//
// Uses PAYSTACK_SECRET_KEY (server-only, never bundled). This is the OFFICE
// Finance provider adapter — kept entirely separate from the billing
// Paystack code in _shared/paystack.ts. Nothing here shares a balance,
// customer, or transaction namespace with subscription billing.
//
// Capability flags come from env so we never expose an action the account
// cannot honour:
//   FINANCE_PAYSTACK_MODE                 test | live   (default: test)
//   FINANCE_PAYSTACK_TRANSFERS_ENABLED    true | false  (default: false)
//   FINANCE_PAYSTACK_SUBACCOUNTS_ENABLED  true | false  (default: false)
//   FINANCE_PAYSTACK_DVA_ENABLED          true | false  (default: false)

import {
  CapabilityDisabledError,
  type Bank,
  type FinanceProvider,
  type ProviderCapabilities,
  type ProviderTransferEvent,
  type TransferStatus,
} from './provider.ts'

const API = 'https://api.paystack.co'
const flag = (name: string) => (Deno.env.get(name) ?? '').toLowerCase() === 'true'

export function createPaystackFinanceProvider(): FinanceProvider {
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!secretKey) throw new Error('finance provider: PAYSTACK_SECRET_KEY not set')
  const auth = { Authorization: `Bearer ${secretKey}` }

  const caps: ProviderCapabilities = {
    supports_bank_resolution: true,
    supports_transfer_recipients: flag('FINANCE_PAYSTACK_TRANSFERS_ENABLED'),
    supports_transfers: flag('FINANCE_PAYSTACK_TRANSFERS_ENABLED'),
    supports_subaccounts: flag('FINANCE_PAYSTACK_SUBACCOUNTS_ENABLED'),
    supports_splits: flag('FINANCE_PAYSTACK_SUBACCOUNTS_ENABLED'),
    supports_virtual_accounts: flag('FINANCE_PAYSTACK_DVA_ENABLED'),
    supports_balance_lookup: flag('FINANCE_PAYSTACK_TRANSFERS_ENABLED'),
    supports_connected_merchants: false,
    supports_webhooks: flag('FINANCE_PAYSTACK_TRANSFERS_ENABLED'),
  }

  const requireCap = (c: keyof ProviderCapabilities) => {
    if (!caps[c]) throw new CapabilityDisabledError(c)
  }

  let bankCache: Bank[] | null = null

  return {
    id: 'paystack',
    mode: Deno.env.get('FINANCE_PAYSTACK_MODE') === 'live' ? 'live' : 'test',
    capabilities: () => ({ ...caps }),

    async listBanks(country: string): Promise<Bank[]> {
      if (bankCache) return bankCache
      const seen = new Map<string, string>()
      let next: string | null =
        `${API}/bank?country=${encodeURIComponent(country)}&currency=NGN&use_cursor=true&perPage=100`
      while (next) {
        const res: Response = await fetch(next, { headers: auth })
        const body = await res.json()
        if (!body?.status || !Array.isArray(body.data)) break
        for (const b of body.data) if (b?.code && b?.name && !seen.has(b.code)) seen.set(b.code, b.name)
        const cursor = body.meta?.next
        next = cursor
          ? `${API}/bank?country=${encodeURIComponent(country)}&currency=NGN&use_cursor=true&perPage=100&next=${encodeURIComponent(cursor)}`
          : null
      }
      const banks = [...seen.entries()].map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
      if (banks.length) bankCache = banks
      return banks
    },

    async verifyBankAccount({ accountNumber, bankCode }): Promise<{ accountName: string }> {
      const url = `${API}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
      const res = await fetch(url, { headers: auth })
      const body = await res.json()
      if (!body?.status || !body.data?.account_name) {
        throw new Error('We could not verify that account. Check the number and bank.')
      }
      return { accountName: String(body.data.account_name) }
    },

    async createTransferRecipient({ accountNumber, bankCode, accountName, currency }): Promise<{ recipientCode: string }> {
      requireCap('supports_transfer_recipients')
      const res = await fetch(`${API}/transferrecipient`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'nuban', name: accountName, account_number: accountNumber,
          bank_code: bankCode, currency: currency.toUpperCase(),
        }),
      })
      const body = await res.json()
      if (!body?.status || !body.data?.recipient_code) {
        throw new Error(body?.message ?? 'Could not create the transfer recipient.')
      }
      return { recipientCode: String(body.data.recipient_code) }
    },

    async initiateTransfer({ recipientCode, amountMinor, currency, reference, reason }): Promise<{ providerTransferId: string; status: TransferStatus }> {
      requireCap('supports_transfers')
      const res = await fetch(`${API}/transfer`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'balance', amount: amountMinor, currency: currency.toUpperCase(),
          recipient: recipientCode, reason, reference,
        }),
      })
      const body = await res.json()
      // A duplicate reference is a success from our side — the transfer already exists.
      if (!body?.status) {
        if (String(body?.message ?? '').toLowerCase().includes('duplicate')) {
          return { providerTransferId: '', status: 'pending' }
        }
        throw new Error(body?.message ?? 'Could not initiate the transfer.')
      }
      const s = String(body.data?.status ?? 'pending')
      return {
        providerTransferId: body.data?.transfer_code != null ? String(body.data.transfer_code) : '',
        status: s === 'success' ? 'success' : s === 'failed' ? 'failed' : s === 'reversed' ? 'reversed' : 'pending',
      }
    },

    async getTransferStatus(reference: string): Promise<{ status: TransferStatus; raw: unknown }> {
      requireCap('supports_transfers')
      const res = await fetch(`${API}/transfer/verify/${encodeURIComponent(reference)}`, { headers: auth })
      const body = await res.json()
      const s = String(body?.data?.status ?? 'unknown')
      return {
        status: s === 'success' ? 'success' : s === 'failed' ? 'failed' : s === 'reversed' ? 'reversed'
          : s === 'pending' || s === 'otp' || s === 'processing' ? 'pending' : 'unknown',
        raw: body?.data ?? null,
      }
    },

    async verifyWebhook(rawBody: string, headers: Headers): Promise<boolean> {
      const sig = headers.get('x-paystack-signature')
      if (!sig) return false
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secretKey),
        { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
      )
      const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
      return hex === sig
    },

    parseWebhook(rawBody: string): ProviderTransferEvent | null {
      let payload: Record<string, unknown>
      try { payload = JSON.parse(rawBody) } catch { return null }
      const event = String(payload.event ?? '')
      if (!event.startsWith('transfer.')) return null
      const data = (payload.data ?? {}) as Record<string, unknown>
      const status: TransferStatus =
        event === 'transfer.success' ? 'success'
        : event === 'transfer.failed' ? 'failed'
        : event === 'transfer.reversed' ? 'reversed'
        : 'unknown'
      return {
        kind: 'transfer',
        status,
        reference: (data.reference as string) ?? null,
        providerTransferId: data.id != null ? String(data.id) : null,
        raw: data,
      }
    },
  }
}
