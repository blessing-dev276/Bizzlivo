// Domain layer for Bizzlivo Performance Points (the Leaderboard).
//
// Every scored value comes from `leaderboard_point_events`, an append-only
// ledger written only by SECURITY DEFINER triggers in 0059_leaderboard.sql.
// The client never writes points — it reads aggregates through RPCs, and
// admins configure rules through the RLS-guarded settings/rules tables.
import { supabase } from './supabase'

export type LbPeriod = 'week' | 'month' | 'all'
export type LbCategory = 'overall' | 'learning' | 'business_path' | 'network' | 'freelance' | 'goals'

export const PERIODS: { id: LbPeriod; label: string }[] = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
]

export const CATEGORY_TABS: { id: LbCategory; label: string }[] = [
  { id: 'overall', label: 'Overall' },
  { id: 'learning', label: 'Learning' },
  { id: 'business_path', label: 'Business Path' },
  { id: 'network', label: 'Network' },
  { id: 'freelance', label: 'Freelance' },
  { id: 'goals', label: 'Goals' },
]

export const CATEGORY_LABEL: Record<string, string> = {
  learning: 'Learning',
  business_path: 'Business Path',
  network: 'Network',
  freelance: 'Freelance',
  goals: 'Goals',
  events: 'Events',
  adjustment: 'Adjustments',
}

export interface LeaderboardRow {
  user_id: string
  full_name: string
  avatar_url: string | null
  business_rank: string
  team: string | null
  learning: number
  business_path: number
  network: number
  freelance: number
  goals: number
  events: number
  adjustment: number
  total: number
}

export interface MemberPoints {
  total: number
  position: number | null
  member_count: number
  movement: number | null
}

export interface PointBreakdown {
  categories: Record<string, number>
  recent: {
    points: number
    occurred_at: string
    category: string
    label: string
    reason: string | null
  }[]
}

export interface TeamRow {
  group_id: string
  name: string
  member_count: number
  total: number
}

export interface LeaderboardSettings {
  org_id: string
  enabled: boolean
  include_learning: boolean
  include_business_path: boolean
  include_goals: boolean
  include_network: boolean
  include_freelance: boolean
  include_events: boolean
  default_period: LbPeriod
  team_board_enabled: boolean
}

export interface PointRule {
  id: string
  org_id: string
  event_type: string
  category: string
  label: string
  points: number
  active: boolean
}

const INCLUDE_KEYS = [
  ['include_learning', 'Learning'],
  ['include_business_path', 'Business Path'],
  ['include_network', 'Network'],
  ['include_freelance', 'Freelance'],
  ['include_goals', 'Goals'],
  ['include_events', 'Events'],
] as const
export const INCLUDE_TOGGLES = INCLUDE_KEYS

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const getLeaderboard = (orgId: string, period: LbPeriod, category: LbCategory, group?: string | null) =>
  rpc<LeaderboardRow[]>('get_leaderboard', {
    p_org: orgId,
    p_period: period,
    p_category: category,
    p_group: group ?? null,
  })

export const getMemberPoints = (orgId: string, userId: string, period: LbPeriod) =>
  rpc<MemberPoints>('get_member_points', { p_org: orgId, p_user: userId, p_period: period })

export const getPointBreakdown = (orgId: string, userId: string, period: LbPeriod) =>
  rpc<PointBreakdown>('get_point_breakdown', { p_org: orgId, p_user: userId, p_period: period })

export const getTeamLeaderboard = (orgId: string, period: LbPeriod) =>
  rpc<TeamRow[]>('get_team_leaderboard', { p_org: orgId, p_period: period })

export const adjustPoints = (orgId: string, userId: string, points: number, reason: string) =>
  rpc<null>('leaderboard_adjust', { p_org: orgId, p_user: userId, p_points: points, p_reason: reason })

export const recalculate = (orgId: string, scope: 'month' | 'all') =>
  rpc<{ pruned: number; restated: number }>('leaderboard_recalculate', { p_org: orgId, p_scope: scope })

export const resetRules = (orgId: string) => rpc<null>('leaderboard_reset_rules', { p_org: orgId })

export async function loadSettings(orgId: string): Promise<LeaderboardSettings | null> {
  const { data } = await supabase.from('leaderboard_settings').select('*').eq('org_id', orgId).maybeSingle()
  return (data as LeaderboardSettings) ?? null
}

export async function saveSettings(orgId: string, patch: Partial<LeaderboardSettings>) {
  const { error } = await supabase
    .from('leaderboard_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
  if (error) throw new Error(error.message)
}

export async function loadRules(orgId: string): Promise<PointRule[]> {
  const { data } = await supabase
    .from('leaderboard_point_rules')
    .select('*')
    .eq('org_id', orgId)
    .order('category')
    .order('label')
  return (data as PointRule[]) ?? []
}

export async function saveRule(id: string, patch: { points?: number; active?: boolean }) {
  const { error } = await supabase
    .from('leaderboard_point_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export interface AdjustmentRow {
  id: string
  actor_id: string | null
  entity_id: string | null
  metadata: { points?: number; reason?: string } | null
  created_at: string
}

export async function loadAdjustments(orgId: string): Promise<AdjustmentRow[]> {
  const { data } = await supabase
    .from('audit_log')
    .select('id, actor_id, entity_id, metadata, created_at')
    .eq('org_id', orgId)
    .eq('action', 'leaderboard.adjust')
    .order('created_at', { ascending: false })
    .limit(50)
  return (data as AdjustmentRow[]) ?? []
}

/** Ordinal suffix — 1st, 2nd, 3rd, 4th… */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
