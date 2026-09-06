import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Skeleton } from './dashboardShared'

type Period = 'week' | 'month'
interface PeriodStats {
  newMembers: number
  examsCompleted: number
  eventsHeld: number
  coursework: number
}

async function fetchPeriod(org: string, sinceIso: string, nowIso: string): Promise<PeriodStats> {
  const [members, attempts, events, coursework] = await Promise.all([
    supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').gte('joined_at', sinceIso),
    supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', sinceIso),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('org_id', org).neq('status', 'cancelled').gte('start_at', sinceIso).lte('start_at', nowIso),
    supabase.from('coursework_submissions').select('id', { count: 'exact', head: true }).eq('org_id', org).gte('submitted_at', sinceIso),
  ])
  return {
    newMembers: members.count ?? 0,
    examsCompleted: attempts.count ?? 0,
    eventsHeld: events.count ?? 0,
    coursework: coursework.count ?? 0,
  }
}

export default function OfficeOverview({ orgId }: { orgId: string | undefined }) {
  const [period, setPeriod] = useState<Period>('week')
  const [stats, setStats] = useState<{ week: PeriodStats; month: PeriodStats } | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const nowIso = new Date().toISOString()
    const weekIso = new Date(Date.now() - 7 * 86400000).toISOString()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    Promise.all([fetchPeriod(orgId, weekIso, nowIso), fetchPeriod(orgId, monthStart.toISOString(), nowIso)])
      .then(([week, month]) => {
        if (!cancelled) setStats({ week, month })
      })
      .catch(() => {
        if (!cancelled) setStats({ week: { newMembers: 0, examsCompleted: 0, eventsHeld: 0, coursework: 0 }, month: { newMembers: 0, examsCompleted: 0, eventsHeld: 0, coursework: 0 } })
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const s = stats?.[period]
  const cells: [string, number | undefined][] = [
    ['New members', s?.newMembers],
    ['Quizzes completed', s?.examsCompleted],
    ['Events held', s?.eventsHeld],
    ['Coursework submitted', s?.coursework],
  ]

  return (
    <section className="dash-card col-4">
      <div className="dash-card-head">
        <h2>Office Overview</h2>
        <div className="cycle-toggle">
          <button type="button" className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>This week</button>
          <button type="button" className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>This month</button>
        </div>
      </div>
      <div className="oo-grid">
        {cells.map(([label, value]) => (
          <div className="oo-cell" key={label}>
            {value == null ? <Skeleton w="40%" h={22} /> : <span className="v">{value}</span>}
            <span className="l">{label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
