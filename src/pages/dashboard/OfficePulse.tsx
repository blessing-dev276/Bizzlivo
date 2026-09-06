import type { OfficeSnapshot } from './useOfficeSnapshot'
import { Skeleton } from './dashboardShared'
import { IcUsers, IcPulse, IcExam, IcBook } from './icons'

interface Card {
  label: string
  value: string
  meta: string
  tint: string
  tintSoft: string
  icon: React.ReactNode
}

export default function OfficePulse({ data, loading }: { data: OfficeSnapshot | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="dash-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div className="pulse-card" key={i}>
            <div className="pulse-top"><Skeleton w={30} h={30} style={{ borderRadius: 9 }} /></div>
            <Skeleton w="55%" h={11} />
            <Skeleton w="40%" h={24} />
            <Skeleton w="65%" h={10} />
          </div>
        ))}
      </div>
    )
  }

  const activePct = data.totalMembers > 0 ? Math.round((data.activeThisWeek / data.totalMembers) * 100) : null
  const completionPct =
    data.assignmentTotal > 0 ? Math.min(100, Math.round((data.assignmentCompleted / data.assignmentTotal) * 100)) : null

  const cards: Card[] = [
    {
      label: 'Total members',
      value: String(data.totalMembers),
      meta: data.newThisMonth > 0 ? `+${data.newThisMonth} joined this month` : 'No new members this month',
      tint: 'var(--tint-people)',
      tintSoft: 'var(--tint-people-soft)',
      icon: <IcUsers />,
    },
    {
      label: 'Active this week',
      value: String(data.activeThisWeek),
      meta: activePct !== null ? `${activePct}% of the office` : 'No members yet',
      tint: 'var(--tint-ok)',
      tintSoft: 'var(--tint-ok-soft)',
      icon: <IcPulse />,
    },
    {
      label: 'Assigned quizzes done',
      value: completionPct !== null ? `${completionPct}%` : '—',
      meta:
        completionPct !== null
          ? `${data.assignmentCompleted} of ${data.assignmentTotal} completed`
          : 'No quizzes assigned yet',
      tint: 'var(--tint-primary)',
      tintSoft: 'var(--tint-primary-soft)',
      icon: <IcExam />,
    },
    {
      label: 'Published quizzes',
      value: String(data.publishedExams),
      meta:
        data.draftExams > 0
          ? `${data.draftExams} in draft`
          : `${data.resourceCount} resource${data.resourceCount === 1 ? '' : 's'}`,
      tint: 'var(--tint-learn)',
      tintSoft: 'var(--tint-learn-soft)',
      icon: <IcBook />,
    },
  ]

  return (
    <div className="dash-pulse">
      {cards.map((c) => (
        <div
          className="pulse-card"
          key={c.label}
          style={{ ['--_t' as string]: c.tint, ['--_ts' as string]: c.tintSoft }}
        >
          <div className="pulse-top">
            <span className="pulse-ico">{c.icon}</span>
          </div>
          <span className="pulse-label">{c.label}</span>
          <span className="pulse-value">{c.value}</span>
          <span className="pulse-meta">{c.meta}</span>
        </div>
      ))}
    </div>
  )
}
