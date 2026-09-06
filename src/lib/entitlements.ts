// Centralized plan/entitlement layer. Components must NOT branch on
// `plan === 'growth'` — they read plan_limits (via get_org_usage) and go
// through the helpers here. `plan_limits` in the DB is the source of truth
// for prices + limits; PLAN_META below is presentation copy only.

import type { OrgUsage, PlanLimits, PlanTier, ReportsLevel } from '../types/database'

export const PLAN_ORDER: PlanTier[] = ['free', 'growth', 'business']

// ---- money helpers -------------------------------------------------------
export function nairaFromKobo(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`
}

/** Yearly price expressed as a per-month figure, e.g. "₦12,500/month". */
export function monthlyEquivalent(yearlyKobo: number): string {
  return `${nairaFromKobo(Math.round(yearlyKobo / 12))}/month`
}

/** Absolute cash saved by paying yearly vs 12× monthly (kobo). */
export function annualSavingsKobo(l: Pick<PlanLimits, 'price_monthly_kobo' | 'price_yearly_kobo'>): number {
  if (l.price_monthly_kobo === 0) return 0
  return Math.max(0, l.price_monthly_kobo * 12 - l.price_yearly_kobo)
}

/** "≈ 2 months free" style label, or null when there's nothing to save. */
export function monthsFreeLabel(l: Pick<PlanLimits, 'price_monthly_kobo' | 'price_yearly_kobo'>): string | null {
  const saved = annualSavingsKobo(l)
  if (saved <= 0) return null
  const months = Math.round(saved / l.price_monthly_kobo)
  return `${months} month${months === 1 ? '' : 's'} free`
}

// ---- seat / usage helpers ---------------------------------------------------
export interface SeatState {
  used: number
  max: number | null
  remaining: number | null
  pct: number
  near: boolean // >= 80% of a finite limit
  atLimit: boolean
}

export function seatState(used: number, max: number | null): SeatState {
  if (max == null) return { used, max: null, remaining: null, pct: 0, near: false, atLimit: false }
  const remaining = Math.max(0, max - used)
  const pct = max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100))
  return { used, max, remaining, pct, near: used >= max * 0.8, atLimit: used >= max }
}

// ---- entitlement predicates ----------------------------------------------
export function getPlanLimit(
  usage: OrgUsage | null,
  key: 'max_members' | 'max_admins' | 'ai_exam_generations_per_month' | 'ai_questions_per_month',
): number | null {
  if (!usage) return null
  return usage[key] ?? null
}

export function hasEntitlement(usage: OrgUsage | null, key: 'removes_badge' | 'custom_branding'): boolean {
  return !!usage?.[key]
}

export function reportsLevel(usage: OrgUsage | null): ReportsLevel {
  return usage?.reports_level ?? 'basic'
}

/** True when the org can use a report feature at or below the given tier. */
export function canUseReports(usage: OrgUsage | null, need: ReportsLevel): boolean {
  const order: ReportsLevel[] = ['basic', 'full', 'advanced']
  return order.indexOf(reportsLevel(usage)) >= order.indexOf(need)
}

// ---- subscription state --------------------------------------------------
export function isPaidActive(usage: OrgUsage | null): boolean {
  return !!usage && usage.plan !== 'free' && (usage.status === 'active' || usage.status === 'trialing')
}

export function subscriptionStatusLabel(usage: OrgUsage | null): string {
  if (!usage) return 'Free'
  if (usage.plan === 'free') return 'Free'
  switch (usage.status) {
    case 'trialing': return 'Trial'
    case 'active': return usage.cancel_at_period_end ? 'Cancels at period end' : 'Active'
    case 'past_due': return 'Past due'
    case 'canceled': return 'Cancelled'
    case 'expired': return 'Expired'
    default: return 'Active'
  }
}

// ---- presentation copy (NOT the source of truth for numbers) -------------
export interface PlanMeta {
  label: string
  tagline: string // one line under the plan name on its card
  headline: string // the "FINAL DESIRED RESULT" one-liner
  recommended?: boolean
  /** Card bullets. Numbers come from plan_limits at render time — these are
   *  the qualitative lines only, and every one maps to a real entitlement. */
  bullets: (l: PlanLimits) => string[]
}

const aiLine = (l: PlanLimits) =>
  `AI: ${l.ai_exam_generations_per_month} generations · ${l.ai_questions_per_month} questions / month`

export const PLAN_META: Record<PlanTier, PlanMeta> = {
  free: {
    label: 'Free',
    tagline: 'For small offices getting started.',
    headline: 'Start your business office.',
    bullets: (l) => [
      `Up to ${l.max_members} members`,
      `${l.max_admins} admin seat`,
      'Dashboard, Learning Center & Business Path',
      'Goals, My Network, Finance & Wallet',
      'Events & Assessments',
      aiLine(l),
      'Basic Reports & Insights',
      '"Powered by Bizzlivo" on public pages',
    ],
  },
  growth: {
    label: 'Growth',
    tagline: 'For growing offices building consistent teams.',
    headline: 'Run and grow your team.',
    recommended: true,
    bullets: (l) => [
      `Up to ${l.max_members} members`,
      `${l.max_admins} admin seats`,
      'Everything in Free',
      'Full Reports & Insights',
      aiLine(l),
      'Remove the "Powered by Bizzlivo" badge',
      'Priority support',
    ],
  },
  business: {
    label: 'Business',
    tagline: 'For established offices managing larger teams.',
    headline: 'Manage a larger business organization.',
    bullets: (l) => [
      `Up to ${l.max_members} members`,
      `${l.max_admins} admin seats`,
      'Everything in Growth',
      'Advanced Reports & Insights — custom ranges + CSV export',
      aiLine(l),
      'Custom logo & brand color',
      'Priority support',
    ],
  },
}

// ---- comparison table --------------------------------------------------------
// Cells are resolved from plan_limits at render time so the table can never
// drift from the cards or from enforcement.
export interface CompareRow {
  label: string
  cell: (l: PlanLimits) => string
}

export const COMPARE_ROWS: CompareRow[] = [
  { label: 'Members', cell: (l) => (l.max_members == null ? 'Unlimited' : String(l.max_members)) },
  { label: 'Admin seats', cell: (l) => (l.max_admins == null ? 'Unlimited' : String(l.max_admins)) },
  { label: 'Dashboard', cell: () => '✓' },
  { label: 'Learning Center', cell: () => '✓' },
  { label: 'Business Path', cell: () => '✓' },
  { label: 'Goals & accountability', cell: () => '✓' },
  { label: 'My Network', cell: () => '✓' },
  { label: 'Finance & Wallet', cell: () => '✓' },
  { label: 'Events', cell: () => '✓' },
  { label: 'Assessments', cell: () => '✓' },
  { label: 'Leaderboard', cell: () => '✓' },
  { label: 'Reports & Insights', cell: (l) => l.reports_level.charAt(0).toUpperCase() + l.reports_level.slice(1) },
  { label: 'CSV export', cell: (l) => (l.reports_level === 'advanced' ? '✓' : '—') },
  { label: 'AI generations / month', cell: (l) => String(l.ai_exam_generations_per_month) },
  { label: 'AI questions / month', cell: (l) => String(l.ai_questions_per_month) },
  { label: 'Remove Bizzlivo badge', cell: (l) => (l.removes_badge ? '✓' : '—') },
  { label: 'Custom branding', cell: (l) => (l.custom_branding ? '✓' : '—') },
  { label: 'Priority support', cell: (l) => (l.plan === 'free' ? '—' : '✓') },
]
