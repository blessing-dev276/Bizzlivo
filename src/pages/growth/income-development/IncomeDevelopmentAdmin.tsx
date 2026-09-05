import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import SkillDevelopmentAdmin from '../skill-development/SkillDevelopmentAdmin'
import type {
  IncomeDevelopmentIncomeEntry,
  IncomeDevelopmentPortfolioItem,
  IncomeDevelopmentProgress,
} from '../../../types/database'

const TABS = ['Skill Catalog', 'Member Progress'] as const
type Tab = (typeof TABS)[number]

interface MemberRow {
  userId: string
  fullName: string
  skillName: string | null
  portfolioReady: boolean
  freelancing: boolean
  firstIncomeAt: string | null
  consistent: boolean
  portfolioCount: number
  totalIncome: number
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

export default function IncomeDevelopmentAdmin() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [tab, setTab] = useState<Tab>('Skill Catalog')

  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(true)

  async function loadMembers(org: string) {
    setMembersLoading(true)
    const [membershipsRes, progressRes, portfolioRes, incomeRes] = await Promise.all([
      supabase.from('memberships').select('user_id, profile:profiles(full_name)').eq('org_id', org).eq('status', 'active'),
      supabase.from('income_development_progress').select('*').eq('org_id', org),
      supabase.from('income_development_portfolio_items').select('user_id').eq('org_id', org),
      supabase.from('income_development_income_entries').select('user_id, amount').eq('org_id', org),
    ])
    const progressByUser = new Map(((progressRes.data as IncomeDevelopmentProgress[]) ?? []).map((p) => [p.user_id, p]))
    const portfolioCountByUser = new Map<string, number>()
    for (const p of (portfolioRes.data as Pick<IncomeDevelopmentPortfolioItem, 'user_id'>[]) ?? []) {
      portfolioCountByUser.set(p.user_id, (portfolioCountByUser.get(p.user_id) ?? 0) + 1)
    }
    const totalIncomeByUser = new Map<string, number>()
    for (const e of (incomeRes.data as Pick<IncomeDevelopmentIncomeEntry, 'user_id' | 'amount'>[]) ?? []) {
      totalIncomeByUser.set(e.user_id, (totalIncomeByUser.get(e.user_id) ?? 0) + Number(e.amount))
    }
    const rows: MemberRow[] = ((membershipsRes.data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? []).map((m) => {
      const p = progressByUser.get(m.user_id)
      return {
        userId: m.user_id,
        fullName: m.profile?.full_name ?? 'Unknown',
        skillName: p?.skill_name ?? null,
        portfolioReady: !!p?.portfolio_built_at,
        freelancing: !!p?.freelancing_started_at,
        firstIncomeAt: p?.first_income_at ?? null,
        consistent: !!p?.consistency_at,
        portfolioCount: portfolioCountByUser.get(m.user_id) ?? 0,
        totalIncome: totalIncomeByUser.get(m.user_id) ?? 0,
      }
    })
    setMembers(rows)
    setMembersLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    loadMembers(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const activeFreelancers = members.filter((m) => m.freelancing).length
  const firstIncomeCount = members.filter((m) => m.firstIncomeAt).length
  const portfolioReadyCount = members.filter((m) => m.portfolioReady).length

  return (
    <div>
      <div className="view-tabs" style={{ marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={`view-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Skill Catalog' ? (
        <SkillDevelopmentAdmin purpose="income_development" />
      ) : (
        <div>
          <div className="upcoming-list" style={{ marginBottom: 20 }}>
            <span className="upcoming-pill">Members tracked<span className="badge active">{members.length}</span></span>
            <span className="upcoming-pill">Active freelancers<span className="badge active">{activeFreelancers}</span></span>
            <span className="upcoming-pill">Portfolio ready<span className="badge active">{portfolioReadyCount}</span></span>
            <span className="upcoming-pill">First income achieved<span className="badge active">{firstIncomeCount}</span></span>
          </div>

          <h4 className="overview-heading">MEMBER PROGRESS</h4>
          {membersLoading ? (
            <p className="empty-row">Loading…</p>
          ) : members.length === 0 ? (
            <p className="empty-row">No members yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Skill</th>
                    <th>Portfolio</th>
                    <th>Freelancing</th>
                    <th>First income</th>
                    <th>Consistent</th>
                    <th>Portfolio items</th>
                    <th>Total earned</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.fullName}</td>
                      <td>{m.skillName ?? '—'}</td>
                      <td>{m.portfolioReady ? 'Ready' : '—'}</td>
                      <td>{m.freelancing ? 'Yes' : '—'}</td>
                      <td>{fmtDate(m.firstIncomeAt)}</td>
                      <td>{m.consistent ? 'Yes' : '—'}</td>
                      <td>{m.portfolioCount}</td>
                      <td>₦{m.totalIncome.toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
