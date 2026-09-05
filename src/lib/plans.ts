import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { OrgUsage, PlanLimits, PlanTier } from '../types/database'

export const PLAN_ORDER: PlanTier[] = ['free', 'growth', 'business']

export const PLAN_COPY: Record<PlanTier, { label: string; who: string }> = {
  free: { label: 'Free', who: 'Pilot a single office, evaluate the exam loop.' },
  growth: { label: 'Growth', who: 'Running certification for a real team, ongoing.' },
  business: { label: 'Business', who: 'Multi-team operations, own branding.' },
}

export function formatNaira(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`
}

export function yearlySavingsLabel(limits: PlanLimits): string | null {
  if (limits.price_monthly_kobo === 0) return null
  const fullYear = limits.price_monthly_kobo * 12
  const saved = fullYear - limits.price_yearly_kobo
  if (saved <= 0) return null
  const monthsFree = Math.round(saved / limits.price_monthly_kobo)
  return `save ${monthsFree} month${monthsFree === 1 ? '' : 's'}`
}

export function planFeatureList(limits: PlanLimits): string[] {
  const features = [
    limits.max_members ? `Up to ${limits.max_members} members` : 'Unlimited members',
    limits.max_resources ? `${limits.max_resources} resources uploaded` : 'Unlimited resources',
    limits.max_published_exams
      ? `${limits.max_published_exams} published exam${limits.max_published_exams === 1 ? '' : 's'} at a time`
      : 'Unlimited published exams',
    `${limits.ai_exam_generations_per_month} AI exam generations / month`,
    `${limits.ai_questions_per_month} AI-generated questions / month`,
  ]
  features.push(limits.removes_badge ? 'Public link, no HQ360 badge' : 'Public link, "Powered by HQ360" badge')
  if (limits.custom_branding) features.push('Custom logo + brand color')
  return features
}

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
