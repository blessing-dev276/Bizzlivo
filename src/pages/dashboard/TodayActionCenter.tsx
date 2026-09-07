import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATEGORY_LABEL, loadActions, type Action } from '../../lib/actionCenter'
import type { PathState } from '../../lib/businessPath'

// The member dashboard's "what should I do today?" panel. One prioritized
// list built from every source system (Business Path, Goals, Network,
// Finance) — see src/lib/actionCenter.ts.
export default function TodayActionCenter({
  orgId,
  userId,
  path,
}: {
  orgId: string
  userId: string
  path: PathState | null
}) {
  const navigate = useNavigate()
  const [actions, setActions] = useState<Action[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadActions(orgId, userId, path)
      .then((a) => {
        if (!cancelled) setActions(a)
      })
      .catch(() => {
        if (!cancelled) setActions([])
      })
    return () => {
      cancelled = true
    }
  }, [orgId, userId, path])

  if (actions === null) {
    return (
      <section className="dash-card ac-card">
        <div className="dash-card-head"><h2>Today's focus</h2></div>
        <div className="ac-sk" />
        <div className="ac-sk" />
      </section>
    )
  }

  if (actions.length === 0) {
    return (
      <section className="dash-card ac-card">
        <div className="dash-card-head"><h2>Today's focus</h2></div>
        <p className="md-muted ac-clear">✓ You're all caught up — nothing needs you right now.</p>
      </section>
    )
  }

  const critical = actions.filter((a) => a.priority === 'critical').length
  const shown = showAll ? actions : actions.slice(0, 5)

  return (
    <section className="dash-card ac-card">
      <div className="dash-card-head">
        <h2>Today's focus</h2>
        <span className="ac-count">
          {actions.length} thing{actions.length > 1 ? 's' : ''}
          {critical > 0 && <span className="ac-count-crit"> · {critical} urgent</span>}
        </span>
      </div>

      <ul className="ac-list">
        {shown.map((a) => (
          <li key={a.id} className={`ac-item ${a.priority}`}>
            <span className={`ac-dot ${a.priority}`} aria-hidden />
            <span className="ac-body">
              <span className="ac-title">{a.title}</span>
              <span className="ac-meta">
                {CATEGORY_LABEL[a.category]}
                {a.description ? ` · ${a.description}` : ''}
              </span>
            </span>
            <button type="button" className="ac-cta" onClick={() => navigate(a.ctaRoute)}>
              {a.ctaLabel} →
            </button>
          </li>
        ))}
      </ul>

      {actions.length > 5 && (
        <button type="button" className="ac-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show less' : `+${actions.length - 5} more`}
        </button>
      )}
    </section>
  )
}
