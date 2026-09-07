// Centralized plan/entitlement layer. Components must NOT branch on
// `plan === 'growth'` — they read plan_limits (via get_org_usage) and go
// through the helpers here. `plan_limits` in the DB is the source of truth
// for prices + limits; PLAN_META below is presentation copy only.
//
// Pricing v3 (migration 0061): three PAID packages, a 30-day trial, and no
// perpetual Free tier. Every platform feature is on for every package —
// the only differences are price, seats and monthly AI quota.

import type { OrgUsage, PlanLimits, PlanTier, ReportsLevel } from '../types/database'

export const PLAN_ORDER: PlanTier[] = ['starter', 'growth', 'business']

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
  if (saved <= 0 || l.price_monthly_kobo === 0) return null
  const months = Math.round(saved / l.price_monthly_kobo)
  return `${months} month${months === 1 ? '' : 's'} free`
}

/** "15" / "Unlimited" for a quota that may be null. */
export function quotaLabel(n: number | null): string {
  return n == null ? 'Unlimited' : String(n)
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

// Every package includes every feature now, so these are always true for a
// live (trialing or active) office and false once the office is locked.
export function hasEntitlement(usage: OrgUsage | null, _key: 'removes_badge' | 'custom_branding'): boolean {
  return isPaidActive(usage)
}

// Reports are "advanced" on every package while the office is live.
export function reportsLevel(usage: OrgUsage | null): ReportsLevel {
  return isPaidActive(usage) ? (usage?.reports_level ?? 'advanced') : 'basic'
}
export function canUseReports(usage: OrgUsage | null, need: ReportsLevel): boolean {
  const order: ReportsLevel[] = ['basic', 'full', 'advanced']
  return order.indexOf(reportsLevel(usage)) >= order.indexOf(need)
}

/** Display label for the org's plan, safe for the non-package states. */
export function planLabel(usage: OrgUsage | null): string {
  if (!usage) return '—'
  if (usage.plan === 'starter' || usage.plan === 'growth' || usage.plan === 'business') {
    return PLAN_META[usage.plan].label
  }
  return 'Trial ended'
}

// ---- subscription state --------------------------------------------------
export function isPaidActive(usage: OrgUsage | null): boolean {
  return !!usage && (usage.status === 'active' || usage.status === 'trialing')
}

/** The office's trial/period has lapsed with no package chosen — the app
 *  should hard-lock until an admin picks one. */
export function needsPlanSelection(usage: OrgUsage | null): boolean {
  if (!usage) return false
  if (usage.plan === 'expired' || usage.plan === 'free') return true
  return usage.status === 'expired' || usage.status === 'canceled' || usage.status === 'past_due'
}

export function subscriptionStatusLabel(usage: OrgUsage | null): string {
  if (!usage) return '—'
  if (needsPlanSelection(usage)) return 'Trial ended'
  switch (usage.status) {
    case 'trialing': return 'Trial'
    case 'active': return usage.cancel_at_period_end ? 'Cancels at period end' : 'Active'
    case 'past_due': return 'Past due'
    case 'canceled': return 'Cancelled'
    case 'expired': return 'Trial ended'
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
   *  the qualitative lines only. */
  bullets: (l: PlanLimits) => string[]
}

const seatLine = (l: PlanLimits) =>
  l.max_members == null ? '50+ members (unlimited)' : `Up to ${l.max_members} members`
const adminLine = (l: PlanLimits) =>
  l.max_admins == null ? 'Unlimited admin seats' : `${l.max_admins} admin seat${l.max_admins === 1 ? '' : 's'}`
const aiLine = (l: PlanLimits) =>
  `AI: ${quotaLabel(l.ai_exam_generations_per_month)} generations · ${quotaLabel(l.ai_questions_per_month)} questions / month`

const ALL_FEATURES = 'Every Bizzlivo feature included — Dashboard, Learning Center, Business Path, Goals, My Network, Finance & Wallet, Events, Assessments, Leaderboard, advanced Reports + CSV, custom logo & brand colour'

export const PLAN_META: Record<PlanTier, PlanMeta> = {
  starter: {
    label: 'Starter',
    tagline: 'For a small office finding its feet.',
    headline: 'Run your business office.',
    bullets: (l) => [seatLine(l), adminLine(l), ALL_FEATURES, aiLine(l), 'Priority support'],
  },
  growth: {
    label: 'Growth',
    tagline: 'For a growing office building a consistent team.',
    headline: 'Grow your team with room to move.',
    recommended: true,
    bullets: (l) => [seatLine(l), adminLine(l), ALL_FEATURES, aiLine(l), 'Priority support'],
  },
  business: {
    label: 'Business',
    tagline: 'For an established office at scale.',
    headline: 'Run a large organization with no ceilings.',
    bullets: (l) => [seatLine(l), adminLine(l), ALL_FEATURES, aiLine(l), 'Priority support'],
  },
}

// ---- comparison table --------------------------------------------------------
// Every feature is included on every package, so the table only shows what
// actually differs: seats and AI quota. Cells resolve from plan_limits so
// the table can't drift from the cards or from enforcement.
export interface CompareRow {
  label: string
  cell: (l: PlanLimits) => string
}

export const COMPARE_ROWS: CompareRow[] = [
  { label: 'Members', cell: (l) => (l.max_members == null ? '50+ (unlimited)' : String(l.max_members)) },
  { label: 'Admin seats', cell: (l) => quotaLabel(l.max_admins) },
  { label: 'AI generations / month', cell: (l) => quotaLabel(l.ai_exam_generations_per_month) },
  { label: 'AI questions / month', cell: (l) => quotaLabel(l.ai_questions_per_month) },
  { label: 'All platform features', cell: () => '✓' },
  { label: 'Advanced Reports + CSV export', cell: () => '✓' },
  { label: 'Custom logo & brand colour', cell: () => '✓' },
  { label: 'Remove Bizzlivo badge', cell: () => '✓' },
  { label: 'Priority support', cell: () => '✓' },
]
