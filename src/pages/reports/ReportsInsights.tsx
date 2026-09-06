import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import { PRESET_LABELS, resolveRange, type RangePreset } from '../../lib/reports/range'
import { reportsApi } from '../../lib/reports/api'
import type { OverviewReport } from '../../lib/reports/types'
import { BarList, EmptyState, MetricCard, ReportSection, SectionError, Sparkline, naira, pct } from './reportShared'
import {
  BusinessPathTab,
  IncomeTab,
  LearningTab,
  NetworkTab,
  TeamsTab,
  type ReportFilters,
} from './reportTabs'
import { exportOverviewCsv } from './reportExport'

type View = 'overview' | 'business-path' | 'learning' | 'network' | 'teams' | 'income'
const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'business-path', label: 'Business Path' },
  { id: 'learning', label: 'Learning' },
  { id: 'network', label: 'Network' },
  { id: 'teams', label: 'Teams' },
  { id: 'income', label: 'Income' },
]
const PRESETS: RangePreset[] = ['today', 'this_week', 'this_month', 'last_month', 'last_30_days', 'last_90_days', 'custom']

interface OptionRow {
  id: string
  name: string
}

export default function ReportsInsights() {
  const { currentMembership } = useAuth()
  const role = currentMembership?.role
  const orgId = currentMembership?.organization.id

  const [params, setParams] = useSearchParams()
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'overview') as View
  const isTrainer = role === 'trainer'

  // ---- filter state ----
  const [preset, setPreset] = useState<RangePreset>('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [teamId, setTeamId] = useState('')
  const [memberId, setMemberId] = useState('')
  const [rankName, setRankName] = useState('')

  const range = useMemo(
    () => resolveRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  )

  const [teams, setTeams] = useState<OptionRow[]>([])
  const [members, setMembers] = useState<OptionRow[]>([])
  const [ranks, setRanks] = useState<string[]>([])
  const [teamMemberIds, setTeamMemberIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!orgId) return
    supabase.from('groups').select('id, name').eq('org_id', orgId).order('name').then(({ data }) => {
      setTeams((data as OptionRow[]) ?? [])
    })
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(full_name)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(({ data }) => {
        const rows = (data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? []
        setMembers(
          rows
            .map((r) => ({ id: r.user_id, name: r.profile?.full_name ?? 'Unknown' }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      })
    supabase
      .from('business_path_ranks')
      .select('name')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('order_index')
      .then(({ data }) => setRanks(((data as { name: string }[]) ?? []).map((r) => r.name)))
  }, [orgId])

  useEffect(() => {
    if (!teamId) {
      setTeamMemberIds(null)
      return
    }
    supabase.from('group_members').select('user_id').eq('group_id', teamId).then(({ data }) => {
      setTeamMemberIds(new Set(((data as { user_id: string }[]) ?? []).map((r) => r.user_id)))
    })
  }, [teamId])

  const setView = (v: View) => {
    params.set('view', v)
    setParams(params, { replace: true })
  }

  const filters: ReportFilters = useMemo(
    () => ({ range, teamId, memberId, rankName, teamMemberIds }),
    [range, teamId, memberId, rankName, teamMemberIds],
  )

  if (role === 'team_leader') return <Navigate to="/team-performance" replace />
  if (role !== 'admin' && role !== 'trainer') return <Navigate to="/" replace />

  const effectiveView: View = isTrainer ? 'learning' : view

  const hasFocus = !!(teamId || memberId || rankName)

  return (
    <div className="page rp-page">
      <div className="rp-head">
        <div>
          <h1>Reports &amp; Insights</h1>
          <p>Office performance, growth, learning, Business Path and business activity — for {range.label.toLowerCase()}.</p>
        </div>
      </div>

      <div className="rp-filters">
        <label className="rp-f">
          <span>Period</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
            {PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
          </select>
        </label>
        {preset === 'custom' && (
          <label className="rp-f">
            <span>Dates</span>
            <span className="rp-f-dates">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </span>
          </label>
        )}
        <label className="rp-f">
          <span>Team</span>
          <select value={teamId} onChange={(e) => { setTeamId(e.target.value); setMemberId('') }}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="rp-f">
          <span>Member</span>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">All members</option>
            {members
              .filter((m) => !teamMemberIds || teamMemberIds.has(m.id))
              .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="rp-f">
          <span>Rank</span>
          <select value={rankName} onChange={(e) => setRankName(e.target.value)}>
            <option value="">All ranks</option>
            {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {hasFocus && (
          <button type="button" className="rp-clear" onClick={() => { setTeamId(''); setMemberId(''); setRankName('') }}>
            Clear focus
          </button>
        )}
      </div>

      {!isTrainer && (
        <div className="rp-tabs" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={effectiveView === v.id}
              className={effectiveView === v.id ? 'active' : ''}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {orgId && effectiveView === 'overview' && <OverviewTab orgId={orgId} filters={filters} onJump={setView} />}
      {orgId && effectiveView === 'business-path' && <BusinessPathTab orgId={orgId} filters={filters} />}
      {orgId && effectiveView === 'learning' && <LearningTab orgId={orgId} filters={filters} />}
      {orgId && effectiveView === 'network' && <NetworkTab orgId={orgId} filters={filters} />}
      {orgId && effectiveView === 'teams' && <TeamsTab orgId={orgId} filters={filters} />}
      {orgId && effectiveView === 'income' && <IncomeTab orgId={orgId} filters={filters} />}
    </div>
  )
}

// ============================================================
// Overview
// ============================================================
function OverviewTab({
  orgId,
  filters,
  onJump,
}: {
  orgId: string
  filters: ReportFilters
  onJump: (v: View) => void
}) {
  const [data, setData] = useState<OverviewReport | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [metric, setMetric] = useState<'members' | 'promotions' | 'income'>('members')

  const load = useCallback(() => {
    setState('loading')
    reportsApi
      .overview(orgId, filters.range)
      .then((d) => {
        setData(d)
        setState('ok')
      })
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : String(e))
        setState('error')
      })
  }, [orgId, filters.range])

  useEffect(load, [load])

  if (state === 'error') return <SectionError onRetry={load} message={errMsg} />
  const loading = state === 'loading'
  const d = data

  const series =
    metric === 'members'
      ? (d?.member_growth ?? []).map((p) => ({ x: new Date(p.date).getTime(), y: p.total ?? 0, label: fmtDay(p.date) }))
      : metric === 'promotions'
        ? (d?.promotions_series ?? []).map((p) => ({ x: new Date(p.date).getTime(), y: p.count ?? 0, label: fmtDay(p.date) }))
        : (d?.income_series ?? []).map((p) => ({ x: new Date(p.date).getTime(), y: p.amount ?? 0, label: fmtDay(p.date) }))

  return (
    <>
      <ReportSection
        title="Executive Overview"
        action={
          d && (
            <button type="button" className="rp-btn ghost sm" onClick={() => exportOverviewCsv(d, filters.range)}>
              Export CSV
            </button>
          )
        }
      >
        <div className="rp-metrics">
          <MetricCard label="Total Members" loading={loading} value={d?.members_total ?? '—'}
            current={d?.members_all} previous={(d?.members_all ?? 0) - (d?.members_new ?? 0)}
            sub={d ? `${d.members_new} new this period` : undefined} />
          <MetricCard label="Active (last 7 days)" loading={loading} value={d?.members_active_7d ?? '—'}
            sub={d && d.members_total ? `${Math.round((d.members_active_7d / d.members_total) * 100)}% of members` : undefined} />
          <MetricCard label="New Members" loading={loading} value={d?.members_new ?? '—'}
            current={d?.members_new} previous={d?.members_new_prev} />
          <MetricCard label="Business Path" loading={loading} value={pct(d?.bp_avg_percent)}
            sub="Average progression" onClick={() => onJump('business-path')} />
          <MetricCard label="Ready for Promotion" loading={loading} value={d?.bp_ready ?? '—'}
            sub={d ? `${d.bp_near} near` : undefined} onClick={() => onJump('business-path')} />
          <MetricCard label="Income Logged" loading={loading} value={naira(d?.income_period ?? 0)}
            current={d?.income_period} previous={d?.income_period_prev}
            sub={d ? `${d.income_earners} earners` : undefined} onClick={() => onJump('income')} />
          <MetricCard label="Prospects Added" loading={loading} value={d?.prospects_added ?? '—'}
            onClick={() => onJump('network')} />
          <MetricCard label="Overdue Follow-ups" loading={loading} value={d?.followups_overdue ?? '—'}
            higherIsBetter={false} onClick={() => onJump('network')} />
        </div>
      </ReportSection>

      <ReportSection
        title="Office Performance"
        action={
          <div className="rp-chart-switch">
            {(['members', 'promotions', 'income'] as const).map((m) => (
              <button key={m} type="button" className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>
                {m === 'members' ? 'Member Growth' : m === 'promotions' ? 'Promotions' : 'Income Logged'}
              </button>
            ))}
          </div>
        }
      >
        {loading ? <div className="rp-sk rp-sk-chart" /> : <Sparkline points={series} />}
        <p className="rp-note">
          Only metrics with real timestamped history are charted here. Learning, network and active-member
          figures show current values with a period-over-period delta rather than a reconstructed line.
        </p>
      </ReportSection>

      <ReportSection title="Business Path Snapshot" action={<JumpLink onClick={() => onJump('business-path')} />}>
        {loading ? (
          <div className="rp-sk rp-sk-block" />
        ) : (d?.rank_distribution?.length ?? 0) === 0 ? (
          <EmptyState text="No Business Path ranks configured yet." />
        ) : (
          <BarList rows={(d?.rank_distribution ?? []).map((r) => ({ label: r.name, value: r.count }))} />
        )}
      </ReportSection>

      <ReportSection title="Needs Attention">
        {loading ? (
          <div className="rp-sk rp-sk-block" />
        ) : (
          <div className="rp-attn">
            <AttnRow n={d?.bp_ready ?? 0} text="members ready for promotion" onClick={() => onJump('business-path')} />
            <AttnRow n={d?.bp_pending_approvals ?? 0} text="manual requirements awaiting approval" onClick={() => onJump('business-path')} />
            <AttnRow n={d?.inactive_7d ?? 0} text="members inactive for 7+ days" tone="bad" onClick={() => onJump('teams')} />
            <AttnRow n={d?.onboarding_not_started ?? 0} text="members have not started onboarding" tone="bad" onClick={() => onJump('learning')} />
            <AttnRow n={d?.followups_overdue ?? 0} text="overdue prospect follow-ups" tone="bad" onClick={() => onJump('network')} />
            <AttnRow n={d?.assignments_pending_review ?? 0} text="assignments awaiting review" onClick={() => onJump('learning')} />
          </div>
        )}
      </ReportSection>
    </>
  )
}

function AttnRow({
  n,
  text,
  tone,
  onClick,
}: {
  n: number
  text: string
  tone?: 'bad'
  onClick: () => void
}) {
  if (n === 0) return null
  return (
    <div className="rp-attn-row">
      <span className={`rp-attn-n${tone ? ' bad' : ''}`}>{n}</span>
      <span className="rp-attn-text">{text}</span>
      <button type="button" className="rp-btn ghost sm" onClick={onClick}>View</button>
    </div>
  )
}

export function JumpLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="rp-jump" onClick={onClick}>
      Open report →
    </button>
  )
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
