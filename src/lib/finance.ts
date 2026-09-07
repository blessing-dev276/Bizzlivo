// Finance / Wallet v2 — thin client over the 0043 security-definer RPCs.
// The client NEVER writes finance tables directly; it only reads (RLS-scoped)
// and calls RPCs. Balances are derived server-side from finance_ledger.
import { supabase } from './supabase'
import type {
  FinanceCharge,
  FinanceEvent,
  FinanceLedgerEntry,
  FinanceMemberBalances,
  FinanceOrder,
  FinanceOrderStatus,
  FinancePayout,
  FinancePaymentChannel,
  FinanceReconciliation,
  MemberPayoutAccount,
  MoneyByCurrency,
  OrgFinanceConfig,
  OrgFinanceGrant,
  WithdrawalMemberStatus,
  WithdrawalPayment,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../types/database'

export const ORDER_STATUS_LABEL: Record<FinanceOrderStatus, string> = {
  order_received: 'Order Received',
  pending_settlement: 'Pending Settlement',
  settled: 'Settled',
  available: 'Available',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

// Admin / Finance Operations view of the state machine.
export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  requested: 'Requested',
  under_review: 'Under review',
  approved: 'Approved',
  authorized_for_payment: 'Authorized for payment',
  payment_recorded: 'Payment recorded',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  failed: 'Failed',
  reversed: 'Reversed',
}

// Member-facing: the internal states collapse to a short, plain set.
export const WITHDRAWAL_MEMBER_LABEL: Record<WithdrawalMemberStatus, string> = {
  received: 'Received',
  processing: 'Processing',
  paid: 'Paid',
  not_approved: 'Not approved',
  returned: 'Returned',
}

export function withdrawalMemberStatus(s: WithdrawalStatus): WithdrawalMemberStatus {
  switch (s) {
    case 'requested':
    case 'under_review':
      return 'received'
    case 'approved':
    case 'authorized_for_payment':
    case 'payment_recorded':
    case 'failed':
      return 'processing'
    case 'paid':
      return 'paid'
    case 'rejected':
    case 'cancelled':
      return 'not_approved'
    case 'reversed':
      return 'returned'
  }
}

export const PAYMENT_CHANNEL_LABEL: Record<FinancePaymentChannel, string> = {
  office_bank_transfer: 'Office bank transfer',
  provider_transfer: 'Provider transfer',
  other: 'Other approved method',
}

export const CHARGE_TYPE_LABEL: Record<string, string> = {
  platform_fee: 'Platform Fee',
  withdrawal_fee: 'Withdrawal Fee',
  conversion_fee: 'Conversion Fee',
  bank_charge: 'Bank Charge',
  service_charge: 'Office / Service Charge',
  other: 'Other',
}

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  order_recorded: 'Order recorded',
  settlement: 'Platform settlement',
  conversion: 'Currency conversion',
  charge: 'Charge',
  charge_reversal: 'Charge reversal',
  available_credit: 'Credited as available',
  withdrawal_reserve: 'Withdrawal requested',
  withdrawal_release: 'Funds returned',
  payout: 'Payout',
  payout_debit: 'Payout completed',
  adjustment: 'Adjustment',
  adjustment_credit: 'Manual adjustment (credit)',
  adjustment_debit: 'Manual adjustment (debit)',
  reversal: 'Reversal',
}

export const COMMON_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD']

const CCY_SYMBOL: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' }

export function money(amount: number, currency: string): string {
  const sym = CCY_SYMBOL[currency] ?? ''
  const n = Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return sym ? `${sym}${n}` : `${n} ${currency}`
}

export function sumByCurrency(rows: MoneyByCurrency[] | null | undefined): MoneyByCurrency[] {
  return (rows ?? []).filter((r) => Number(r.amount) !== 0)
}

/** Render a MoneyByCurrency[] as "₦118,000.00 · $20.00" (or a dash). */
export function moneyList(rows: MoneyByCurrency[] | null | undefined): string {
  const list = sumByCurrency(rows)
  if (list.length === 0) return '—'
  return list.map((r) => money(Number(r.amount), r.currency)).join('  ·  ')
}

// ---------- reads ----------

const EMPTY_BALANCES: FinanceMemberBalances = {
  available: [], lifetime_gross: [], total_credited: [], pending_platform: [], pending_withdrawal: [], total_paid_out: [],
}

export async function loadMemberBalances(orgId: string, memberId: string): Promise<FinanceMemberBalances> {
  const { data, error } = await supabase.rpc('finance_member_balances', { p_org: orgId, p_member: memberId })
  if (error) throw error
  return (data as FinanceMemberBalances) ?? EMPTY_BALANCES
}

export interface FinanceOrgOverview {
  orders_in_period: number
  gross_by_currency: MoneyByCurrency[]
  pending_platform: MoneyByCurrency[]
  member_wallet_liability: MoneyByCurrency[]
  pending_withdrawals_count: number
  processing_payouts_count: number
  paid_in_period: MoneyByCurrency[]
  failed_payouts_count: number
  needs_attention: {
    awaiting_settlement: number
    settled_not_credited: number
    withdrawals_awaiting_approval: number
    withdrawals_awaiting_authorization: number
    withdrawals_awaiting_payment: number
    withdrawals_awaiting_confirmation: number
    withdrawals_failed: number
  }
}

export async function loadOrgOverview(orgId: string, startIso: string, endIso: string): Promise<FinanceOrgOverview> {
  const { data, error } = await supabase.rpc('finance_org_overview', { p_org: orgId, p_start: startIso, p_end: endIso })
  if (error) throw error
  return data as FinanceOrgOverview
}

export async function loadFinanceConfig(orgId: string): Promise<OrgFinanceConfig> {
  const { data, error } = await supabase.rpc('finance_config_view', { p_org: orgId })
  if (error) throw error
  return data as OrgFinanceConfig
}

export async function loadFinanceGrants(orgId: string): Promise<OrgFinanceGrant[]> {
  const { data, error } = await supabase.rpc('finance_grants_list', { p_org: orgId })
  if (error) throw error
  return (data as OrgFinanceGrant[]) ?? []
}

export async function loadReconciliation(orgId: string): Promise<FinanceReconciliation> {
  const { data, error } = await supabase.rpc('finance_reconciliation', { p_org: orgId })
  if (error) throw error
  return data as FinanceReconciliation
}

export async function listWithdrawalPayments(withdrawalId: string): Promise<WithdrawalPayment[]> {
  const { data } = await supabase.from('withdrawal_payments').select('*')
    .eq('withdrawal_id', withdrawalId).order('attempt_number')
  return (data as WithdrawalPayment[]) ?? []
}

export async function listOrders(orgId: string, opts: { memberId?: string } = {}): Promise<FinanceOrder[]> {
  let q = supabase.from('finance_orders').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
  if (opts.memberId) q = q.eq('member_id', opts.memberId)
  const { data } = await q
  return (data as FinanceOrder[]) ?? []
}

export async function listCharges(orderId: string): Promise<FinanceCharge[]> {
  const { data } = await supabase.from('finance_charges').select('*').eq('order_id', orderId).order('created_at')
  return (data as FinanceCharge[]) ?? []
}

export async function listWithdrawals(orgId: string, opts: { memberId?: string; status?: WithdrawalStatus } = {}): Promise<WithdrawalRequest[]> {
  let q = supabase.from('withdrawal_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
  if (opts.memberId) q = q.eq('member_id', opts.memberId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data } = await q
  return (data as WithdrawalRequest[]) ?? []
}

export async function listLedger(orgId: string, opts: { memberId?: string } = {}): Promise<FinanceLedgerEntry[]> {
  let q = supabase.from('finance_ledger').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
  if (opts.memberId) q = q.eq('member_id', opts.memberId)
  const { data } = await q
  return (data as FinanceLedgerEntry[]) ?? []
}

export async function listPayouts(orgId: string, opts: { memberId?: string } = {}): Promise<FinancePayout[]> {
  let q = supabase.from('finance_payouts').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
  if (opts.memberId) q = q.eq('member_id', opts.memberId)
  const { data } = await q
  return (data as FinancePayout[]) ?? []
}

export async function listOrderEvents(orderId: string): Promise<FinanceEvent[]> {
  const { data } = await supabase.from('finance_events').select('*').eq('entity_id', orderId).order('created_at')
  return (data as FinanceEvent[]) ?? []
}

export async function listPayoutAccounts(orgId: string, userId: string): Promise<MemberPayoutAccount[]> {
  const { data } = await supabase.from('member_payout_accounts').select('*').eq('org_id', orgId).eq('user_id', userId).order('created_at')
  return (data as MemberPayoutAccount[]) ?? []
}

export interface NigerianBank {
  name: string
  code: string
}

// Cached for the tab's lifetime — the list is ~200 entries and changes rarely.
let bankListPromise: Promise<NigerianBank[]> | null = null

export function listNigerianBanks(): Promise<NigerianBank[]> {
  if (!bankListPromise) {
    bankListPromise = supabase.functions
      .invoke('resolve-bank-account', { body: { action: 'banks' } })
      .then(({ data, error }) => {
        if (error || !data?.banks) {
          bankListPromise = null // let the next call retry
          throw new Error(error?.message ?? 'Could not load the bank list.')
        }
        return data.banks as NigerianBank[]
      })
  }
  return bankListPromise
}

/**
 * Confirms the account holder's name from the account number + bank via
 * Paystack NUBAN resolution. Throws with a user-facing message on failure
 * (bad number, unknown account, provider down).
 */
export async function resolveBankAccount(accountNumber: string, bankCode: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('resolve-bank-account', {
    body: { action: 'resolve', account_number: accountNumber, bank_code: bankCode },
  })
  if (error) {
    // The real reason is in the JSON body of the non-2xx response.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json()
        if (body?.error) throw new Error(String(body.error))
      } catch (e) {
        if (e instanceof Error && e.message) throw e
      }
    }
    throw new Error('We could not verify that account. Please try again.')
  }
  if (!data?.account_name) throw new Error('We could not verify that account.')
  return String(data.account_name)
}

// ---------- calculation preview (client mirror of finance_credit_available) ----------

export interface CreditPreview {
  base: number
  baseCurrency: string
  chargeTotal: number
  final: number
  currencyMismatch: boolean
}

export function previewCredit(order: FinanceOrder, charges: FinanceCharge[]): CreditPreview | null {
  if (order.settled_amount == null) return null
  const base = order.converted ? Number(order.converted_amount ?? 0) : Number(order.settled_amount)
  const baseCurrency = order.converted ? order.to_currency ?? order.currency : order.settlement_currency ?? order.currency
  const live = charges.filter((c) => !c.voided)
  const currencyMismatch = live.some((c) => c.currency !== baseCurrency)
  const chargeTotal = live.filter((c) => c.currency === baseCurrency).reduce((s, c) => s + Number(c.amount), 0)
  return { base, baseCurrency, chargeTotal, final: Math.round((base - chargeTotal) * 100) / 100, currencyMismatch }
}

// ---------- RPC wrappers ----------

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

export const recordOrder = (a: {
  orgId: string; memberId: string; platform: string; title: string; orderDate: string
  gross: number; currency: string; reference?: string; description?: string; proofUrl?: string
}) => rpc('finance_record_order', {
  p_org: a.orgId, p_member: a.memberId, p_platform: a.platform, p_title: a.title,
  p_order_date: a.orderDate, p_gross: a.gross, p_currency: a.currency,
  p_reference: a.reference ?? null, p_description: a.description ?? null, p_proof_url: a.proofUrl ?? null,
})

export const updateOrder = (a: {
  orderId: string; platform: string; title: string; orderDate: string; gross: number
  currency: string; reference?: string; description?: string; proofUrl?: string
}) => rpc('finance_update_order', {
  p_order: a.orderId, p_platform: a.platform, p_title: a.title, p_order_date: a.orderDate,
  p_gross: a.gross, p_currency: a.currency, p_reference: a.reference ?? null,
  p_description: a.description ?? null, p_proof_url: a.proofUrl ?? null,
})

export const cancelOrder = (orderId: string, reason: string) =>
  rpc('finance_cancel_order', { p_order: orderId, p_reason: reason })

export const recordSettlement = (a: {
  orderId: string; platformDeduction: number; settledAmount: number; settledOn: string; settlementCurrency?: string
}) => rpc('finance_record_settlement', {
  p_order: a.orderId, p_platform_deduction: a.platformDeduction, p_settled_amount: a.settledAmount,
  p_settled_on: a.settledOn, p_settlement_currency: a.settlementCurrency ?? null,
})

export const recordConversion = (a: {
  orderId: string; fromCurrency: string; toCurrency: string; rate: number; conversionDate: string
}) => rpc('finance_record_conversion', {
  p_order: a.orderId, p_from_currency: a.fromCurrency, p_to_currency: a.toCurrency,
  p_rate: a.rate, p_conversion_date: a.conversionDate,
})

export const clearConversion = (orderId: string) => rpc('finance_clear_conversion', { p_order: orderId })

export const addCharge = (a: {
  orderId: string; type: string; amount: number; currency: string; description?: string; chargeDate?: string
}) => rpc('finance_add_charge', {
  p_order: a.orderId, p_type: a.type, p_amount: a.amount, p_currency: a.currency,
  p_description: a.description ?? null, p_charge_date: a.chargeDate ?? null,
})

export const voidCharge = (chargeId: string, reason: string) =>
  rpc('finance_void_charge', { p_charge: chargeId, p_reason: reason })

export const creditAvailable = (orderId: string) =>
  rpc('finance_credit_available', { p_order: orderId })

export const requestWithdrawal = (a: {
  orgId: string; amount: number; currency: string; method?: string; accountId?: string; note?: string
}) => rpc('finance_request_withdrawal', {
  p_org: a.orgId, p_amount: a.amount, p_currency: a.currency,
  p_method: a.method ?? null, p_account_id: a.accountId ?? null, p_note: a.note ?? null,
})

export const reviewWithdrawal = (withdrawalId: string, decision: 'approve' | 'reject', note?: string) =>
  rpc('finance_review_withdrawal', { p_withdrawal: withdrawalId, p_decision: decision, p_note: note ?? null })

export const setWithdrawalProcessing = (withdrawalId: string) =>
  rpc('finance_set_withdrawal_processing', { p_withdrawal: withdrawalId })

export const markWithdrawalPaid = (a: {
  withdrawalId: string; paidOn: string; amountPaid: number; reference?: string; method?: string; proofUrl?: string; note?: string
}) => rpc('finance_mark_withdrawal_paid', {
  p_withdrawal: a.withdrawalId, p_paid_on: a.paidOn, p_amount_paid: a.amountPaid,
  p_reference: a.reference ?? null, p_method: a.method ?? null, p_proof_url: a.proofUrl ?? null, p_note: a.note ?? null,
})

export const cancelWithdrawal = (withdrawalId: string, reason?: string) =>
  rpc('finance_cancel_withdrawal', { p_withdrawal: withdrawalId, p_reason: reason ?? null })
