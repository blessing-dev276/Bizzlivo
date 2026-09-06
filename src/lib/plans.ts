import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { OrgUsage, PlanLimits } from '../types/database'
import { PLAN_ORDER } from './entitlements'

// Card copy + entitlement helpers now live in ./entitlements. This module
// keeps only the data-loading hooks + trial math.
export { PLAN_ORDER } from './entitlements'
export { nairaFromKobo as formatNaira } from './entitlements'

export async function fetchPlanLimits(): Promise<PlanLimits[]> {
  const { data, error } = await supabase.from('plan_limits').select('*')
  if (error) throw error
  const rows = (data as PlanLimits[]) ?? []
  return PLAN_ORDER.map((plan) => rows.find((r) => r.plan === plan)).filter((r): r is PlanLimits => !!r)
}

export function useOrgUsage(orgId: string | undefined) {
  const [usage, setUsage] = useState<OrgUsage | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase.rpc('get_org_usage', { target_org_id: orgId }).maybeSingle()
    setUsage((data as OrgUsage | null) ?? null)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  return { usage, loading, refresh }
}

export function trialDaysLeft(usage: OrgUsage): number | null {
  if (usage.status !== 'trialing' || !usage.trial_ends_at) return null
  const ms = new Date(usage.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}
