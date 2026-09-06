import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type {
  GoalAutoSource,
  GoalCategory,
  GoalPriority,
  GoalType,
  MemberMonthlyGoal,
} from '../../types/database'
import {
  AUDIT_ACTION_LABEL,
  AUTO_SOURCES,
  AUTO_SOURCE_META,
  CATEGORIES,
  CATEGORY_META,
  GOAL_TYPE_META,
  LEARNING_AREAS,
  PRIORITY_META,
  STATUS_META,
  actionsFor,
  createGoal,
  deleteGoal,
  formatValue,
  goalPercent,
  goalRpc,
  loadGoalAudit,
  monthKeyOf,
  monthLabelOf,
  runGoalMaintenance,
  setBinaryDone,
  setProgress,
  updateGoalFields,
  type GoalAuditRow,
} from '../../lib/goals'
import { AREA_LABELS } from '../../lib/reports/types'

type PlanTab = 'monthly' | 'quarter'

export default function MonthlyGoals() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const userId = profile?.id

  const [tab, setTab] = useState<PlanTab>('monthly')
  const [monthOffset, setMonthOffset] = useState(0)

  const viewMonth = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + monthOffset)
    return d
  }, [monthOffset])
  const monthKey = monthKeyOf(viewMonth)
  const monthLabel = monthLabelOf(monthKey)
  const isPast = monthOffset < 0

  const [goals, setGoals] = useState<MemberMonthlyGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editGoal, setEditGoal] = useState<MemberMonthlyGoal | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !userId) return
    setLoading(true)
    const { data, error: e } = await supabase
      .from('member_monthly_goals')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('period_type', tab)
      .eq('month', monthKey)
      .order('created_at', { ascending: true })
    if (e) setError(e.message)
    setGoals((data as MemberMonthlyGoal[]) ?? [])
    setLoading(false)
  }, [orgId, userId, tab, monthKey])

  useEffect(() => {
    if (orgId) runGoalMaintenance(orgId).then(load)
    else load()
  }, [orgId, load])

  const reload = () => load()
  const open = goals.find((g) => g.id === openId) ?? null

  const summary = useMemo(() => {
    const total = goals.length
    const approved = goals.filter((g) => g.status === 'approved' || g.status === 'legacy_completed').length
    const awaiting = goals.filter((g) => g.status === 'submitted').length
    const inProgress = goals.filter((g) => g.status === 'active' || g.status === 'changes_requested').length
    const overall = total ? Math.round(goals.reduce((s, g) => s + goalPercent(g), 0) / total) : 0
    return { total, approved, awaiting, inProgress, notStarted: total - approved - awaiting - inProgress, overall }
  }, [goals])

  const noGoalsThisMonth = tab === 'monthly' && monthOffset === 0 && !loading && goals.length === 0

  return (
    <div className="page gl-page">
      <div className="gl-head">
        <div>
          <h1>My Goals</h1>
          <p>Plan your month, track progress, and submit finished goals for review. Your goals are visible to you and authorized office staff for accountability.</p>
        </div>
        <button type="button" className="gl-btn" onClick={() => { setEditGoal(null); setShowForm(true) }}>+ Add Goal</button>
      </div>

      <div className="gl-planswitch">
        <button className={tab === 'monthly' ? 'active' : ''} onClick={() => { setTab('monthly'); setMonthOffset(0) }}>Monthly</button>
        <button className={tab === 'quarter' ? 'active' : ''} onClick={() => { setTab('quarter'); setMonthOffset(0) }}>90-Day Plan</button>
      </div>

      <div className="gl-periodbar">
        <button type="button" className="gl-nav" onClick={() => setMonthOffset((o) => o - (tab === 'quarter' ? 3 : 1))}>‹</button>
        <div className="gl-period">
          <strong>{tab === 'quarter' ? `${monthLabel} — 90-day plan` : monthLabel}</strong>
          {monthOffset === 0 && <span className="gl-tag blue">Current</span>}
        </div>
        <button
          type="button"
          className="gl-nav"
          disabled={monthOffset >= (tab === 'quarter' ? 6 : 3)}
          onClick={() => setMonthOffset((o) => o + (tab === 'quarter' ? 3 : 1))}
        >›</button>
      </div>

      {noGoalsThisMonth && (
        <div className="gl-banner">
          <div>
            <strong>Plan your {monthLabel.split(' ')[0]}</strong>
            <span>You haven't set any goals for this month yet.</span>
          </div>
          <button type="button" className="gl-btn sm" onClick={() => { setEditGoal(null); setShowForm(true) }}>Set Goals</button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {!loading && goals.length > 0 && (
        <div className="gl-summary">
          <div><span className="gl-sm-v">{summary.total}</span><span className="gl-sm-l">Goals</span></div>
          <div><span className="gl-sm-v">{summary.approved}</span><span className="gl-sm-l">Approved</span></div>
          <div><span className="gl-sm-v">{summary.inProgress}</span><span className="gl-sm-l">In Progress</span></div>
          <div><span className="gl-sm-v">{summary.awaiting}</span><span className="gl-sm-l">Awaiting Review</span></div>
          <div className="gl-sm-overall">
            <span className="gl-sm-l">Overall Progress</span>
            <span className="gl-sm-v">{summary.overall}%</span>
            <span className="gl-sm-bar"><span style={{ width: `${summary.overall}%` }} /></span>
          </div>
        </div>
      )}

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : goals.length === 0 && !noGoalsThisMonth ? (
        <div className="gl-empty">
          <h3>{isPast ? 'No goals for this period' : 'Plan this period'}</h3>
          <p>{isPast ? 'Nothing was set for this period.' : 'Set clear goals and track your progress through the period.'}</p>
          {!isPast && <button type="button" className="gl-btn" onClick={() => { setEditGoal(null); setShowForm(true) }}>Create first goal</button>}
        </div>
      ) : (
        <div className="gl-rows">
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} onOpen={() => setOpenId(g.id)} />
          ))}
        </div>
      )}

      {open && (
        <GoalDrawer
          goal={open}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onClose={() => setOpenId(null)}
          onEdit={() => { setEditGoal(open); setShowForm(true); setOpenId(null) }}
          reload={reload}
        />
      )}

      {showForm && orgId && userId && (
        <GoalFormModal
          orgId={orgId}
          userId={userId}
          month={monthKey}
          periodType={tab}
          existing={editGoal}
          onClose={() => { setShowForm(false); setEditGoal(null) }}
          onSaved={() => { setShowForm(false); setEditGoal(null); reload() }}
        />
      )}
    </div>
  )
}

// ============================================================
function GoalRow({ goal, onOpen }: { goal: MemberMonthlyGoal; onOpen: () => void }) {
  const pctv = goalPercent(goal)
  const cat = goal.category ? CATEGORY_META[goal.category] : null
  const st = STATUS_META[goal.status]
  return (
    <button type="button" className="gl-row" onClick={onOpen}>
      <span className="gl-row-icon" aria-hidden>{cat?.icon ?? '•'}</span>
      <span className="gl-row-main">
        <span className="gl-row-title">
          {goal.priority === 'high' && <span className="gl-pri" title="High priority" />}
          {goal.title}
        </span>
        <span className="gl-row-sub">
          {cat?.label ?? 'Uncategorised'}
          {goal.auto_source && ' · Auto-tracked'}
          {goal.due_date && ` · Due ${new Date(goal.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
        </span>
      </span>
      <span className="gl-row-prog">
        <span className="gl-row-vals">
          {goal.goal_type === 'binary'
            ? (goal.done ? 'Complete' : 'Incomplete')
            : `${formatValue(goal.goal_type, goal.progress_value, goal.unit)} / ${formatValue(goal.goal_type, goal.target_value, goal.unit)}`}
        </span>
        <span className="gl-row-bar"><span style={{ width: `${pctv}%` }} /></span>
      </span>
      <span className={`gl-tag ${st.tone}`}>{st.label}</span>
    </button>
  )
}

// ============================================================
function GoalDrawer({
  goal,
  busy,
  setBusy,
  setError,
  onClose,
  onEdit,
  reload,
}: {
  goal: MemberMonthlyGoal
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onClose: () => void
  onEdit: () => void
  reload: () => void
}) {
  const a = actionsFor(goal)
  const [progressInput, setProgressInput] = useState(String(goal.progress_value ?? 0))
  const [note, setNote] = useState('')
  const [evidence, setEvidence] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [audit, setAudit] = useState<GoalAuditRow[]>([])

  useEffect(() => {
    setProgressInput(String(goal.progress_value ?? 0))
    setShowSubmit(false)
    setNote('')
    setEvidence('')
    loadGoalAudit(goal.id).then(setAudit)
  }, [goal.id, goal.progress_value, goal.status, goal.updated_at])

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }

  const st = STATUS_META[goal.status]
  const cat = goal.category ? CATEGORY_META[goal.category] : null

  return (
    <>
      <div className="drawer-overlay open" onClick={onClose} />
      <div className="drawer open gl-drawer">
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        <div className="drawer-head">
          <div className="drawer-avatar" aria-hidden>{cat?.icon ?? '🎯'}</div>
          <div>
            <h3>{goal.title}</h3>
            <p>{cat?.label ?? 'Uncategorised'} · <span className={`gl-tag ${st.tone}`}>{st.label}</span></p>
          </div>
        </div>

        {goal.description && <p className="gl-drawer-desc">{goal.description}</p>}

        <div className="gl-drawer-sec">
          <h4>Progress</h4>
          {goal.auto_source && (
            <p className="gl-sub-note" style={{ marginBottom: 8 }}>
              ⚡ Tracked automatically — {AUTO_SOURCE_META[goal.auto_source].label}
              {goal.auto_source === 'learning_modules' && goal.auto_area ? ` (${AREA_LABELS[goal.auto_area] ?? goal.auto_area})` : ''}
            </p>
          )}
          {goal.goal_type === 'binary' ? (
            <button
              type="button"
              className={`gl-btn ${goal.done ? 'ghost' : ''} sm`}
              disabled={busy || !a.canUpdateProgress}
              onClick={() => run(() => setBinaryDone(goal, !goal.done))}
            >
              {goal.done ? 'Mark incomplete' : 'Mark complete'}
            </button>
          ) : (
            <>
              <div className="gl-prog-big">
                <span>{formatValue(goal.goal_type, goal.progress_value, goal.unit)}</span>
                <span className="gl-prog-of">of {formatValue(goal.goal_type, goal.target_value, goal.unit)}</span>
                <span className="gl-prog-pct">{goalPercent(goal)}%</span>
              </div>
              <span className="gl-row-bar lg"><span style={{ width: `${goalPercent(goal)}%` }} /></span>
              {a.canUpdateProgress && (
                <div className="gl-prog-edit">
                  <input
                    type="number"
                    min="0"
                    value={progressInput}
                    onChange={(e) => setProgressInput(e.target.value)}
                  />
                  <button type="button" className="gl-btn sm" disabled={busy} onClick={() => run(() => setProgress(goal, Number(progressInput) || 0))}>Save</button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="gl-drawer-sec">
          <h4>Timeline</h4>
          <ul className="gl-timeline">
            <li><span>Created</span><strong>{new Date(goal.created_at).toLocaleDateString()}</strong></li>
            {goal.due_date && <li><span>Due</span><strong>{new Date(goal.due_date).toLocaleDateString()}</strong></li>}
            {goal.submitted_at && <li><span>Submitted</span><strong>{new Date(goal.submitted_at).toLocaleDateString()}</strong></li>}
            {goal.reviewed_at && <li><span>Reviewed</span><strong>{new Date(goal.reviewed_at).toLocaleDateString()}</strong></li>}
            {goal.closed_at && <li><span>Month closed</span><strong>{new Date(goal.closed_at).toLocaleDateString()}</strong></li>}
          </ul>
          {goal.review_note && (
            <p className={`gl-review-note ${goal.status === 'approved' ? 'ok' : 'warn'}`}>
              <strong>Reviewer:</strong> {goal.review_note}
            </p>
          )}
          {goal.submission_note && <p className="gl-sub-note"><strong>Your note:</strong> {goal.submission_note}</p>}
          {goal.evidence_url && (
            <p className="gl-sub-note"><a href={goal.evidence_url} target="_blank" rel="noreferrer">Evidence link ↗</a></p>
          )}
        </div>

        {audit.length > 0 && (
          <div className="gl-drawer-sec">
            <h4>Activity</h4>
            <ul className="gl-timeline">
              {audit.map((e) => (
                <li key={e.id}>
                  <span>{AUDIT_ACTION_LABEL[e.action] ?? e.action.replace('goal.', '')}</span>
                  <strong>{new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="gl-drawer-actions">
          {a.canSubmit && !showSubmit && (
            <button type="button" className="gl-btn" onClick={() => setShowSubmit(true)}>Submit for Review</button>
          )}
          {a.canWithdraw && (
            <button type="button" className="gl-btn ghost" disabled={busy} onClick={() => run(async () => { const r = await goalRpc.withdraw(goal.id); return { error: r.error } })}>Withdraw submission</button>
          )}
          {a.canCarryForward && (
            <button type="button" className="gl-btn ghost" disabled={busy} onClick={() => run(async () => { const r = await goalRpc.carryForward(goal.id); return { error: r.error } })}>Carry to next month</button>
          )}
          {a.canEdit && <button type="button" className="gl-btn ghost" onClick={onEdit}>Edit</button>}
          {a.canDelete && (
            <button type="button" className="gl-btn ghost danger" disabled={busy} onClick={() => { if (confirm(`Delete "${goal.title}"?`)) run(() => deleteGoal(goal.id)).then(onClose) }}>Delete</button>
          )}
        </div>

        {showSubmit && (
          <div className="gl-drawer-sec gl-submit">
            <h4>Completion note</h4>
            <textarea rows={2} placeholder="What did you achieve?" value={note} onChange={(e) => setNote(e.target.value)} />
            <input placeholder="Evidence URL (optional)" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            <div className="gl-drawer-actions">
              <button type="button" className="gl-btn" disabled={busy} onClick={() => run(async () => { const r = await goalRpc.submit(goal.id, note, evidence); return { error: r.error } }).then(onClose)}>Submit</button>
              <button type="button" className="gl-btn ghost" onClick={() => setShowSubmit(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ============================================================
function GoalFormModal({
  orgId,
  userId,
  month,
  periodType,
  existing,
  onClose,
  onSaved,
}: {
  orgId: string
  userId: string
  month: string
  periodType: PlanTab
  existing: MemberMonthlyGoal | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [category, setCategory] = useState<GoalCategory | ''>(existing?.category ?? '')
  const [goalType, setGoalType] = useState<GoalType>(existing?.goal_type ?? 'number')
  const [unit, setUnit] = useState(existing?.unit ?? '')
  const [targetValue, setTargetValue] = useState(existing?.target_value != null ? String(existing.target_value) : '')
  const [priority, setPriority] = useState<GoalPriority>(existing?.priority ?? 'normal')
  const [dueDate, setDueDate] = useState(existing?.due_date ?? '')
  const [autoSource, setAutoSource] = useState<GoalAutoSource | ''>(existing?.auto_source ?? '')
  const [autoArea, setAutoArea] = useState(existing?.auto_area ?? 'network_marketing')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const effectiveType: GoalType = autoSource ? AUTO_SOURCE_META[autoSource].goalType : goalType

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setErr(null)
    const tv = effectiveType === 'binary' ? null : (targetValue ? Number(targetValue) : null)
    const src = autoSource || null
    const area = src === 'learning_modules' ? autoArea : null
    let error: { message: string } | null = null
    if (existing) {
      const r = await updateGoalFields(existing.id, {
        title: title.trim(),
        description: description.trim() || null,
        category: category || null,
        goal_type: effectiveType,
        unit: unit.trim() || null,
        metric: unit.trim() || null,
        target_value: tv,
        target: tv != null ? Math.round(tv) : null,
        priority,
        due_date: dueDate || null,
        progress_mode: src ? 'auto' : 'manual',
        auto_source: src,
        auto_area: area,
      })
      error = r.error
    } else {
      const r = await createGoal(orgId, userId, {
        title, description, category: category || null, goal_type: effectiveType, unit,
        target_value: tv, priority, due_date: dueDate || null,
        period_type: periodType, month,
        auto_source: src, auto_area: area,
      })
      error = r.error
    }
    setBusy(false)
    if (error) setErr(error.message)
    else onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gl-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={save}>
          <h2>{existing ? 'Edit goal' : `New ${periodType === 'quarter' ? '90-day' : 'monthly'} goal`}</h2>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="e.g. Invite 20 new prospects" /></label>
          <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="gl-form-row">
            <label>Category
              <select value={category} onChange={(e) => setCategory(e.target.value as GoalCategory | '')}>
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
              </select>
            </label>
            <label>Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as GoalPriority)}>
                {(Object.keys(PRIORITY_META) as GoalPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </label>
          </div>
          <label>Track progress
            <select value={autoSource} onChange={(e) => setAutoSource(e.target.value as GoalAutoSource | '')}>
              <option value="">Manually — I'll update it</option>
              {AUTO_SOURCES.map((s) => <option key={s} value={s}>Automatically — {AUTO_SOURCE_META[s].label}</option>)}
            </select>
          </label>
          {autoSource === 'learning_modules' && (
            <label>Learning area
              <select value={autoArea} onChange={(e) => setAutoArea(e.target.value)}>
                {LEARNING_AREAS.map((ar) => <option key={ar} value={ar}>{AREA_LABELS[ar] ?? ar}</option>)}
              </select>
            </label>
          )}
          <div className="gl-form-row">
            {!autoSource && (
              <label>Type
                <select value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)}>
                  {(Object.keys(GOAL_TYPE_META) as GoalType[]).map((t) => <option key={t} value={t}>{GOAL_TYPE_META[t].label}</option>)}
                </select>
              </label>
            )}
            {effectiveType !== 'binary' && (
              <label>Target
                <input type="number" min="0" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required />
              </label>
            )}
            {effectiveType === 'number' && !autoSource && (
              <label>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="prospects" /></label>
            )}
          </div>
          <label>Due date (optional)<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          {err && <p className="form-error">{err}</p>}
          <div className="gl-drawer-actions" style={{ marginTop: 12 }}>
            <button type="submit" className="gl-btn" disabled={busy || !title.trim()}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Add goal'}</button>
            <button type="button" className="gl-btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
