// Thin wrappers over the 0041 reporting RPCs. Each RPC is SECURITY DEFINER
// and validates `has_org_role(p_org, admin)` itself, so a non-admin caller
// gets a Postgres error rather than data — callers surface that as a
// section-level error, never a page crash.
import { supabase } from '../supabase'
import type { ResolvedRange } from './range'
import type { MoneyByCurrency } from '../../types/database'

export interface FinanceOrgOverview {
  orders_in_period: number
  gross_by_currency: MoneyByCurrency[]
  pending_platform: MoneyByCurrency[]
  available_member_funds: MoneyByCurrency[]
  pending_withdrawals_count: number
  paid_in_period: MoneyByCurrency[]
  needs_attention: {
    awaiting_settlement: number
    withdrawals_awaiting_approval: number
    settled_not_credited: number
    missing_conversion: number
  }
}
import type {
  BusinessPathReport,
  IncomeReport,
  LearningReport,
  MemberReport,
  NetworkReport,
  OverviewReport,
  TeamsReport,
} from './types'

function win(range: ResolvedRange) {
  return { p_start: range.start.toISOString(), p_end: range.end.toISOString() }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  // RPCs trap their own errors and return { _error } so one failing
  // section can't blank the page — surface it as a thrown error here.
  if (data && typeof data === 'object' && '_error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as { _error: unknown })._error))
  }
  return data as T
}

export const reportsApi = {
  overview: (org: string, range: ResolvedRange) =>
    call<OverviewReport>('report_overview', { p_org: org, ...win(range) }),
  businessPath: (org: string, range: ResolvedRange) =>
    call<BusinessPathReport>('report_business_path', { p_org: org, ...win(range) }),
  learning: (org: string, range: ResolvedRange) =>
    call<LearningReport>('report_learning', { p_org: org, ...win(range) }),
  network: (org: string, range: ResolvedRange) =>
    call<NetworkReport>('report_network', { p_org: org, ...win(range) }),
  teams: (org: string, range: ResolvedRange) =>
    call<TeamsReport>('report_teams', { p_org: org, ...win(range) }),
  income: (org: string, range: ResolvedRange) =>
    call<IncomeReport>('report_income', { p_org: org, ...win(range) }),
  finance: (org: string, range: ResolvedRange) =>
    call<FinanceOrgOverview>('finance_org_overview', { p_org: org, ...win(range) }),
  member: (org: string, userId: string) =>
    call<MemberReport>('report_member', { p_org: org, p_user: userId }),
}
