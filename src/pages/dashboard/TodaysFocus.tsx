import { useNavigate } from 'react-router-dom'
import type { OfficeSnapshot } from './useOfficeSnapshot'
import { Skeleton } from './dashboardShared'
import { IcArrowRight, IcCheck } from './icons'

interface FocusItem {
  key: string
  text: string
  count?: number
  to: string
  tint: string
  tintSoft: string
}

function buildFocus(d: OfficeSnapshot): FocusItem[] {
  const items: FocusItem[] = []
  const attn = ['var(--tint-attn)', 'var(--tint-attn-soft)'] as const
  const primary = ['var(--tint-primary)', 'var(--tint-primary-soft)'] as const
  const events = ['var(--tint-events)', 'var(--tint-events-soft)'] as const
  const learn = ['var(--tint-learn)', 'var(--tint-learn-soft)'] as const

  if (d.pendingMembers > 0)
    items.push({ key: 'pending', text: `Review ${d.pendingMembers} member join request${d.pendingMembers === 1 ? '' : 's'}`, count: d.pendingMembers, to: '/invites', tint: attn[0], tintSoft: attn[1] })
  if (d.courseworkPending > 0)
    items.push({ key: 'cw', text: `Review ${d.courseworkPending} assignment submission${d.courseworkPending === 1 ? '' : 's'}`, count: d.courseworkPending, to: '/assignments', tint: primary[0], tintSoft: primary[1] })
  if (d.questionsPending > 0)
    items.push({ key: 'q', text: `Approve ${d.questionsPending} quiz question${d.questionsPending === 1 ? '' : 's'} in review`, count: d.questionsPending, to: '/quizzes', tint: primary[0], tintSoft: primary[1] })
  if (d.eventsToday > 0)
    items.push({ key: 'ev', text: `${d.eventsToday} event${d.eventsToday === 1 ? '' : 's'} happening today`, count: d.eventsToday, to: '/events', tint: events[0], tintSoft: events[1] })
  if (d.draftExams > 0)
    items.push({ key: 'draft', text: `Finish ${d.draftExams} draft quiz${d.draftExams === 1 ? '' : 's'}`, count: d.draftExams, to: '/quizzes', tint: events[0], tintSoft: events[1] })

  const inactive = Math.max(0, d.totalMembers - d.activeThisWeek)
  if (d.totalMembers >= 4 && inactive > 0)
    items.push({ key: 'inactive', text: `Follow up with ${inactive} member${inactive === 1 ? '' : 's'} inactive this week`, count: inactive, to: '/invites', tint: attn[0], tintSoft: attn[1] })

  if (d.resourceCount === 0)
    items.push({ key: 'setup-res', text: 'Upload your first training resource', to: '/quizzes', tint: learn[0], tintSoft: learn[1] })
  else if (d.publishedExams === 0)
    items.push({ key: 'setup-exam', text: 'Publish your first quiz', to: '/quizzes', tint: learn[0], tintSoft: learn[1] })

  return items.slice(0, 6)
}

export default function TodaysFocus({ data, loading }: { data: OfficeSnapshot | null; loading: boolean }) {
  const navigate = useNavigate()

  return (
    <section className="dash-card col-7">
      <div className="dash-card-head">
        <h2>Today's Focus</h2>
      </div>

      {loading || !data ? (
        <div className="focus-list">
          {[0, 1, 2, 3].map((i) => (
            <div className="focus-row" key={i} style={{ cursor: 'default' }}>
              <Skeleton w={18} h={18} style={{ borderRadius: 999 }} />
              <Skeleton w={`${60 - i * 6}%`} h={13} />
            </div>
          ))}
        </div>
      ) : (
        (() => {
          const items = buildFocus(data)
          if (items.length === 0) {
            return (
              <div className="focus-empty">
                <span className="fe-ico"><IcCheck /></span>
                <p>You're all caught up — nothing needs you right now.</p>
              </div>
            )
          }
          return (
            <div className="focus-list">
              {items.map((it) => (
                <button
                  type="button"
                  className="focus-row"
                  key={it.key}
                  onClick={() => navigate(it.to)}
                  style={{ ['--_t' as string]: it.tint, ['--_ts' as string]: it.tintSoft }}
                >
                  <span className="focus-mark" />
                  <span className="focus-text">{it.text}</span>
                  {it.count != null && <span className="focus-count">{it.count}</span>}
                  <IcArrowRight className="focus-arrow" />
                </button>
              ))}
            </div>
          )
        })()
      )}
    </section>
  )
}
