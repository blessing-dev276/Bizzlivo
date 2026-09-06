import { Link } from 'react-router-dom'
import type { OfficeSnapshot } from './useOfficeSnapshot'
import { Skeleton } from './dashboardShared'

export default function TrainingProgress({ data, loading }: { data: OfficeSnapshot | null; loading: boolean }) {
  return (
    <section className="dash-card col-4">
      <div className="dash-card-head">
        <h2>Training Progress</h2>
      </div>

      {loading || !data ? (
        <>
          <Skeleton w="100%" h={8} style={{ marginBottom: 16 }} />
          <Skeleton w="80%" h={38} />
        </>
      ) : (
        (() => {
          const pct =
            data.assignmentTotal > 0
              ? Math.min(100, Math.round((data.assignmentCompleted / data.assignmentTotal) * 100))
              : null
          const remaining = pct !== null ? 100 - pct : 0
          return (
            <>
              {pct !== null ? (
                <>
                  <div className="tp-bar" aria-hidden>
                    <i style={{ width: `${pct}%`, background: 'var(--tint-learn)' }} />
                    <i style={{ width: `${remaining}%`, background: 'transparent' }} />
                  </div>
                  <p className="md-muted" style={{ marginTop: -6, marginBottom: 14 }}>
                    <strong style={{ color: 'var(--text)' }}>{pct}%</strong> of assigned quizzes completed
                    <span style={{ color: 'var(--text-faint)' }}> · {data.assignmentCompleted}/{data.assignmentTotal}</span>
                  </p>
                </>
              ) : (
                <p className="md-muted" style={{ marginBottom: 14 }}>No quizzes assigned yet.</p>
              )}

              <div className="tp-stats">
                <div className="tp-stat">
                  <span className="v">{data.publishedClasses}</span>
                  <span className="l">Published classes</span>
                </div>
                <div className="tp-stat">
                  <span className="v">{data.classItemsCompleted}</span>
                  <span className="l">Lessons completed{data.classItemsTotal > 0 ? ` / ${data.classItemsTotal}` : ''}</span>
                </div>
                <div className="tp-stat">
                  <span className="v">{data.courseworkApproved}</span>
                  <span className="l">Coursework approved</span>
                </div>
              </div>

              <div className="tp-foot">
                <Link to="/training" className="dash-see-all">View Learning Center →</Link>
              </div>
            </>
          )
        })()
      )}
    </section>
  )
}
