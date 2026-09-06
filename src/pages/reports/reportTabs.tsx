import { useCallback, useEffect, useState } from 'react'
import type { ResolvedRange } from '../../lib/reports/range'
import { reportsApi } from '../../lib/reports/api'
import type {
  BusinessPathReport,
  GoalsReport,
  IncomeReport,
  LearningReport,
  MemberReport,
  NetworkReport,
  TeamsReport,
} from '../../lib/reports/types'
import { AREA_LABELS } from '../../lib/reports/types'
import { BarList, EmptyState, MetricCard, ReportSection, SectionError, naira, pct } from './reportShared'
import { moneyList as finMoney } from '../../lib/finance'
import {
  exportBusinessPathCsv,
  exportIncomeCsv,
  exportLearningCsv,
  exportNetworkCsv,
  exportTeamsCsv,
} from './reportExport'

export interface ReportFilters {
  range: ResolvedRange
  teamId: string
  memberId: string
  rankName: string
  teamMemberIds: Set<string> | null
}

function useReport<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState<string>('')
  const run = useCallback(() => {
    setState('loading')
    loader()
      .then((d) => {
        setData(d)
        setState('ok')
      })
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : String(e))
        setState('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(run, [run])
  return { data, state, retry: run, loading: state === 'loading', errMsg }
}

function matchMember(filters: ReportFilters, userId: string, rank?: string | null): boolean {
  if (filters.memberId && filters.memberId !== userId) return false
  if (filters.teamMemberIds && !filters.teamMemberIds.has(userId)) return false
  if (filters.rankName && rank !== filters.rankName) return false
  return true
}

// ============================================================
// Business Path
// ============================================================
export function BusinessPathTab({ orgId, filters }: { orgId: string; filters: ReportFilters }) {
  const { data, state, retry, loading, errMsg } = useReport<BusinessPathReport>(
    () => reportsApi.businessPath(orgId, filters.range),
    [orgId, filters.range],
  )
  const [openMember, setOpenMember] = useState<string | null>(null)

  if (state === 'error') return <SectionError onRetry={retry} message={errMsg} />
  const d = data
  const members = (d?.members ?? []).filter((m) => matchMember(filters, m.user_id, m.rank))
  const ready = (d?.ready ?? []).filter((m) => matchMember(filters, m.user_id, m.rank))
  const near = (d?.near ?? []).filter((m) => matchMember(filters, m.user_id, m.rank))
  const stalled = (d?.stalled ?? []).filter((m) => matchMember(filters, m.user_id, m.rank))

  const rankDist = new Map<string, number>()
  for (const m of members) rankDist.set(m.rank ?? 'Unranked', (rankDist.get(m.rank ?? 'Unranked') ?? 0) + 1)
  const avg = members.length
    ? Math.round(members.reduce((s, m) => s + m.percent, 0) / members.length)
    : 0

  return (
    <>
      <ReportSection
        title="Business Path Performance"
        action={d && <button type="button" className="rp-btn ghost sm" onClick={() => exportBusinessPathCsv(d, filters.range)}>Export CSV</button>}
      >
        <div className="rp-metrics">
          <MetricCard label="Members Tracked" loading={loading} value={members.length} />
          <MetricCard label="Average Progress" loading={loading} value={pct(avg)} />
          <MetricCard label="Ready for Promotion" loading={loading} value={ready.length} />
          <MetricCard label="Near Promotion (≥75%)" loading={loading} value={near.length} />
          <MetricCard label="Stalled (<34%)" loading={loading} value={stalled.length} higherIsBetter={false} />
          <MetricCard label="Promotions this period" loading={loading} value={d?.promotions.length ?? '—'} />
        </div>
      </ReportSection>

      <ReportSection title="Rank Distribution">
        {loading ? <div className="rp-sk rp-sk-block" /> : rankDist.size === 0 ? (
          <EmptyState text="No members on the Business Path yet." />
        ) : (
          <BarList rows={[...rankDist].map(([label, value]) => ({ label, value }))} />
        )}
      </ReportSection>

      <ReportSection title="Promotion Pipeline">
        {loading ? (
          <div className="rp-sk rp-sk-block" />
        ) : (
          <div className="rp-pipeline">
            <div>
              <h4>Ready for promotion · {ready.length}</h4>
              {ready.length === 0 ? <p className="rp-muted">Nobody yet.</p> : ready.map((m) => (
                <button key={m.user_id} className="rp-pl-row" onClick={() => setOpenMember(m.user_id)}>
                  <strong>{m.name}</strong><span>{m.rank ?? '—'} · 100%</span>
                </button>
              ))}
            </div>
            <div>
              <h4>Near promotion · {near.length}</h4>
              {near.length === 0 ? <p className="rp-muted">Nobody yet.</p> : near.map((m) => (
                <button key={m.user_id} className="rp-pl-row" onClick={() => setOpenMember(m.user_id)}>
                  <strong>{m.name}</strong><span>{m.percent}%</span>
                </button>
              ))}
            </div>
            <div>
              <h4>Pending approval · {d?.pending_approvals.length ?? 0}</h4>
              {(d?.pending_approvals ?? []).length === 0 ? <p className="rp-muted">Nothing waiting.</p> : d?.pending_approvals.map((p, i) => (
                <button key={i} className="rp-pl-row" onClick={() => setOpenMember(p.user_id)}>
                  <strong>{p.name}</strong><span>{p.item}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </ReportSection>

      <ReportSection title="Members">
        {loading ? <div className="rp-sk rp-sk-block" /> : members.length === 0 ? (
          <EmptyState text="No members match the current filters." />
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>Member</th><th>Rank</th><th>Progress</th><th>Requirements</th><th /></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.name}</td>
                    <td className="rp-dim">{m.rank ?? '—'}</td>
                    <td>
                      <span className="rp-inline-bar"><span style={{ width: `${m.percent}%` }} /></span> {m.percent}%
                    </td>
                    <td className="rp-dim">{m.required_done}/{m.required_total}</td>
                    <td><button className="rp-btn ghost sm" onClick={() => setOpenMember(m.user_id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {d && (d.promotions.length > 0) && (
        <ReportSection title="Promotion History (this period)">
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>Member</th><th>To rank</th><th>When</th><th>Type</th></tr></thead>
              <tbody>
                {d.promotions.filter((p) => matchMember(filters, p.user_id, p.rank)).map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td className="rp-dim">{p.rank ?? '—'}</td>
                    <td className="rp-dim">{new Date(p.achieved_at).toLocaleDateString()}</td>
                    <td>{p.automatic ? 'Automatic' : 'Approved'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReportSection>
      )}

      {openMember && <MemberDrawer orgId={orgId} userId={openMember} onClose={() => setOpenMember(null)} />}
    </>
  )
}

// ============================================================
// Learning
// ============================================================
export function LearningTab({ orgId, filters }: { orgId: string; filters: ReportFilters }) {
  const { data, state, retry, loading, errMsg } = useReport<LearningReport>(
    () => reportsApi.learning(orgId, filters.range),
    [orgId, filters.range],
  )
  if (state === 'error') return <SectionError onRetry={retry} message={errMsg} />
  const d = data
  const passRate = d && d.assessments.attempts > 0 ? Math.round((d.assessments.passed / d.assessments.attempts) * 100) : null

  return (
    <>
      <ReportSection
        title="Learning & Development"
        action={d && <button type="button" className="rp-btn ghost sm" onClick={() => exportLearningCsv(d, filters.range)}>Export CSV</button>}
      >
        <div className="rp-metrics">
          <MetricCard label="Exam Attempts" loading={loading} value={d?.assessments.attempts ?? '—'} />
          <MetricCard label="Exam Pass Rate" loading={loading} value={passRate == null ? '—' : `${passRate}%`} />
          <MetricCard label="Avg Score" loading={loading} value={d?.assessments.avg_score == null ? '—' : `${d.assessments.avg_score}%`} />
          <MetricCard label="Assignments Submitted" loading={loading} value={d?.assessments.assignments_submitted ?? '—'} />
          <MetricCard label="Assignments Pending" loading={loading} value={d?.assessments.assignments_pending ?? '—'} higherIsBetter={false} />
          <MetricCard label="No Learning Activity" loading={loading} value={d?.no_activity_members ?? '—'} higherIsBetter={false} />
        </div>
      </ReportSection>

      <ReportSection title="Area Completion">
        {loading ? <div className="rp-sk rp-sk-block" /> : (d?.areas.length ?? 0) === 0 ? (
          <EmptyState text="No published Learning Center modules yet." />
        ) : (
          <BarList
            rows={(d?.areas ?? []).map((a) => ({
              label: `${AREA_LABELS[a.area] ?? a.area} (${a.participants} learning)`,
              value: a.modules_total > 0 ? Math.round((a.modules_done / Math.max(1, a.modules_total * (a.participants || 1))) * 100) : 0,
            }))}
            max={100}
            fmt={(v) => `${v}%`}
          />
        )}
        <p className="rp-note">Area % = completed member·modules ÷ (published modules × participating members).</p>
      </ReportSection>

      <ReportSection title="Onboarding">
        {loading ? <div className="rp-sk rp-sk-block" /> : !d ? null : d.onboarding.items_total === 0 ? (
          <EmptyState text="No onboarding steps configured." />
        ) : (
          <div className="rp-metrics">
            <MetricCard label="Completed" value={d.onboarding.completed_members} />
            <MetricCard label="In Progress" value={d.onboarding.in_progress_members} />
            <MetricCard label="Not Started" value={d.onboarding.not_started_members} higherIsBetter={false} />
          </div>
        )}
      </ReportSection>

      <ReportSection title="Assessments by Exam">
        {loading ? <div className="rp-sk rp-sk-block" /> : (d?.assessments.per_exam.length ?? 0) === 0 ? (
          <EmptyState text="No submitted exam attempts in this period." />
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>Exam</th><th>Attempts</th><th>Passed</th><th>Pass rate</th><th>Avg score</th></tr></thead>
              <tbody>
                {d?.assessments.per_exam.map((e) => (
                  <tr key={e.exam_id}>
                    <td>{e.title}</td>
                    <td className="rp-dim">{e.attempts}</td>
                    <td className="rp-dim">{e.passed}</td>
                    <td>{e.pass_rate}%</td>
                    <td className="rp-dim">{e.avg_score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>
    </>
  )
}

// ============================================================
// Network
// ============================================================
const STAGE_LABEL: Record<string, string> = {
  prospect: 'New', invited: 'Contacted', presented: 'Presented', followed_up: 'Follow-up',
  won_customer: 'Customers', won_distributor: 'Distributors', lost: 'Not Interested',
}

export function NetworkTab({ orgId, filters }: { orgId: string; filters: ReportFilters }) {
  const { data, state, retry, loading, errMsg } = useReport<NetworkReport>(
    () => reportsApi.network(orgId, filters.range),
    [orgId, filters.range],
  )
  if (state === 'error') return <SectionError onRetry={retry} message={errMsg} />
  const d = data
  const fr = d && d.followups_scheduled > 0
    ? Math.round(((d.followups_scheduled - d.followups_overdue) / d.followups_scheduled) * 100)
    : null

  return (
    <>
      <ReportSection
        title="Network & Growth"
        action={d && <button type="button" className="rp-btn ghost sm" onClick={() => exportNetworkCsv(d, filters.range)}>Export CSV</button>}
      >
        <div className="rp-metrics">
          <MetricCard label="Total Contacts" loading={loading} value={d?.contacts_total ?? '—'} />
          <MetricCard label="Prospects Added" loading={loading} value={d?.prospects_added ?? '—'} />
          <MetricCard label="Joined via Sponsor" loading={loading} value={d?.members_joined_via_sponsor ?? '—'} />
          <MetricCard label="Customers" loading={loading} value={d?.by_stage.won_customer ?? 0} />
          <MetricCard label="Distributors" loading={loading} value={d?.by_stage.won_distributor ?? 0} />
          <MetricCard label="Follow-up Completion" loading={loading} value={fr == null ? '—' : `${fr}%`} />
          <MetricCard label="Overdue Follow-ups" loading={loading} value={d?.followups_overdue ?? '—'} higherIsBetter={false} />
          <MetricCard label="No Follow-up Set" loading={loading} value={d?.no_followup ?? '—'} higherIsBetter={false} />
        </div>
      </ReportSection>

      <ReportSection title="Prospect Pipeline">
        {loading ? <div className="rp-sk rp-sk-block" /> : !d || Object.keys(d.by_stage).length === 0 ? (
          <EmptyState text="No prospects logged in the office yet." />
        ) : (
          <BarList
            rows={['prospect', 'invited', 'presented', 'followed_up', 'won_customer', 'won_distributor', 'lost']
              .filter((s) => d.by_stage[s])
              .map((s) => ({ label: STAGE_LABEL[s] ?? s, value: d.by_stage[s] }))}
          />
        )}
      </ReportSection>

      <ReportSection title="Top Network Builders">
        {loading ? <div className="rp-sk rp-sk-block" /> : (d?.top_builders.length ?? 0) === 0 ? (
          <EmptyState text="No sponsor relationships recorded yet." />
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>Member</th><th>Direct members</th></tr></thead>
              <tbody>
                {d?.top_builders.map((b) => (
                  <tr key={b.user_id}><td>{b.name}</td><td className="rp-dim">{b.directs}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="rp-note">Direct members = active members whose sponsor is this member (same source as My Network).</p>
      </ReportSection>
    </>
  )
}

// ============================================================
// Teams
// ============================================================
export function TeamsTab({ orgId, filters }: { orgId: string; filters: ReportFilters }) {
  const { data, state, retry, loading, errMsg } = useReport<TeamsReport>(
    () => reportsApi.teams(orgId, filters.range),
    [orgId, filters.range],
  )
  const [sort, setSort] = useState<'name' | 'members' | 'bp_avg' | 'network_growth' | 'income'>('bp_avg')
  if (state === 'error') return <SectionError onRetry={retry} message={errMsg} />
  const d = data ?? []
  const rows = [...d].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] as number) - (a[sort] as number)))

  return (
    <ReportSection
      title="Team Performance"
      action={data && data.length > 0 && <button type="button" className="rp-btn ghost sm" onClick={() => exportTeamsCsv(data, filters.range)}>Export CSV</button>}
    >
      {loading ? (
        <div className="rp-sk rp-sk-block" />
      ) : rows.length === 0 ? (
        <EmptyState text="No teams created yet." />
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th onClick={() => setSort('name')} className="rp-sortable">Team</th>
                <th>Leader</th>
                <th onClick={() => setSort('members')} className="rp-sortable">Members</th>
                <th onClick={() => setSort('bp_avg')} className="rp-sortable">Business Path</th>
                <th onClick={() => setSort('network_growth')} className="rp-sortable">Network growth</th>
                <th onClick={() => setSort('income')} className="rp-sortable">Income</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.team_id}>
                  <td>{t.name}</td>
                  <td className="rp-dim">{t.leader ?? '—'}</td>
                  <td className="rp-dim">{t.members}</td>
                  <td>{pct(t.bp_avg)}</td>
                  <td className="rp-dim">+{t.network_growth}</td>
                  <td className="rp-dim">{naira(t.income)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ============================================================
// Income
// ============================================================
export function IncomeTab({ orgId, filters }: { orgId: string; filters: ReportFilters }) {
  const { data, state, retry, loading, errMsg } = useReport<IncomeReport>(
    () => reportsApi.income(orgId, filters.range),
    [orgId, filters.range],
  )
  const fin = useReport<import('../../lib/reports/api').FinanceOrgOverview>(
    () => reportsApi.finance(orgId, filters.range),
    [orgId, filters.range],
  )
  if (state === 'error') return <SectionError onRetry={retry} message={errMsg} />
  const d = data
  const F = fin.data
  const perMember = (d?.per_member ?? []).filter((m) => matchMember(filters, m.user_id))
  const avg = perMember.length ? Math.round(perMember.reduce((s, m) => s + Number(m.amount), 0) / perMember.length) : 0
  const M = d?.milestones ?? {}

  return (
    <>
      <ReportSection title="Verified Office Earnings (Finance)">
        {fin.state === 'error' ? (
          <EmptyState text={fin.errMsg || 'Finance data unavailable.'} />
        ) : (
          <>
            <div className="rp-metrics">
              <MetricCard label="Orders (period)" loading={fin.loading} value={F?.orders_in_period ?? '—'} />
              <MetricCard label="Gross Orders" loading={fin.loading} value={finMoney(F?.gross_by_currency)} />
              <MetricCard label="Pending Platform Funds" loading={fin.loading} value={finMoney(F?.pending_platform)} />
              <MetricCard label="Available Member Funds" loading={fin.loading} value={finMoney(F?.available_member_funds)} />
              <MetricCard label="Pending Withdrawals" loading={fin.loading} value={F?.needs_attention.withdrawals_awaiting_approval ?? '—'} />
              <MetricCard label="Paid Out (period)" loading={fin.loading} value={finMoney(F?.paid_in_period)} />
            </div>
            <p className="rp-note">Verified, ledger-backed earnings recorded by admins — kept entirely separate from the self-reported personal income below.</p>
          </>
        )}
      </ReportSection>

      <ReportSection
        title="Personal Income (self-reported)"
        action={d && <button type="button" className="rp-btn ghost sm" onClick={() => exportIncomeCsv(d, filters.range)}>Export CSV</button>}
      >
        <div className="rp-metrics">
          <MetricCard label="Income Logged (period)" loading={loading} value={naira(d?.total_period ?? 0)} />
          <MetricCard label="Total Logged (all time)" loading={loading} value={naira(d?.total_all ?? 0)} />
          <MetricCard label="Active Earners" loading={loading} value={d?.earners_period ?? '—'} />
          <MetricCard label="Avg / Earner" loading={loading} value={naira(avg)} />
          <MetricCard label="Reached First Income" loading={loading} value={M.first_income ?? 0} />
          <MetricCard label="Selected a Skill" loading={loading} value={M.selected_skill ?? 0} />
        </div>
        <p className="rp-note">Learning-about-income (milestones) is shown separately from income actually logged in the Wallet ledger — the two are never merged.</p>
      </ReportSection>

      <ReportSection title="Income by Source">
        {loading ? <div className="rp-sk rp-sk-block" /> : (d?.by_source.length ?? 0) === 0 ? (
          <EmptyState text="No income logged in this period." />
        ) : (
          <BarList rows={(d?.by_source ?? []).map((s) => ({ label: s.source, value: Number(s.amount) }))} fmt={naira} />
        )}
      </ReportSection>

      <ReportSection title="Income Development Milestones">
        {loading ? <div className="rp-sk rp-sk-block" /> : (
          <div className="rp-metrics">
            <MetricCard label="Portfolio Built" value={M.portfolio_built ?? 0} />
            <MetricCard label="Freelancing Started" value={M.freelancing_started ?? 0} />
            <MetricCard label="First Income" value={M.first_income ?? 0} />
            <MetricCard label="Consistency" value={M.consistency ?? 0} />
          </div>
        )}
      </ReportSection>

      <ReportSection title="Member Income">
        {loading ? <div className="rp-sk rp-sk-block" /> : perMember.length === 0 ? (
          <EmptyState text="No member income in this period." />
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>Member</th><th>Logged this period</th></tr></thead>
              <tbody>
                {perMember.map((m) => (
                  <tr key={m.user_id}><td>{m.name}</td><td className="rp-dim">{naira(Number(m.amount))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>
    </>
  )
}

// ============================================================
// Member drill-down drawer
// ============================================================
function MemberDrawer({ orgId, userId, onClose }: { orgId: string; userId: string; onClose: () => void }) {
  const { data, state, retry } = useReport<MemberReport>(() => reportsApi.member(orgId, userId), [orgId, userId])
  const d = data

  return (
    <>
      <div className="drawer-overlay open" onClick={onClose} />
      <div className="drawer open">
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        {state === 'error' ? (
          <SectionError onRetry={retry} />
        ) : !d ? (
          <div className="rp-sk rp-sk-block" style={{ marginTop: 40 }} />
        ) : (
          <>
            <div className="drawer-head">
              <div>
                <h3>{d.name}</h3>
                <p>{d.rank ?? 'No rank'} · joined {d.joined_at ? new Date(d.joined_at).toLocaleDateString() : '—'}</p>
              </div>
            </div>
            <div className="drawer-kpis">
              <div className="drawer-kpi"><div className="v">{pct(d.bp_percent)}</div><div className="l">BUSINESS PATH</div></div>
              <div className="drawer-kpi"><div className="v">{d.direct_members}</div><div className="l">DIRECT</div></div>
              <div className="drawer-kpi"><div className="v">{naira(d.income_total)}</div><div className="l">INCOME</div></div>
            </div>
            <div className="rp-drawer-sec">
              <h4>Snapshot</h4>
              <ul className="rp-kv">
                <li><span>Goals</span><strong>{d.goals_done}/{d.goals_total} done</strong></li>
                <li><span>Prospects</span><strong>{d.prospects}</strong></li>
                <li><span>Exams passed</span><strong>{d.exams_passed}</strong></li>
                <li><span>Last activity</span><strong>{d.last_activity ? new Date(d.last_activity).toLocaleDateString() : '—'}</strong></li>
              </ul>
            </div>
            <div className="rp-drawer-sec">
              <h4>Business Path requirements ({d.bp_required_done}/{d.bp_required_total})</h4>
              {d.bp_items.length === 0 ? (
                <p className="rp-muted">No requirements configured for this rank.</p>
              ) : (
                <ul className="rp-checklist">
                  {d.bp_items.map((it, i) => (
                    <li key={i} className={it.complete ? 'done' : ''}>
                      <span>{it.complete ? '✓' : '○'}</span> {it.title}
                      {!it.required && <em> (optional)</em>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

const GOAL_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', active: 'In Progress', submitted: 'Awaiting Review',
  changes_requested: 'Changes Requested', approved: 'Approved', rejected: 'Rejected',
  month_closed_incomplete: 'Closed — Incomplete', cancelled: 'Cancelled', legacy_completed: 'Completed',
}
const GOAL_CAT_LABEL: Record<string, string> = {
  learning: 'Learning', network: 'Network', income: 'Income',
  personal_development: 'Personal Development', business_path: 'Business Path', team: 'Team', other: 'Other',
}

export function GoalsTab({ orgId, filters }: { orgId: string; filters: ReportFilters }) {
  const { data, state, retry, loading, errMsg } = useReport<GoalsReport>(
    () => reportsApi.goals(orgId, filters.range),
    [orgId, filters.range],
  )
  if (state === 'error') return <SectionError onRetry={retry} message={errMsg} />
  const d = data
  const setupRate = d && d.members > 0 ? Math.round((d.members_with_goals / d.members) * 100) : null

  return (
    <>
      <ReportSection title="Goals — This Month">
        <div className="rp-metrics">
          <MetricCard label="Goal Setup Rate" loading={loading} value={setupRate == null ? '—' : `${setupRate}%`}
            sub={d ? `${d.members_with_goals}/${d.members} members` : undefined} />
          <MetricCard label="Missing Goals" loading={loading} value={d?.members_missing ?? '—'} higherIsBetter={false} />
          <MetricCard label="Avg Completion" loading={loading} value={d ? `${d.this_month_avg_percent}%` : '—'} />
          <MetricCard label="Awaiting Review" loading={loading} value={d?.awaiting_review ?? '—'} higherIsBetter={false} />
          <MetricCard label="90-Day Plans" loading={loading} value={d?.quarter_plans ?? '—'} />
          <MetricCard label="Approved (period)" loading={loading} value={d?.approved_in_window ?? '—'} />
          <MetricCard label="Submitted (period)" loading={loading} value={d?.submitted_in_window ?? '—'} />
          <MetricCard label="Rejected (period)" loading={loading} value={d?.rejected_in_window ?? '—'} higherIsBetter={false} />
        </div>
      </ReportSection>

      <ReportSection title="This Month by Status">
        {loading ? <div className="rp-sk rp-sk-block" /> : Object.keys(d?.this_month_status ?? {}).length === 0 ? (
          <EmptyState text="No goals set for the current month yet." />
        ) : (
          <BarList rows={Object.entries(d!.this_month_status).map(([k, v]) => ({ label: GOAL_STATUS_LABEL[k] ?? k, value: v }))} />
        )}
      </ReportSection>

      <ReportSection title="Completion by Category">
        {loading ? <div className="rp-sk rp-sk-block" /> : (d?.by_category.length ?? 0) === 0 ? (
          <EmptyState text="No categorised goals this month." />
        ) : (
          <BarList
            rows={(d?.by_category ?? []).map((c) => ({ label: `${GOAL_CAT_LABEL[c.category] ?? c.category} (${c.goals})`, value: c.avg_percent }))}
            max={100}
            fmt={(v) => `${v}%`}
          />
        )}
      </ReportSection>

      <ReportSection title="By Team">
        {loading ? <div className="rp-sk rp-sk-block" /> : (d?.by_team.length ?? 0) === 0 ? (
          <EmptyState text="No teams created yet." />
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>Team</th><th>Members</th><th>Set goals</th><th>Approved</th></tr></thead>
              <tbody>
                {d?.by_team.map((t) => (
                  <tr key={t.team}>
                    <td>{t.team}</td>
                    <td className="rp-dim">{t.members}</td>
                    <td className="rp-dim">{t.with_goals}</td>
                    <td className="rp-dim">{t.approved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="rp-note">"This month" figures reflect the current calendar month, not the selected date range; period figures (created / submitted / approved / rejected) respect the range.</p>
      </ReportSection>
    </>
  )
}
