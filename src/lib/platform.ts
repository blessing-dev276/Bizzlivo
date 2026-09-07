// Bizzlivo Platform (Super Admin) data layer. Every call is a
// SECURITY DEFINER RPC that re-checks is_platform_admin() /
// is_platform_super_admin() server-side (0054_platform_ops.sql).
import { supabase } from './supabase'

const rpc = async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && '_error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as { _error: unknown })._error))
  }
  return data as T
}

export const naira = (kobo: number) => `₦${Math.round((kobo || 0) / 100).toLocaleString()}`

// ---- auth ----
export interface PlatformIdentity {
  isAdmin: boolean
  isSuper: boolean
  username: string | null
  role: string | null
  mustChangePassword: boolean
  lastLoginAt: string | null
}
export async function platformIdentity(): Promise<PlatformIdentity> {
  const { data: isAdmin } = await supabase.rpc('is_platform_admin')
  if (isAdmin !== true) return { isAdmin: false, isSuper: false, username: null, role: null, mustChangePassword: false, lastLoginAt: null }
  const { data: isSuper } = await supabase.rpc('is_platform_super_admin')
  return {
    isAdmin: true,
    isSuper: isSuper === true,
    username: null, role: null, mustChangePassword: false, lastLoginAt: null,
  }
}
export const platformRecordLogin = () =>
  rpc<{ username: string; role: string; must_change_password: boolean }>('platform_record_login')
export const platformClearMustChange = () => supabase.rpc('platform_clear_must_change_password')
export const resolvePlatformUsername = (username: string) =>
  supabase.rpc('platform_username_email', { p_username: username })

// ---- reads ----
export interface PlatformOverview {
  organizations: number; active_organizations: number; suspended_organizations: number
  paid_organizations: number; free_organizations: number; new_orgs_month: number
  total_users: number; active_users_7d: number; active_users_30d: number
  mrr_kobo: number; subscriptions_active: number; subscriptions_past_due: number
  plan_mix: { free: number; growth: number; business: number }
  ai_generations_month: number; ai_questions_month: number
  email_failures_7d: number; support_open: number; support_stale: number
  org_growth: { month: string; count: number }[]
  user_growth: { month: string; count: number }[]
  attention: { kind: string; count: number; text: string; route: string }[]
  recent_orgs: { id: string; name: string; plan: string; status: string; created_at: string; members: number; owner: string | null; last_active: string | null }[]
  recent_activity: { summary: string; verb: string; created_at: string }[]
  _error?: string
}
export const getOverview = () => rpc<PlatformOverview>('platform_overview')

export interface PlatformOrgRow {
  id: string; name: string; slug: string; plan: string; status: string; created_at: string
  base_currency: string | null; members: number; owner_name: string | null; owner_email: string | null
  ai_month: number; has_override: boolean; sub_status: string | null; last_active: string | null
}
export const listOrgs = (filter = 'all', q = '') => rpc<PlatformOrgRow[]>('platform_orgs', { p_filter: filter, p_q: q || null })
export const getOrgDetail = (orgId: string) => rpc<Record<string, unknown>>('platform_org_detail', { p_org: orgId })

export const listUsers = (q = '') => rpc<Record<string, unknown>[]>('platform_users', { p_q: q || null, p_limit: 200 })
export const listSubscriptions = (filter = 'all') => rpc<Record<string, unknown>[]>('platform_subscriptions', { p_filter: filter })
export const getAiUsage = () => rpc<Record<string, unknown>[]>('platform_ai_usage')
export const getAudit = (q = '') => rpc<Record<string, unknown>[]>('platform_audit', { p_q: q || null, p_limit: 150 })
export const getSupport = () => rpc<Record<string, unknown>[]>('platform_support')
export const getEmailStats = () => rpc<{ sent: number; failed: number; pending: number; recent: Record<string, unknown>[] }>('platform_email_stats')

export interface PlatformSettings {
  signup_enabled: boolean; maintenance_mode: boolean; default_free_plan: string; support_email: string | null
}
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const { data } = await supabase.from('platform_settings').select('*').eq('id', true).maybeSingle()
  return (data as PlatformSettings) ?? { signup_enabled: true, maintenance_mode: false, default_free_plan: 'free', support_email: null }
}
export const savePlatformSettings = (signup: boolean, maintenance: boolean, supportEmail: string) =>
  supabase.rpc('platform_settings_update', { p_signup: signup, p_maintenance: maintenance, p_support_email: supportEmail })

export const getPlans = () => supabase.from('plan_limits').select('*').order('price_monthly_kobo')

// ---- writes ----
export const setOrgStatus = (orgId: string, status: string, reason: string) =>
  supabase.rpc('platform_set_org_status', { p_org: orgId, p_status: status, p_reason: reason })
export const setPlanOverride = (orgId: string, plan: string, reason: string, expires: string | null) =>
  supabase.rpc('platform_set_plan_override', { p_org: orgId, p_plan: plan, p_reason: reason, p_expires: expires })
export const clearPlanOverride = (orgId: string) =>
  supabase.rpc('platform_clear_plan_override', { p_org: orgId })
export const extendTrial = (orgId: string, days: number, reason: string) =>
  supabase.rpc('platform_extend_trial', { p_org: orgId, p_days: days, p_reason: reason })

export const STATUS_TONE = (s: string) =>
  s === 'active' || s === 'sent' ? 'green' : s === 'suspended' || s === 'failed' || s === 'past_due' ? 'red' : s === 'pending' || s === 'trialing' ? 'amber' : 'muted'
