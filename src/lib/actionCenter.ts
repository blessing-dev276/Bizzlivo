// Action Center — "what should I do today?" for the member dashboard.
// Derives a single prioritized list of Action objects from the source
// systems (Business Path, Goals, Network, Freelance, Finance). Nothing is
// stored — rebuilt on every dashboard load, so it can never go stale.
import { supabase } from './supabase'
import type { PathState } from './businessPath'
import { monthKeyOf, targetMet } from './goals'
import { attentionFrom, loadFreelance } from './freelance'
import { loadMemberBalances } from './finance'
import type { MemberMonthlyGoal, MoneyByCurrency } from '../types/database'

export type ActionCategory = 'goals' | 'business_path' | 'network' | 'freelance' | 'finance'
export type ActionPriority = 'critical' | 'high' | 'normal'

export interface Action {
  id: string
  category: ActionCategory
  priority: ActionPriority
  title: string
  description?: string
  ctaLabel: string
  ctaRoute: string
  dueAt?: string | null
}

export const CATEGORY_LABEL: Record<ActionCategory, string> = {
  goals: 'Goals',
  business_path: 'Business Path',
  network: 'Network',
  freelance: 'Freelance',
  finance: 'Finance',
}

const PRIO_ORDER: Record<ActionPriority, number> = { critical: 0, high: 1, normal: 2 }
const WON_LOST = new Set(['won_customer', 'won_distributor', 'lost'])

export async function loadActions(orgId: string, userId: string, path: PathState | null): Promise<Action[]> {
  const out: Action[] = []
  const monthKey = monthKeyOf(new Date())
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' })

  const [goalsRes, netRes, fl, bal] = await Promise.all([
    supabase
      .from('member_monthly_goals')
      .select('*')
      .eq('org_id', orgId).eq('user_id', userId)
      .eq('period_type', 'monthly').eq('month', monthKey),
    supabase
      .from('network_marketing_contacts')
      .select('full_name, stage, next_follow_up_at')
      .eq('org_id', orgId).eq('user_id', userId),
    loadFreelance(orgId, userId).catch(() => null),
    loadMemberBalances(orgId, userId).catch(() => null),
  ])

  // ---- Goals ----
  const goals = (goalsRes.data as MemberMonthlyGoal[]) ?? []
  if (goals.length === 0) {
    out.push({
      id: 'goals-missing', category: 'goals', priority: 'critical',
      title: `Set your ${monthLabel} goals`,
      description: "You haven't planned any goals for this month.",
      ctaLabel: 'Set Goals', ctaRoute: '/goals',
    })
  } else {
    const changes = goals.filter((g) => g.status === 'changes_requested')
    if (changes.length) {
      out.push({
        id: 'goals-changes', category: 'goals', priority: 'critical',
        title: `${changes.length} goal${changes.length > 1 ? 's' : ''} need changes`,
        description: changes[0].title,
        ctaLabel: 'View', ctaRoute: '/goals',
      })
    }
    const ready = goals.filter((g) => (g.status === 'active' || g.status === 'changes_requested') && targetMet(g))
    if (ready.length) {
      out.push({
        id: 'goals-ready', category: 'goals', priority: 'high',
        title: `${ready.length} goal${ready.length > 1 ? 's' : ''} ready to submit`,
        ctaLabel: 'Review Goals', ctaRoute: '/goals',
      })
    }
  }

  // ---- Business Path ----
  if (path?.current) {
    const items = [...path.current.learning, ...path.current.tasks]
    for (const s of items) {
      if (s.status === 'changes_requested') {
        out.push({ id: `bp-cr-${s.item.id}`, category: 'business_path', priority: 'critical', title: `"${s.item.title}" needs changes`, ctaLabel: 'Open', ctaRoute: s.href ?? '/business-path' })
      } else if (s.status === 'rejected') {
        out.push({ id: `bp-rj-${s.item.id}`, category: 'business_path', priority: 'critical', title: `"${s.item.title}" was rejected`, ctaLabel: 'Open', ctaRoute: s.href ?? '/business-path' })
      }
    }
    if (path.readyForPromotion && path.promotionMode === 'approval' && path.next) {
      out.push({ id: 'bp-promo', category: 'business_path', priority: 'high', title: `You're ready for ${path.next.name}`, description: 'All requirements complete — your office will confirm the promotion.', ctaLabel: 'View Business Path', ctaRoute: '/business-path' })
    } else if (!path.readyForPromotion) {
      const next = items.find((s) => s.item.is_required && !s.complete && s.status !== 'awaiting_approval')
      if (next) {
        out.push({ id: `bp-next-${next.item.id}`, category: 'business_path', priority: 'high', title: next.item.title, description: `Next step toward ${path.next?.name ?? 'your next rank'}`, ctaLabel: 'Continue', ctaRoute: next.href ?? '/business-path' })
      }
    }
  }

  // ---- Network follow-ups ----
  const contacts = (netRes.data as { full_name: string; stage: string; next_follow_up_at: string | null }[]) ?? []
  const overdue = contacts.filter((c) => !WON_LOST.has(c.stage) && c.next_follow_up_at && new Date(c.next_follow_up_at).getTime() <= Date.now())
  if (overdue.length) {
    out.push({
      id: 'net-followups', category: 'network', priority: 'high',
      title: `${overdue.length} prospect follow-up${overdue.length > 1 ? 's' : ''} due`,
      description: overdue[0].full_name,
      ctaLabel: 'View Follow-ups', ctaRoute: '/my-team?tab=followups',
    })
  }

  // ---- Freelance ----
  if (fl) {
    const a = attentionFrom(fl)
    if (a.projectsOverdue) {
      out.push({ id: 'fl-overdue', category: 'freelance', priority: 'critical', title: `${a.projectsOverdue} freelance project${a.projectsOverdue > 1 ? 's' : ''} past due`, ctaLabel: 'View', ctaRoute: '/freelance?view=projects' })
    }
    const due = a.prospectFollowupsDue + a.projectFollowupsDue
    if (due) {
      out.push({ id: 'fl-followups', category: 'freelance', priority: 'high', title: `${due} freelance follow-up${due > 1 ? 's' : ''} due`, ctaLabel: 'View', ctaRoute: '/freelance' })
    }
  }

  // ---- Finance ----
  const avail = ((bal?.available ?? []) as MoneyByCurrency[]).filter((m) => Number(m.amount) > 0)
  if (avail.length) {
    const txt = avail.map((m) => `${m.currency} ${Number(m.amount).toLocaleString()}`).join(', ')
    out.push({ id: 'fin-avail', category: 'finance', priority: 'normal', title: `${txt} available`, description: 'Ready to withdraw from your wallet.', ctaLabel: 'View Wallet', ctaRoute: '/wallet' })
  }

  return out.sort(
    (x, y) => PRIO_ORDER[x.priority] - PRIO_ORDER[y.priority] || (x.dueAt ?? '').localeCompare(y.dueAt ?? ''),
  )
}
