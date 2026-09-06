// Goals v2 domain layer — labels, lifecycle rules, formatting, and the
// data/RPC calls the member Goals page and the admin review page share.
// One table (member_monthly_goals) behind it all; see 0044_goals_v2.sql.
import { supabase } from '../supabase'
import type {
  GoalAutoSource,
  GoalCategory,
  GoalPriority,
  GoalStatus,
  GoalType,
  MemberMonthlyGoal,
} from '../../types/database'

export const CATEGORY_META: Record<GoalCategory, { label: string; icon: string }> = {
  learning: { label: 'Learning', icon: '📘' },
  network: { label: 'Network', icon: '🕸' },
  income: { label: 'Income', icon: '💰' },
  personal_development: { label: 'Personal Development', icon: '🌱' },
  business_path: { label: 'Business Path', icon: '🎯' },
  team: { label: 'Team', icon: '👥' },
  other: { label: 'Other', icon: '•' },
}
export const CATEGORIES = Object.keys(CATEGORY_META) as GoalCategory[]

export const STATUS_META: Record<GoalStatus, { label: string; tone: 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'muted'; locked: boolean }> = {
  draft: { label: 'Draft', tone: 'neutral', locked: false },
  active: { label: 'In Progress', tone: 'blue', locked: false },
  submitted: { label: 'Awaiting Review', tone: 'amber', locked: true },
  changes_requested: { label: 'Changes Requested', tone: 'amber', locked: false },
  approved: { label: 'Approved', tone: 'green', locked: true },
  rejected: { label: 'Rejected', tone: 'red', locked: true },
  month_closed_incomplete: { label: 'Month Closed — Incomplete', tone: 'muted', locked: true },
  cancelled: { label: 'Cancelled', tone: 'muted', locked: true },
  legacy_completed: { label: 'Completed', tone: 'green', locked: true },
}

export const PRIORITY_META: Record<GoalPriority, { label: string }> = {
  low: { label: 'Low' },
  normal: { label: 'Normal' },
  high: { label: 'High' },
}

export const GOAL_TYPE_META: Record<GoalType, { label: string }> = {
  binary: { label: 'Done / not done' },
  number: { label: 'A number to reach' },
  currency: { label: 'An amount of money' },
  percent: { label: 'A percentage' },
}

// Auto-progress sources — a goal set to one of these pulls its progress
// live from the owning system (server-side, see goals_sync_auto in 0046).
export const AUTO_SOURCE_META: Record<GoalAutoSource, { label: string; goalType: GoalType }> = {
  prospects_added: { label: 'Prospects added this period', goalType: 'number' },
  followups_logged: { label: 'Follow-ups logged this period', goalType: 'number' },
  income_amount: { label: 'Income logged this period (₦)', goalType: 'currency' },
  income_entries: { label: 'Income entries this period', goalType: 'number' },
  direct_members: { label: 'Direct members sponsored', goalType: 'number' },
  daily_reports: { label: 'Daily reports filed this period', goalType: 'number' },
  exams_passed: { label: 'Exams passed this period', goalType: 'number' },
  events_attended: { label: 'Events attended this period', goalType: 'number' },
  learning_modules: { label: 'Learning modules completed', goalType: 'number' },
}
export const AUTO_SOURCES = Object.keys(AUTO_SOURCE_META) as GoalAutoSource[]
export const LEARNING_AREAS = ['onboarding', 'network_marketing', 'freelancing', 'personal_development', 'income_development']

export function formatValue(type: GoalType, value: number | null, unit?: string | null): string {
  if (value == null) return '—'
  if (type === 'currency') return `₦${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (type === 'percent') return `${value}%`
  const n = Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
  return unit ? `${n} ${unit}` : n
}

export function goalPercent(g: Pick<MemberMonthlyGoal, 'goal_type' | 'target_value' | 'progress_value' | 'done'>): number {
  if (g.goal_type === 'binary') return g.done ? 100 : 0
  if (!g.target_value || g.target_value <= 0) return g.done ? 100 : 0
  return Math.min(100, Math.round((Number(g.progress_value) / Number(g.target_value)) * 100))
}

export function targetMet(g: Pick<MemberMonthlyGoal, 'goal_type' | 'target_value' | 'progress_value' | 'done'>): boolean {
  if (g.goal_type === 'binary') return g.done
  return g.target_value != null && Number(g.progress_value) >= Number(g.target_value)
}

export interface GoalActions {
  canEdit: boolean
  canDelete: boolean
  canUpdateProgress: boolean
  canSubmit: boolean
  canWithdraw: boolean
  canCarryForward: boolean
}

export function actionsFor(g: MemberMonthlyGoal): GoalActions {
  const open = g.status === 'draft' || g.status === 'active' || g.status === 'changes_requested'
  return {
    canEdit: open,
    canDelete: g.status === 'draft',
    canUpdateProgress: open && !g.auto_source,
    canSubmit: open && targetMet(g),
    canWithdraw: g.status === 'submitted',
    canCarryForward: g.status === 'month_closed_incomplete' || g.status === 'rejected' || g.status === 'changes_requested',
  }
}

export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function monthLabelOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
function periodBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end) }
}
function quarterBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m + 2, 0)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end) }
}

// ---- data ----
export interface NewGoalInput {
  title: string
  description?: string
  category: GoalCategory | null
  goal_type: GoalType
  unit?: string
  target_value: number | null
  priority: GoalPriority
  due_date: string | null
  period_type: 'monthly' | 'quarter'
  month: string
  auto_source?: GoalAutoSource | null
  auto_area?: string | null
  as_draft?: boolean
}

export async function createGoal(orgId: string, userId: string, input: NewGoalInput) {
  const b = input.period_type === 'quarter' ? quarterBounds(input.month) : periodBounds(input.month)
  return supabase.from('member_monthly_goals').insert({
    org_id: orgId,
    user_id: userId,
    month: input.month,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    category: input.category,
    goal_type: input.goal_type,
    unit: input.unit?.trim() || null,
    metric: input.unit?.trim() || null,
    target_value: input.goal_type === 'binary' ? null : input.target_value,
    target: input.goal_type === 'binary' ? null : (input.target_value != null ? Math.round(input.target_value) : null),
    progress_value: 0,
    progress: 0,
    priority: input.priority,
    due_date: input.due_date,
    status: input.as_draft ? 'draft' : 'active',
    period_type: input.period_type,
    period_start: b.start,
    period_end: b.end,
    progress_mode: input.auto_source ? 'auto' : 'manual',
    auto_source: input.auto_source ?? null,
    auto_area: input.auto_source === 'learning_modules' ? (input.auto_area ?? null) : null,
  })
}

export async function updateGoalFields(id: string, patch: Partial<MemberMonthlyGoal>) {
  return supabase.from('member_monthly_goals').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}

export async function setProgress(g: MemberMonthlyGoal, value: number) {
  const v = Math.max(0, value)
  const done = g.goal_type === 'binary' ? value >= 1 : (g.target_value != null && v >= Number(g.target_value))
  return supabase
    .from('member_monthly_goals')
    .update({ progress_value: v, progress: Math.round(v), done, updated_at: new Date().toISOString() })
    .eq('id', g.id)
}

export async function setBinaryDone(g: MemberMonthlyGoal, done: boolean) {
  return supabase
    .from('member_monthly_goals')
    .update({ done, progress_value: done ? 1 : 0, progress: done ? 1 : 0, updated_at: new Date().toISOString() })
    .eq('id', g.id)
}

export async function deleteGoal(id: string) {
  return supabase.from('member_monthly_goals').delete().eq('id', id)
}

export const goalRpc = {
  submit: (goalId: string, note?: string, evidence?: string) =>
    supabase.rpc('goal_submit', { p_goal: goalId, p_note: note ?? null, p_evidence: evidence ?? null }),
  withdraw: (goalId: string) => supabase.rpc('goal_withdraw', { p_goal: goalId }),
  review: (goalId: string, decision: 'approve' | 'changes' | 'reject', note?: string) =>
    supabase.rpc('goal_review', { p_goal: goalId, p_decision: decision, p_note: note ?? null }),
  carryForward: (goalId: string) => supabase.rpc('goal_carry_forward', { p_goal: goalId }),
  closeMonth: (orgId: string) => supabase.rpc('close_month_goals', { p_org: orgId }),
  setupReminder: (orgId: string) => supabase.rpc('goal_setup_reminder', { p_org: orgId }),
  syncAuto: (orgId: string) => supabase.rpc('goals_sync_auto', { p_org: orgId }),
  deadlineReminders: (orgId: string) => supabase.rpc('goal_deadline_reminders', { p_org: orgId }),
}

export interface GoalAuditRow {
  id: string
  action: string
  actor_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
export async function loadGoalAudit(goalId: string): Promise<GoalAuditRow[]> {
  const { data } = await supabase
    .from('audit_log')
    .select('id, action, actor_id, metadata, created_at')
    .eq('entity_type', 'goal')
    .eq('entity_id', goalId)
    .order('created_at', { ascending: true })
  return (data as GoalAuditRow[]) ?? []
}
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'goal.created': 'Goal created',
  'goal.active': 'Set active',
  'goal.submitted': 'Submitted for review',
  'goal.changes_requested': 'Changes requested',
  'goal.approved': 'Approved',
  'goal.rejected': 'Rejected',
  'goal.month_closed_incomplete': 'Month closed — incomplete',
  'goal.cancelled': 'Cancelled',
}

// Fire-and-forget lazy maintenance, safe to call on page load.
export async function runGoalMaintenance(orgId: string) {
  try {
    await goalRpc.closeMonth(orgId)
    await goalRpc.syncAuto(orgId)
    await goalRpc.setupReminder(orgId)
    await goalRpc.deadlineReminders(orgId)
  } catch {
    /* non-fatal — the page still renders from whatever state exists */
  }
}
