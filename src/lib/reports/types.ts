// Shapes returned by the 0041 reporting RPCs (jsonb -> these). Kept
// deliberately loose where the RPC builds dynamic objects.

export interface RankCount {
  name: string
  count: number
}
export interface SeriesPoint {
  date: string
  total?: number
  count?: number
  amount?: number
}

export interface OverviewReport {
  members_total: number
  members_all: number
  members_new: number
  members_new_prev: number
  members_active_7d: number
  bp_avg_percent: number
  bp_ready: number
  bp_near: number
  bp_pending_approvals: number
  promotions_in_period: number
  rank_distribution: RankCount[]
  income_period: number
  income_period_prev: number
  income_earners: number
  prospects_added: number
  followups_overdue: number
  assignments_pending_review: number
  onboarding_not_started: number
  inactive_7d: number
  member_growth: SeriesPoint[]
  promotions_series: SeriesPoint[]
  income_series: SeriesPoint[]
}

export interface BpMemberRow {
  user_id: string
  name: string
  rank: string | null
  required_total: number
  required_done: number
  percent: number
}
export interface BusinessPathReport {
  members: BpMemberRow[]
  ready: { user_id: string; name: string; rank: string | null }[]
  near: { user_id: string; name: string; rank: string | null; percent: number }[]
  stalled: { user_id: string; name: string; rank: string | null; percent: number }[]
  pending_approvals: { user_id: string; name: string; item: string; submitted_at: string }[]
  promotions: { user_id: string; name: string; rank: string | null; achieved_at: string; automatic: boolean }[]
}

export interface LearningAreaRow {
  area: string
  modules_total: number
  participants: number
  modules_done: number
}
export interface LearningReport {
  areas: LearningAreaRow[]
  onboarding: {
    items_total: number
    completed_members: number
    in_progress_members: number
    not_started_members: number
  }
  assessments: {
    attempts: number
    passed: number
    avg_score: number | null
    assignments_submitted: number
    assignments_pending: number
    assignments_approved: number
    per_exam: {
      exam_id: string
      title: string
      attempts: number
      passed: number
      pass_rate: number
      avg_score: number | null
    }[]
  }
  no_activity_members: number
}

export interface NetworkReport {
  contacts_total: number
  by_stage: Record<string, number>
  prospects_added: number
  activities_logged: number
  followups_scheduled: number
  followups_overdue: number
  no_followup: number
  members_joined_via_sponsor: number
  top_builders: { user_id: string; name: string; directs: number }[]
}

export interface TeamRow {
  team_id: string
  name: string
  leader: string | null
  members: number
  bp_avg: number
  network_growth: number
  income: number
}
export type TeamsReport = TeamRow[]

export interface IncomeReport {
  total_period: number
  total_all: number
  entries_period: number
  earners_period: number
  by_source: { source: string; amount: number }[]
  per_member: { user_id: string; name: string; amount: number }[]
  milestones: Record<string, number>
}

export interface MemberReport {
  name: string
  rank: string | null
  bp_required_total: number
  bp_required_done: number
  bp_percent: number
  bp_items: { title: string; required: boolean; complete: boolean }[]
  goals_total: number
  goals_done: number
  direct_members: number
  prospects: number
  income_total: number
  exams_passed: number
  joined_at: string | null
  last_activity: string | null
}

export const AREA_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  network_marketing: 'Network Marketing',
  freelancing: 'Freelancing',
  personal_development: 'Personal Development',
  income_development: 'Income Development',
}
