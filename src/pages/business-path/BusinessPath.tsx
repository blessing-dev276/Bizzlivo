import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import {
  ITEM_KIND_LABEL,
  SELF_CONFIRM_KINDS,
  loadPathState,
  promoteMember,
  selfConfirmItem,
  submitForApproval,
  unconfirmItem,
  type PathItemState,
  type PathRankState,
  type PathState,
} from '../../lib/businessPath'

const RING = 2 * Math.PI * 34

function Ring({ percent }: { percent: number }) {
  return (
    <div className="bp-ring">
      <svg viewBox="0 0 80 80">
        <circle className="trk" cx="40" cy="40" r="34" />
        <circle className="prg" cx="40" cy="40" r="34" strokeDasharray={RING} strokeDashoffset={RING * (1 - percent / 100)} />
      </svg>
      <span className="bp-ring-num">{percent}%</span>
    </div>
  )
}

function Item({
  state,
  orgId,
  userId,
  onChange,
}: {
  state: PathItemState
  orgId: string
  userId: string
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { item, complete, current, target } = state
  const canSelfConfirm = item.validation_mode !== 'manual' && SELF_CONFIRM_KINDS.has(item.kind)
  const canSubmit = item.validation_mode === 'manual' && item.kind !== 'manual_admin'
    && (state.status === 'not_started' || state.status === 'rejected' || state.status === 'changes_requested')
  const showBar = target > 1 && !complete

  async function toggle() {
    if (!canSelfConfirm || busy) return
    setBusy(true)
    if (complete) await unconfirmItem(userId, item.id)
    else await selfConfirmItem(orgId, userId, item.id)
    setBusy(false)
    onChange()
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    await submitForApproval(orgId, userId, item.id)
    setBusy(false)
    onChange()
  }

  return (
    <div className={`bp-item ${complete ? 'done' : ''}`}>
      <button
        type="button"
        className={`bp-item-mark ${complete ? 'done' : ''} ${canSelfConfirm ? 'is-btn' : ''}`}
        onClick={toggle}
        disabled={!canSelfConfirm || busy}
        aria-label={complete ? 'Mark not done' : 'Mark done'}
      >
        {complete && <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>}
      </button>

      <div className="bp-item-body">
        <div className="bp-item-title">{item.title}</div>
        <div className="bp-item-meta">
          <span>{ITEM_KIND_LABEL[item.kind] ?? item.kind}</span>
          {!item.is_required && <span className="bp-item-optional">Optional</span>}
          {state.status === 'awaiting_approval' && <span>· awaiting approval</span>}
          {state.status === 'changes_requested' && <span>· changes requested</span>}
          {state.status === 'rejected' && <span>· rejected</span>}
          {state.staffOnly && !complete && state.status === 'not_started' && <span>· verified by staff</span>}
        </div>
      </div>

      {showBar && (
        <>
          <span className="bp-mini-bar"><i style={{ width: `${Math.round((current / target) * 100)}%` }} /></span>
          <span className="bp-item-progress">{current}/{target}</span>
        </>
      )}
      {canSubmit && (
        <button type="button" className="bp-item-open" onClick={submit} disabled={busy}>Submit for approval →</button>
      )}
      {!complete && !showBar && !canSubmit && state.href && (
        state.href.startsWith('http') ? (
          <a className="bp-item-open" href={state.href} target="_blank" rel="noreferrer">Open →</a>
        ) : (
          <Link className="bp-item-open" to={state.href}>Open →</Link>
        )
      )}
    </div>
  )
}

function Section({
  title,
  items,
  orgId,
  userId,
  onChange,
}: {
  title: string
  items: PathItemState[]
  orgId: string
  userId: string
  onChange: () => void
}) {
  const done = items.filter((i) => i.complete).length
  return (
    <div className="bp-section">
      <div className="bp-section-head">
        <h3>{title}</h3>
        <span className="bp-count">{done} of {items.length} done</span>
      </div>
      {items.length === 0 ? (
        <div className="bp-empty">Nothing in this section yet.</div>
      ) : (
        items.map((s) => <Item key={s.item.id} state={s} orgId={orgId} userId={userId} onChange={onChange} />)
      )}
    </div>
  )
}

function RailNode({ state, isLast }: { state: PathRankState; isLast: boolean }) {
  const { rank, status } = state
  return (
    <>
      <div className={`bp-node is-${status}`}>
        <span className="bp-node-dot">
          {status === 'done' ? '✓' : status === 'locked' ? (
            <svg className="bp-node-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          ) : (
            rank.order_index + 1
          )}
        </span>
        <span className="bp-node-body">
          <span className="bp-node-name">{rank.name}</span>
          <span className="bp-node-sub">
            {status === 'done'
              ? 'Completed'
              : status === 'current'
                ? `${state.requiredDone}/${state.requiredTotal} done`
                : `${state.learningCount} learning · ${state.taskCount} tasks`}
          </span>
        </span>
      </div>
      {!isLast && <span className={`bp-node-line ${status === 'done' ? 'is-done' : ''}`} />}
    </>
  )
}

export default function BusinessPath() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const userId = profile?.id
  const officeName = currentMembership?.organization.name ?? 'your office'

  const [state, setState] = useState<PathState | null>(null)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState(false)
  const autoTried = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!orgId || !userId) return
    const next = await loadPathState(orgId, userId)
    setState(next)
    setLoading(false)

    // Auto-promotion: current rank fully done + automatic mode + a next
    // rank exists. The RPC re-checks who's allowed; guarded so it fires
    // once per (rank, done-count) situation.
    const cur = next.current
    if (
      next.readyForPromotion &&
      cur &&
      cur.rank.promotion_mode === 'automatic' &&
      next.next &&
      autoTried.current !== cur.rank.id
    ) {
      autoTried.current = cur.rank.id
      setPromoting(true)
      const { error } = await promoteMember(orgId, userId, next.next.id, true)
      setPromoting(false)
      if (!error) {
        const after = await loadPathState(orgId, userId)
        setState(after)
      }
    }
  }, [orgId, userId])

  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload])

  if (loading) {
    return (
      <div className="page bp">
        <div className="bp-head"><h1>Business Path</h1></div>
        <p className="md-muted">Loading your journey…</p>
      </div>
    )
  }

  if (!state || state.ranks.length === 0) {
    return (
      <div className="page bp">
        <div className="bp-head">
          <h1>Business Path</h1>
          <p>Your office hasn't set up its rank journey yet — check back soon.</p>
        </div>
      </div>
    )
  }

  const cur = state.current
  const promoMode = cur?.rank.promotion_mode

  return (
    <div className="page bp">
      <div className="bp-head">
        <h1>Business Path</h1>
        <p>Your journey through {officeName} — where you are, what to learn, and what comes next.</p>
      </div>

      <div className="bp-layout">
        <div className="bp-rail">
          {state.ranks.map((r, i) => (
            <RailNode key={r.rank.id} state={r} isLast={i === state.ranks.length - 1} />
          ))}
        </div>

        <div className="bp-panel">
          {cur ? (
            <>
              <div className="bp-rankcard">
                <Ring percent={cur.percent} />
                <div className="bp-rankcard-body">
                  <span className="bp-rankcard-eyebrow">Current rank</span>
                  <h2>{cur.rank.name}</h2>
                  <p>{cur.rank.description ?? 'Keep working through the requirements below.'}</p>
                  <div className="bp-rankcard-stats">
                    <span>Learning <strong>{cur.learning.filter((i) => i.complete).length}/{cur.learning.length}</strong></span>
                    <span>Tasks <strong>{cur.tasks.filter((i) => i.complete).length}/{cur.tasks.length}</strong></span>
                    <span>Next <strong>{state.next ? state.next.name : 'Top rank'}</strong></span>
                  </div>
                </div>
              </div>

              {state.readyForPromotion && (
                promoting ? (
                  <div className="bp-promote">
                    <div className="bp-promote-ico"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div>
                    <div className="bp-promote-body"><strong>Promoting you…</strong></div>
                  </div>
                ) : !state.next ? (
                  <div className="bp-promote">
                    <div className="bp-promote-ico"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div>
                    <div className="bp-promote-body">
                      <strong>You've reached the top rank. 🎉</strong>
                      <span>Every requirement in {officeName}'s journey is complete.</span>
                    </div>
                  </div>
                ) : promoMode === 'approval' ? (
                  <div className="bp-promote">
                    <div className="bp-promote-ico"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div>
                    <div className="bp-promote-body">
                      <strong>Ready for promotion to {state.next.name}.</strong>
                      <span>Your team leader will move you up.</span>
                    </div>
                  </div>
                ) : null
              )}

              <Section title="LEARNING PATH" items={cur.learning} orgId={orgId!} userId={userId!} onChange={reload} />
              <Section title="BUSINESS TASKS" items={cur.tasks} orgId={orgId!} userId={userId!} onChange={reload} />
            </>
          ) : (
            <div className="bp-section"><div className="bp-empty">You haven't started the journey yet.</div></div>
          )}
        </div>
      </div>
    </div>
  )
}
