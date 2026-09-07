// Finance provider abstraction (Decision B).
//
// Server-side ONLY. React never imports this file and never sees a secret
// key. Every capability is gated: the UI must check `capabilities()` before
// offering an action, and the adapter throws `CapabilityDisabledError` if a
// method is called for a capability the account has not been approved for.
//
// Phase 1 (A3): only bank resolution is used. Transfers / recipients /
// subaccounts / virtual accounts are declared but disabled until Paystack
// confirms them for the org's own account (never Bizzlivo's billing account).

export interface ProviderCapabilities {
  supports_bank_resolution: boolean
  supports_transfer_recipients: boolean
  supports_transfers: boolean
  supports_subaccounts: boolean
  supports_splits: boolean
  supports_virtual_accounts: boolean
  supports_balance_lookup: boolean
  supports_connected_merchants: boolean
  supports_webhooks: boolean
}

export interface Bank {
  name: string
  code: string
}

export type TransferStatus = 'pending' | 'success' | 'failed' | 'reversed' | 'unknown'

export interface ProviderTransferEvent {
  kind: 'transfer'
  status: TransferStatus
  reference: string | null
  providerTransferId: string | null
  raw: unknown
}

export class CapabilityDisabledError extends Error {
  constructor(capability: keyof ProviderCapabilities) {
    super(`finance provider: "${capability}" is not enabled for this account`)
    this.name = 'CapabilityDisabledError'
  }
}

export interface FinanceProvider {
  readonly id: string
  readonly mode: 'test' | 'live'
  capabilities(): ProviderCapabilities

  listBanks(country: string): Promise<Bank[]>
  verifyBankAccount(i: { accountNumber: string; bankCode: string }): Promise<{ accountName: string }>

  // Phase 2 — each throws CapabilityDisabledError until the org's provider
  // account is approved for it.
  createTransferRecipient(i: {
    accountNumber: string; bankCode: string; accountName: string; currency: string
  }): Promise<{ recipientCode: string }>
  initiateTransfer(i: {
    recipientCode: string; amountMinor: number; currency: string; reference: string; reason: string
  }): Promise<{ providerTransferId: string; status: TransferStatus }>
  getTransferStatus(reference: string): Promise<{ status: TransferStatus; raw: unknown }>

  verifyWebhook(rawBody: string, headers: Headers): Promise<boolean>
  parseWebhook(rawBody: string): ProviderTransferEvent | null
}
