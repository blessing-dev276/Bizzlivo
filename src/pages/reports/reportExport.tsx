// Client-side CSV export. Builds a CSV string from already-loaded report
// data (so it inherently respects the active date range / filters) and
// triggers a download. No PDF/XLSX — those need a bundler or an Edge
// Function and are out of scope for this pass.
import type { ResolvedRange } from '../../lib/reports/range'
import type {
  BusinessPathReport,
  IncomeReport,
  LearningReport,
  NetworkReport,
  OverviewReport,
  TeamsReport,
} from '../../lib/reports/types'
import { AREA_LABELS } from '../../lib/reports/types'

function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
}

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = (range: ResolvedRange) =>
  `${range.start.toISOString().slice(0, 10)}_${new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}`

export function exportOverviewCsv(d: OverviewReport, range: ResolvedRange) {
  const rows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Period', range.label],
    ['Total members (active)', d.members_total],
    ['All memberships', d.members_all],
    ['New members this period', d.members_new],
    ['New members previous period', d.members_new_prev],
    ['Active in last 7 days', d.members_active_7d],
    ['Business Path avg %', d.bp_avg_percent],
    ['Ready for promotion', d.bp_ready],
    ['Near promotion', d.bp_near],
    ['Pending manual approvals', d.bp_pending_approvals],
    ['Promotions this period', d.promotions_in_period],
    ['Income logged this period', d.income_period],
    ['Income earners', d.income_earners],
    ['Prospects added', d.prospects_added],
    ['Overdue follow-ups', d.followups_overdue],
    ['Assignments awaiting review', d.assignments_pending_review],
    ['Not started onboarding', d.onboarding_not_started],
    ['Inactive 7+ days', d.inactive_7d],
    [],
    ['Rank', 'Members'],
    ...d.rank_distribution.map((r) => [r.name, r.count] as (string | number)[]),
  ]
  download(`office-overview_${stamp(range)}.csv`, toCsv(rows))
}

export function exportBusinessPathCsv(d: BusinessPathReport, range: ResolvedRange) {
  const rows: (string | number)[][] = [
    ['Member', 'Rank', 'Requirements done', 'Requirements total', 'Percent'],
    ...d.members.map((m) => [m.name, m.rank ?? '', m.required_done, m.required_total, m.percent]),
    [],
    ['Promotions this period', ''],
    ['Member', 'To rank', 'When', 'Automatic'],
    ...d.promotions.map((p) => [p.name, p.rank ?? '', new Date(p.achieved_at).toISOString(), p.automatic ? 'yes' : 'no']),
  ]
  download(`business-path_${stamp(range)}.csv`, toCsv(rows))
}

export function exportLearningCsv(d: LearningReport, range: ResolvedRange) {
  const rows: (string | number)[][] = [
    ['Area', 'Published modules', 'Participants', 'Module completions'],
    ...d.areas.map((a) => [AREA_LABELS[a.area] ?? a.area, a.modules_total, a.participants, a.modules_done]),
    [],
    ['Onboarding', ''],
    ['Completed members', d.onboarding.completed_members],
    ['In progress', d.onboarding.in_progress_members],
    ['Not started', d.onboarding.not_started_members],
    [],
    ['Exam', 'Attempts', 'Passed', 'Pass rate %', 'Avg score'],
    ...d.assessments.per_exam.map((e) => [e.title, e.attempts, e.passed, e.pass_rate, e.avg_score ?? '']),
  ]
  download(`learning_${stamp(range)}.csv`, toCsv(rows))
}

export function exportNetworkCsv(d: NetworkReport, range: ResolvedRange) {
  const rows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Total contacts', d.contacts_total],
    ['Prospects added this period', d.prospects_added],
    ['Activities logged this period', d.activities_logged],
    ['Follow-ups scheduled', d.followups_scheduled],
    ['Follow-ups overdue', d.followups_overdue],
    ['Prospects without follow-up', d.no_followup],
    ['Members joined via sponsor this period', d.members_joined_via_sponsor],
    [],
    ['Stage', 'Count'],
    ...Object.entries(d.by_stage).map(([k, v]) => [k, v] as (string | number)[]),
    [],
    ['Top builder', 'Direct members'],
    ...d.top_builders.map((b) => [b.name, b.directs] as (string | number)[]),
  ]
  download(`network_${stamp(range)}.csv`, toCsv(rows))
}

export function exportTeamsCsv(d: TeamsReport, range: ResolvedRange) {
  const rows: (string | number)[][] = [
    ['Team', 'Leader', 'Members', 'Business Path avg %', 'Network growth', 'Income logged'],
    ...d.map((t) => [t.name, t.leader ?? '', t.members, t.bp_avg, t.network_growth, t.income]),
  ]
  download(`teams_${stamp(range)}.csv`, toCsv(rows))
}

export function exportIncomeCsv(d: IncomeReport, range: ResolvedRange) {
  const rows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Total this period', d.total_period],
    ['Total all time', d.total_all],
    ['Entries this period', d.entries_period],
    ['Earners this period', d.earners_period],
    [],
    ['Source', 'Amount'],
    ...d.by_source.map((s) => [s.source, s.amount] as (string | number)[]),
    [],
    ['Member', 'Amount'],
    ...d.per_member.map((m) => [m.name, m.amount] as (string | number)[]),
  ]
  download(`income_${stamp(range)}.csv`, toCsv(rows))
}
