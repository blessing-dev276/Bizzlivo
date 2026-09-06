import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { LEARNING_AREAS, loadAreaOverview, type AreaOverview } from '../../lib/learningCenter'
import { loadLearningAreaAccess, type LearningAreaAccess } from '../../lib/businessPath'
import type { LearningArea } from '../../types/database'
import MemberArea from './MemberArea'

export default function MemberLearningCenter() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [params] = useSearchParams()
  const areaKey = params.get('area')

  const [overview, setOverview] = useState<AreaOverview[] | null>(null)
  const [access, setAccess] = useState<LearningAreaAccess | null>(null)

  useEffect(() => {
    if (!orgId || !profile) return
    loadLearningAreaAccess(orgId, profile.id).then(setAccess)
  }, [orgId, profile])

  useEffect(() => {
    if (!orgId || !profile || areaKey) return
    loadAreaOverview(orgId, profile.id).then(setOverview)
  }, [orgId, profile, areaKey])

  const isLocked = (key: string) => !!access && !access.unlocked.has(key as LearningArea)

  if (areaKey) {
    if (isLocked(areaKey)) {
      return (
        <div className="page lc">
          <div className="lc-head">
            <Link to="/training" className="dash-see-all">← Learning Center</Link>
            <h1>Locked</h1>
            <p>{access?.lockedReason.get(areaKey as LearningArea) ?? 'This area is not available yet.'}</p>
          </div>
        </div>
      )
    }
    return <MemberArea areaKey={areaKey} />
  }

  const byKey = new Map((overview ?? []).map((o) => [o.key, o]))
  const continueArea = (overview ?? []).find((o) => !isLocked(o.key) && o.moduleTotal > 0 && o.moduleDone < o.moduleTotal && o.moduleDone > 0)
    ?? (overview ?? []).find((o) => !isLocked(o.key) && o.moduleTotal > 0 && o.moduleDone < o.moduleTotal)
  const continueDef = continueArea && LEARNING_AREAS.find((a) => a.key === continueArea.key)

  return (
    <div className="page lc">
      <div className="lc-head">
        <h1>Learning Center</h1>
        <p>Continue learning and develop the skills you need to grow.</p>
      </div>

      {continueArea && continueDef && (
        <Link to={`/training?area=${continueArea.key}`} className="lc-continue" style={{ ['--_t' as string]: continueDef.tint }}>
          <div>
            <span className="lc-continue-label">Continue learning</span>
            <strong>{continueDef.label}</strong>
            <span className="lc-continue-sub">
              {continueArea.moduleDone} of {continueArea.moduleTotal} modules ·{' '}
              {Math.round((continueArea.moduleDone / continueArea.moduleTotal) * 100)}%
            </span>
          </div>
          <span className="lc-continue-cta">Continue →</span>
        </Link>
      )}

      <h4 className="overview-heading" style={{ marginTop: 24 }}>YOUR LEARNING AREAS</h4>
      <div className="lc-area-grid">
        {LEARNING_AREAS.map((a) => {
          const o = byKey.get(a.key)
          const locked = isLocked(a.key)

          if (locked) {
            return (
              <div key={a.key} className="lc-area-card locked" aria-disabled="true">
                <strong>🔒 {a.label}</strong>
                <span className="lc-area-blurb">{a.blurb}</span>
                <span className="lc-area-stat">{access?.lockedReason.get(a.key as LearningArea) ?? 'Locked'}</span>
              </div>
            )
          }

          return (
            <Link key={a.key} to={`/training?area=${a.key}`} className="lc-area-card" style={{ ['--_t' as string]: a.tint }}>
              <strong>{a.label}</strong>
              <span className="lc-area-blurb">{a.blurb}</span>
              <span className="lc-area-stat">
                {!overview
                  ? '…'
                  : o && o.moduleTotal > 0
                    ? `${o.moduleDone} / ${o.moduleTotal} modules`
                    : o?.extra ?? 'Nothing published yet'}
              </span>
              {o && o.moduleTotal > 0 && (
                <span className="lc-area-bar"><i style={{ width: `${Math.round((o.moduleDone / o.moduleTotal) * 100)}%` }} /></span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
