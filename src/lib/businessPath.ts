// Business Path — the progression layer that orchestrates existing Bizzlivo
// systems. It never stores "completed = true" for anything another system
// already tracks: content completion reuses src/lib/taskProgress.ts,
// activity/learning completion is counted live from the owning tables,
// and only manual / self-confirm items get a row in
// business_path_item_progress. See 0035 + 0040.
import { supabase } from './supabase'
import {
  computeAssignmentCompletion,
  computeClassCompletion,
  computeExamCompletion,
} from './taskProgress'
import { itemDone as classItemDone, loadMemberCtx as loadClassCtx } from './learningCenter'
import type {
  BusinessPathItem,
  BusinessPathItemProgressStatus,
  BusinessPathRank,
  ClassModuleItem,
  LearningArea,
  MemberRankProgress,
} from '../types/database'

export const DEFAULT_BUSINESS_PATH_RANKS = [
  { slug: 'prospect', name: 'Prospect', description: 'Getting to know the business and finishing onboarding.' },
  { slug: 'newbie', name: 'Newbie', description: 'Registered and working your first prospects.' },
  { slug: 'qualified', name: 'Qualified', description: 'First customers won and a steady follow-up habit.' },
  { slug: 'builder', name: 'Team Builder', description: 'Recruiting distributors and helping them start.' },
  { slug: 'leader', name: 'Team Leader', description: 'Leading an active team toward their own ranks.' },
  { slug: 'director', name: 'Director', description: 'Multiple leaders in depth and a self-driven organisation.' },
]

export async function seedDefaultRanks(orgId: string) {
  const { count } = await supabase
    .from('business_path_ranks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if ((count ?? 0) > 0) return
  return supabase
    .from('business_path_ranks')
    .insert(DEFAULT_BUSINESS_PATH_RANKS.map((r, i) => ({ org_id: orgId, order_index: i, ...r })))
}

const AREA_LABEL: Record<LearningArea, string> = {
  onboarding: 'Onboarding',
  network_marketing: 'Network Marketing',
  freelancing: 'Freelancing',
  personal_development: 'Personal Development',
  income_development: 'Income Development',
}

export const ITEM_KIND_LABEL: Record<string, string> = {
  class: 'Complete class',
  exam: 'Pass quiz',
  assignment: 'Complete assignment',
  resource: 'Study resource',
  link: 'Open link',
  daily_reports: 'Submit daily reports',
  prospects_added: 'Add prospects',
  followups_logged: 'Log follow-ups',
  event_attendance: 'Attend event',
  income_logged: 'Log income',
  monthly_goal: 'Complete a monthly goal',
  manual_admin: 'Staff-verified task',
  manual_self: 'Self-confirmed task',
  profile_completion: 'Complete your profile',
  onboarding_completion: 'Complete onboarding',
  learning_count: 'Learning completion',
  goal_created: 'Set a goal',
  three_month_goals: 'Set 3-month goals',
  direct_member_count: 'Grow your team',
}

export const SELF_CONFIRM_KINDS = new Set(['resource', 'link', 'manual_self'])
// Kinds whose completion is purely a business_path_item_progress row.
const PROGRESS_ROW_KINDS = new Set(['resource', 'link', 'manual_admin', 'manual_self'])

export type RequirementStatus =
  | 'complete'
  | 'in_progress'
  | 'not_started'
  | 'awaiting_approval'
  | 'rejected'
  | 'changes_requested'

export interface PathItemState {
  item: BusinessPathItem
  complete: boolean
  status: RequirementStatus
  current: number
  target: number
  href: string | null
  /** true when a member cannot self-complete it (staff/approval gated) */
  staffOnly: boolean
  /** short label for the requirement row */
  label: string
}

export type RankStatus = 'done' | 'current' | 'locked'

export interface PathRankState {
  rank: BusinessPathRank
  status: RankStatus
  learning: PathItemState[]
  tasks: PathItemState[]
  learningCount: number
  taskCount: number
  requiredTotal: number
  requiredDone: number
  percent: number
}

export interface LearningAreaProgress {
  area: LearningArea
  label: string
  done: number
  total: number
}

export interface PathState {
  ranks: PathRankState[]
  currentRankId: string | null
  current: PathRankState | null
  next: BusinessPathRank | null
  promotionMode: PromotionModeValue
  startedAt: string | null
  readyForPromotion: boolean
  awaitingApproval: boolean
  /** learning-by-area, limited to areas the current rank references */
  learningByArea: LearningAreaProgress[]
}
type PromotionModeValue = 'automatic' | 'approval'

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function addMonths(d: Date, n: number) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

function hrefFor(item: BusinessPathItem): string | null {
  if (item.class_id) return `/training/classes/${item.class_id}`
  if (item.coursework_assignment_id) return `/my-assignments/${item.coursework_assignment_id}`
  if (item.link_url) return item.link_url
  if (item.kind === 'learning_count' && item.learning_area) return `/training?area=${item.learning_area}`
  if (item.kind === 'profile_completion') return '/settings'
  if (item.kind === 'onboarding_completion') return '/training?area=onboarding'
  if (item.kind === 'goal_created' || item.kind === 'three_month_goals' || item.kind === 'monthly_goal') return '/goals'
  if (item.kind === 'prospects_added' || item.kind === 'followups_logged' || item.kind === 'direct_member_count') return '/my-team'
  if (item.kind === 'daily_reports') return '/'
  if (item.kind === 'income_logged') return '/wallet'
  if (item.kind === 'event_attendance') return item.event_id ? `/events/${item.event_id}` : '/events'
  return null
}

export async function loadActiveRanks(orgId: string): Promise<BusinessPathRank[]> {
  const { data } = await supabase
    .from('business_path_ranks')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('order_index', { ascending: true })
  return (data as BusinessPathRank[]) ?? []
}

export async function loadAllRanks(orgId: string): Promise<BusinessPathRank[]> {
  const { data } = await supabase
    .from('business_path_ranks')
    .select('*')
    .eq('org_id', orgId)
    .order('order_index', { ascending: true })
  return (data as BusinessPathRank[]) ?? []
}

export async function loadRankItems(orgId: string, rankId: string): Promise<BusinessPathItem[]> {
  const { data } = await supabase
    .from('business_path_items')
    .select('*')
    .eq('org_id', orgId)
    .eq('rank_id', rankId)
    .order('section', { ascending: true })
    .order('order_index', { ascending: true })
  return (data as BusinessPathItem[]) ?? []
}

// Learning areas unlock as the member climbs the Business Path. Gated by the
// current rank's position (order_index) rather than its slug, so it keeps
// working when an org renames or reorders its ranks:
//   position 0 (Prospect)  → Onboarding only
//   position 1 (Newbie)    → everything except Income Development
//   position 2+ (Qualified…) → all areas
const AREA_UNLOCK_POSITION: Record<LearningArea, number> = {
  onboarding: 0,
  network_marketing: 1,
  freelancing: 1,
  personal_development: 1,
  income_development: 2,
}

export interface LearningAreaAccess {
  unlocked: Set<LearningArea>
  /** area → "Unlocks at <rank name>" for locked areas */
  lockedReason: Map<LearningArea, string>
}

export async function loadLearningAreaAccess(orgId: string, userId: string): Promise<LearningAreaAccess> {
  const [ranks, progress] = await Promise.all([
    loadActiveRanks(orgId),
    supabase
      .from('member_rank_progress')
      .select('current_rank_id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  const currentRankId =
    (progress.data as { current_rank_id: string | null } | null)?.current_rank_id ?? ranks[0]?.id ?? null
  const currentPos = Math.max(0, ranks.findIndex((r) => r.id === currentRankId))

  const unlocked = new Set<LearningArea>()
  const lockedReason = new Map<LearningArea, string>()
  for (const [area, needPos] of Object.entries(AREA_UNLOCK_POSITION) as [LearningArea, number][]) {
    if (currentPos >= needPos) {
      unlocked.add(area)
    } else {
      const gate = ranks[needPos]
      lockedReason.set(area, gate ? `Unlocks at ${gate.name}` : 'Locked')
    }
  }
  return { unlocked, lockedReason }
}

async function ensureRankProgress(
  orgId: string,
  userId: string,
  ranks: BusinessPathRank[],
): Promise<{ currentRankId: string | null; startedAt: string | null }> {
  const { data } = await supabase
    .from('member_rank_progress')
    .select('current_rank_id, started_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  const row = data as Pick<MemberRankProgress, 'current_rank_id' | 'started_at'> | null
  if (row?.current_rank_id) return { currentRankId: row.current_rank_id, startedAt: row.started_at }

  const firstRank = ranks[0]
  if (!firstRank) return { currentRankId: null, startedAt: null }

  const startedAt = new Date().toISOString()
  if (row) {
    await supabase
      .from('member_rank_progress')
      .update({ current_rank_id: firstRank.id, started_at: startedAt, updated_at: startedAt })
      .eq('org_id', orgId)
      .eq('user_id', userId)
  } else {
    await supabase.from('member_rank_progress').insert({
      org_id: orgId,
      user_id: userId,
      current_rank: null,
      current_rank_id: firstRank.id,
      started_at: startedAt,
    })
  }
  return { currentRankId: firstRank.id, startedAt }
}

interface Ctx {
  progressByItem: Map<string, BusinessPathItemProgressStatus>
  dailyReports: number
  prospectsAdded: number
  followupsLogged: number
  incomeEntries: number
  incomeTotal: number
  attendedEventIds: Set<string>
  eventAttendCount: number
  monthlyGoalsDone: number
  // rank-aware requirement inputs (0040)
  profileFilled: { phone: boolean; avatar_url: boolean; sponsor: boolean }
  onboardingDone: number
  onboardingTotal: number
  learningByArea: Map<LearningArea, { done: number; total: number }>
  goalMonths: Set<string>
  directMemberCount: number
}

async function onboardingProgress(orgId: string, userId: string): Promise<{ done: number; total: number }> {
  const { data: mods } = await supabase
    .from('onboarding_modules')
    .select('id')
    .eq('org_id', orgId)
    .eq('status', 'published')
  const modIds = ((mods as { id: string }[]) ?? []).map((m) => m.id)
  if (modIds.length === 0) return { done: 0, total: 0 }
  const [{ data: items }, { data: prog }, { data: attempts }] = await Promise.all([
    supabase.from('onboarding_step_items').select('id, module_id, type, exam_id').in('module_id', modIds),
    supabase.from('onboarding_item_progress').select('item_id').eq('org_id', orgId).eq('user_id', userId),
    supabase.from('attempts').select('exam_id').eq('org_id', orgId).eq('user_id', userId).eq('status', 'submitted').eq('passed', true),
  ])
  const doneItemIds = new Set(((prog as { item_id: string }[]) ?? []).map((r) => r.item_id))
  const passed = new Set(((attempts as { exam_id: string }[]) ?? []).map((r) => r.exam_id))
  const rows = (items as { id: string; module_id: string; type: string; exam_id: string | null }[]) ?? []
  let done = 0
  for (const mid of modIds) {
    const its = rows.filter((i) => i.module_id === mid)
    if (its.length > 0 && its.every((i) => (i.type === 'quiz' ? !!i.exam_id && passed.has(i.exam_id) : doneItemIds.has(i.id)))) done++
  }
  return { done, total: modIds.length }
}

async function learningByArea(orgId: string, userId: string): Promise<Map<LearningArea, { done: number; total: number }>> {
  const out = new Map<LearningArea, { done: number; total: number }>()
  const areas: LearningArea[] = ['network_marketing', 'freelancing', 'personal_development', 'income_development']
  for (const a of areas) out.set(a, { done: 0, total: 0 })

  const { data: classes } = await supabase
    .from('classes')
    .select('id, area')
    .eq('org_id', orgId)
    .eq('status', 'published')
    .in('area', areas)
  const classRows = (classes as { id: string; area: LearningArea }[]) ?? []
  if (classRows.length === 0) return out
  const areaOfClass = new Map(classRows.map((c) => [c.id, c.area]))

  const { data: mods } = await supabase
    .from('class_modules')
    .select('id, class_id')
    .eq('status', 'published')
    .in('class_id', classRows.map((c) => c.id))
  const modRows = (mods as { id: string; class_id: string }[]) ?? []
  if (modRows.length === 0) return out

  const { data: items } = await supabase.from('class_module_items').select('*').in('module_id', modRows.map((m) => m.id))
  const itemRows = (items as ClassModuleItem[]) ?? []
  const ctx = await loadClassCtx(orgId, userId)
  const itemsByModule = new Map<string, ClassModuleItem[]>()
  for (const it of itemRows) {
    const l = itemsByModule.get(it.module_id) ?? []
    l.push(it)
    itemsByModule.set(it.module_id, l)
  }
  for (const m of modRows) {
    const area = areaOfClass.get(m.class_id)
    if (!area) continue
    const bucket = out.get(area)!
    bucket.total++
    const its = itemsByModule.get(m.id) ?? []
    if (its.length > 0 && its.every((it) => classItemDone(it, ctx))) bucket.done++
  }
  return out
}

async function loadCtx(orgId: string, userId: string, sinceIso: string): Promise<Ctx> {
  const [
    progressR, reportsR, prospectsR, followupsR, incomeR, attendR, goalsDoneR,
    profileR, goalMonthsR, downlineR, onboarding, learning,
  ] = await Promise.all([
    supabase.from('business_path_item_progress').select('item_id, status').eq('org_id', orgId).eq('user_id', userId),
    supabase.from('member_daily_reports').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('user_id', userId).gte('report_on', sinceIso.slice(0, 10)),
    supabase.from('network_marketing_contacts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('user_id', userId).gte('created_at', sinceIso),
    supabase.from('network_marketing_activities').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('user_id', userId).gte('created_at', sinceIso),
    supabase.from('income_development_income_entries').select('amount').eq('org_id', orgId).eq('user_id', userId).gte('earned_on', sinceIso.slice(0, 10)),
    supabase.from('event_attendees').select('event_id, events!inner(org_id)').eq('user_id', userId).eq('events.org_id', orgId),
    supabase.from('member_monthly_goals').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('user_id', userId).eq('month', monthKey(new Date())).eq('status', 'approved'),
    supabase.from('profiles').select('phone, avatar_url, sponsor_member_id, sponsor_name').eq('id', userId).maybeSingle(),
    supabase.from('member_monthly_goals').select('month').eq('org_id', orgId).eq('user_id', userId),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('sponsor_member_id', userId),
    onboardingProgress(orgId, userId),
    learningByArea(orgId, userId),
  ])

  const incomeRows = (incomeR.data as { amount: number }[]) ?? []
  const attendedEventIds = new Set(((attendR.data as { event_id: string }[]) ?? []).map((r) => r.event_id))
  const p = (profileR.data as { phone: string | null; avatar_url: string | null; sponsor_member_id: string | null; sponsor_name: string | null } | null) ?? null

  return {
    progressByItem: new Map(((progressR.data as { item_id: string; status: BusinessPathItemProgressStatus }[]) ?? []).map((r) => [r.item_id, r.status])),
    dailyReports: reportsR.count ?? 0,
    prospectsAdded: prospectsR.count ?? 0,
    followupsLogged: followupsR.count ?? 0,
    incomeEntries: incomeRows.length,
    incomeTotal: incomeRows.reduce((s, r) => s + Number(r.amount), 0),
    attendedEventIds,
    eventAttendCount: attendedEventIds.size,
    monthlyGoalsDone: goalsDoneR.count ?? 0,
    profileFilled: {
      phone: !!p?.phone?.trim(),
      avatar_url: !!p?.avatar_url,
      sponsor: !!(p?.sponsor_member_id || p?.sponsor_name?.trim()),
    },
    onboardingDone: onboarding.done,
    onboardingTotal: onboarding.total,
    learningByArea: learning,
    goalMonths: new Set(((goalMonthsR.data as { month: string }[]) ?? []).map((r) => r.month)),
    directMemberCount: downlineR.count ?? 0,
  }
}

function statusFrom(complete: boolean, current: number): RequirementStatus {
  if (complete) return 'complete'
  return current > 0 ? 'in_progress' : 'not_started'
}

async function stateForItem(item: BusinessPathItem, userId: string, ctx: Ctx): Promise<PathItemState> {
  const href = hrefFor(item)
  const label = item.kind === 'learning_count' && item.learning_area
    ? AREA_LABEL[item.learning_area]
    : ITEM_KIND_LABEL[item.kind] ?? item.kind
  let complete = false
  let current = 0
  let target = 1
  let status: RequirementStatus

  // Manual validation overrides the automatic derivation entirely.
  if (item.validation_mode === 'manual' || PROGRESS_ROW_KINDS.has(item.kind)) {
    const st = ctx.progressByItem.get(item.id)
    complete = st === 'approved' || st === 'complete'
    current = complete ? 1 : 0
    status = complete
      ? 'complete'
      : st === 'awaiting_approval'
        ? 'awaiting_approval'
        : st === 'rejected'
          ? 'rejected'
          : st === 'changes_requested'
            ? 'changes_requested'
            : 'not_started'
    const staffOnly = item.kind === 'manual_admin' || (item.validation_mode === 'manual' && !SELF_CONFIRM_KINDS.has(item.kind))
    return { item, complete, status, current, target, href, staffOnly, label }
  }

  switch (item.kind) {
    case 'class':
      complete = item.class_id ? (await computeClassCompletion(item.class_id, userId)).complete : false
      current = complete ? 1 : 0
      break
    case 'exam':
      complete = item.exam_id ? (await computeExamCompletion(item.exam_id, userId)).complete : false
      current = complete ? 1 : 0
      break
    case 'assignment':
      complete = item.coursework_assignment_id
        ? (await computeAssignmentCompletion(item.coursework_assignment_id, userId)).complete
        : false
      current = complete ? 1 : 0
      break
    case 'daily_reports':
      target = item.target_count ?? 1
      current = Math.min(ctx.dailyReports, target)
      complete = ctx.dailyReports >= target
      break
    case 'prospects_added':
      target = item.target_count ?? 1
      current = Math.min(ctx.prospectsAdded, target)
      complete = ctx.prospectsAdded >= target
      break
    case 'followups_logged':
      target = item.target_count ?? 1
      current = Math.min(ctx.followupsLogged, target)
      complete = ctx.followupsLogged >= target
      break
    case 'event_attendance':
      if (item.event_id) {
        complete = ctx.attendedEventIds.has(item.event_id)
        current = complete ? 1 : 0
      } else {
        target = item.target_count ?? 1
        current = Math.min(ctx.eventAttendCount, target)
        complete = ctx.eventAttendCount >= target
      }
      break
    case 'income_logged':
      if (item.target_amount != null) {
        target = item.target_amount
        current = Math.min(ctx.incomeTotal, target)
        complete = ctx.incomeTotal >= target
      } else {
        target = item.target_count ?? 1
        current = Math.min(ctx.incomeEntries, target)
        complete = ctx.incomeEntries >= target
      }
      break
    case 'monthly_goal':
      complete = ctx.monthlyGoalsDone >= 1
      current = complete ? 1 : 0
      break
    case 'profile_completion': {
      const fields = (item.config?.fields as string[] | undefined) ?? ['phone', 'avatar_url', 'sponsor']
      target = fields.length || 1
      current = fields.filter((f) => (ctx.profileFilled as Record<string, boolean>)[f]).length
      complete = current >= target
      break
    }
    case 'onboarding_completion':
      target = Math.max(1, ctx.onboardingTotal)
      current = ctx.onboardingDone
      complete = ctx.onboardingTotal > 0 && ctx.onboardingDone >= ctx.onboardingTotal
      break
    case 'learning_count': {
      const bucket = item.learning_area ? ctx.learningByArea.get(item.learning_area) : undefined
      target = item.target_count ?? bucket?.total ?? 1
      current = Math.min(bucket?.done ?? 0, target)
      complete = (bucket?.done ?? 0) >= target
      break
    }
    case 'goal_created':
      complete = ctx.goalMonths.has(monthKey(new Date()))
      current = complete ? 1 : 0
      break
    case 'three_month_goals': {
      const now = new Date()
      const needed = [monthKey(now), monthKey(addMonths(now, 1)), monthKey(addMonths(now, 2))]
      target = 3
      current = needed.filter((m) => ctx.goalMonths.has(m)).length
      complete = current >= 3
      break
    }
    case 'direct_member_count':
      target = item.target_count ?? 1
      current = Math.min(ctx.directMemberCount, target)
      complete = ctx.directMemberCount >= target
      break
    default:
      break
  }

  status = statusFrom(complete, current)
  return { item, complete, status, current, target, href, staffOnly: false, label }
}

export async function loadPathState(orgId: string, userId: string): Promise<PathState> {
  const ranks = await loadActiveRanks(orgId)
  if (ranks.length === 0) {
    return { ranks: [], currentRankId: null, current: null, next: null, promotionMode: 'automatic', startedAt: null, readyForPromotion: false, awaitingApproval: false, learningByArea: [] }
  }

  const { currentRankId, startedAt } = await ensureRankProgress(orgId, userId, ranks)
  const currentIdx = ranks.findIndex((r) => r.id === currentRankId)
  const sinceIso = startedAt ?? new Date(0).toISOString()

  const currentRank = currentIdx >= 0 ? ranks[currentIdx] : ranks[0]

  // These three don't depend on each other — fan them out instead of
  // waterfalling (loadRankItems → loadCtx → counts).
  const [allItems, ctx, countsRes] = await Promise.all([
    currentRank ? loadRankItems(orgId, currentRank.id) : Promise.resolve([] as BusinessPathItem[]),
    currentRank ? loadCtx(orgId, userId, sinceIso) : Promise.resolve(null as Ctx | null),
    supabase.from('business_path_items').select('rank_id, section').eq('org_id', orgId),
  ])

  // Per-item completion — resolve every item concurrently rather than one
  // round-trip at a time (this loop was the dashboard's main stall).
  const currentItemStates: PathItemState[] =
    currentRank && ctx ? await Promise.all(allItems.map((item) => stateForItem(item, userId, ctx))) : []

  const countsRaw = countsRes.data
  const counts = new Map<string, { learning: number; task: number }>()
  for (const r of (countsRaw as { rank_id: string; section: string }[]) ?? []) {
    const c = counts.get(r.rank_id) ?? { learning: 0, task: 0 }
    if (r.section === 'learning') c.learning += 1
    else c.task += 1
    counts.set(r.rank_id, c)
  }

  const effectiveIdx = currentIdx >= 0 ? currentIdx : 0
  const rankStates: PathRankState[] = ranks.map((rank, idx) => {
    const status: RankStatus = idx < effectiveIdx ? 'done' : idx === effectiveIdx ? 'current' : 'locked'
    const cfg = counts.get(rank.id) ?? { learning: 0, task: 0 }
    if (status !== 'current') {
      const total = cfg.learning + cfg.task
      return { rank, status, learning: [], tasks: [], learningCount: cfg.learning, taskCount: cfg.task, requiredTotal: total, requiredDone: status === 'done' ? total : 0, percent: status === 'done' ? 100 : 0 }
    }
    const learning = currentItemStates.filter((s) => s.item.section === 'learning')
    const tasks = currentItemStates.filter((s) => s.item.section === 'task')
    const required = currentItemStates.filter((s) => s.item.is_required)
    const requiredDone = required.filter((s) => s.complete).length
    return {
      rank, status, learning, tasks, learningCount: cfg.learning, taskCount: cfg.task,
      requiredTotal: required.length, requiredDone,
      percent: required.length === 0 ? 0 : Math.round((requiredDone / required.length) * 100),
    }
  })

  const current = rankStates[effectiveIdx] ?? null
  const next = effectiveIdx < ranks.length - 1 ? ranks[effectiveIdx + 1] : null
  const readyForPromotion = !!current && current.requiredTotal > 0 && current.requiredDone >= current.requiredTotal
  const awaitingApproval = currentItemStates.some((s) => s.status === 'awaiting_approval')

  // learning-by-area, limited to the areas this rank actually references
  const referenced = new Set<LearningArea>()
  for (const s of currentItemStates) {
    if (s.item.kind === 'learning_count' && s.item.learning_area) referenced.add(s.item.learning_area)
    if (s.item.kind === 'onboarding_completion') referenced.add('onboarding')
  }
  const learningAreas: LearningAreaProgress[] = []
  if (ctx) {
    if (referenced.has('onboarding')) learningAreas.push({ area: 'onboarding', label: AREA_LABEL.onboarding, done: ctx.onboardingDone, total: ctx.onboardingTotal })
    for (const [area, b] of ctx.learningByArea) {
      if (referenced.has(area)) learningAreas.push({ area, label: AREA_LABEL[area], done: b.done, total: b.total })
    }
    // higher ranks with no learning_count items still get all non-empty areas
    if (learningAreas.length === 0) {
      if (ctx.onboardingTotal > 0) learningAreas.push({ area: 'onboarding', label: AREA_LABEL.onboarding, done: ctx.onboardingDone, total: ctx.onboardingTotal })
      for (const [area, b] of ctx.learningByArea) {
        if (b.total > 0) learningAreas.push({ area, label: AREA_LABEL[area], done: b.done, total: b.total })
      }
    }
  }

  return {
    ranks: rankStates,
    currentRankId,
    current,
    next,
    promotionMode: (currentRank?.promotion_mode as PromotionModeValue) ?? 'automatic',
    startedAt,
    readyForPromotion,
    awaitingApproval,
    learningByArea: learningAreas,
  }
}

// ---- member actions ----
export async function selfConfirmItem(orgId: string, userId: string, itemId: string) {
  return supabase.from('business_path_item_progress').upsert(
    { org_id: orgId, user_id: userId, item_id: itemId, status: 'approved', marked_by: null },
    { onConflict: 'user_id,item_id' },
  )
}

export async function submitForApproval(orgId: string, userId: string, itemId: string, note?: string) {
  return supabase.from('business_path_item_progress').upsert(
    { org_id: orgId, user_id: userId, item_id: itemId, status: 'awaiting_approval', marked_by: null, note: note ?? null, reviewed_by: null, reviewed_at: null, review_note: null },
    { onConflict: 'user_id,item_id' },
  )
}

export async function unconfirmItem(userId: string, itemId: string) {
  return supabase.from('business_path_item_progress').delete().eq('user_id', userId).eq('item_id', itemId)
}

// staff review of a submitted manual item
export async function reviewItem(
  itemId: string,
  memberUserId: string,
  reviewerId: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  note?: string,
) {
  return supabase
    .from('business_path_item_progress')
    .update({ status: decision, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: note ?? null })
    .eq('item_id', itemId)
    .eq('user_id', memberUserId)
}

export async function promoteMember(orgId: string, userId: string, toRankId: string, isAuto = false) {
  return supabase.rpc('promote_member', {
    target_user: userId,
    target_org: orgId,
    to_rank_id: toRankId,
    is_auto: isAuto,
  })
}
