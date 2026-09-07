import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  attentionFrom,
  fl,
  loadFreelance,
  money,
  PLATFORMS,
  PROJECT_OPEN,
  PROJECT_STATUS,
  runFreelanceMaintenance,
  type FreelanceData,
  type FreelanceProject,
  type FreelanceProjectStatus,
} from '../../lib/freelance'

type View = 'overview' | 'projects'
const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects & Orders' },
]

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'
const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export default function FreelanceWorkspace() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const userId = profile?.id

  const [params, setParams] = useSearchParams()
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'overview') as View
  const setView = (v: View) => {
    params.set('view', v)
    setParams(params, { replace: true })
  }

  const [data, setData] = useState<FreelanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !userId) return
    setLoading(true)
    const d = await loadFreelance(orgId, userId)
    setData(d)
    setLoading(false)
    // Only the project-side follow-ups matter here now.
    const a = attentionFrom(d)
    runFreelanceMaintenance(orgId, userId, { ...a, prospectFollowupsDue: 0, proposalsOut: 0 })
  }, [orgId, userId])

  useEffect(() => {
    load()
  }, [load])

  if (!orgId || !userId || loading || !data) {
    return <div className="page"><h1>Freelance</h1><p className="empty-row">Loading…</p></div>
  }

  const reload = () => load()

  return (
    <div className="page fw-page">
      <div className="fw-head">
        <div>
          <h1>Freelance</h1>
          <p>Track your freelancing work — every project or order through Active, Pending, Completed and Cancelled.</p>
        </div>
      </div>

      <div className="rp-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
            className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {view === 'overview' && <OverviewTab data={data} onJump={setView} />}
      {view === 'projects' && <ProjectsTab orgId={orgId} userId={userId} data={data} reload={reload} setError={setError} />}
    </div>
  )
}

// ============================================================
function OverviewTab({ data, onJump }: { data: FreelanceData; onJump: (v: View) => void }) {
  const a = attentionFrom(data)
  const count = (s: FreelanceProjectStatus) => data.projects.filter((p) => p.status === s).length
  const thisMonth = new Date()
  thisMonth.setDate(1)
  thisMonth.setHours(0, 0, 0, 0)
  const completedThisMonth = data.projects.filter(
    (p) => p.status === 'completed' && p.completed_at && new Date(p.completed_at) >= thisMonth,
  ).length
  const verified = data.projects
    .filter((p) => p.finance_order_id && p.order_value)
    .reduce((s, p) => s + Number(p.order_value), 0)

  return (
    <>
      <div className="fw-metrics">
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{count('active')}</span><span className="fw-m-l">Active</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{count('pending')}</span><span className="fw-m-l">Pending</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{completedThisMonth}</span><span className="fw-m-l">Completed This Month</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{count('cancelled')}</span><span className="fw-m-l">Cancelled</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{money(verified)}</span><span className="fw-m-l">Verified Earnings</span>
        </button>
      </div>

      <section className="gl-drawer-sec">
        <h4>Needs Attention</h4>
        {a.projectFollowupsDue + a.projectsOverdue === 0 ? (
          <p className="empty-row">Nothing needs chasing right now.</p>
        ) : (
          <div className="fw-attn">
            {a.projectFollowupsDue > 0 && <AttnRow n={a.projectFollowupsDue} text="follow-ups due" onClick={() => onJump('projects')} />}
            {a.projectsOverdue > 0 && <AttnRow n={a.projectsOverdue} text="projects past their due date" bad onClick={() => onJump('projects')} />}
          </div>
        )}
      </section>

      <section className="gl-drawer-sec">
        <h4>Recent Activity</h4>
        {data.activities.length === 0 ? (
          <p className="empty-row">Nothing logged yet.</p>
        ) : (
          <ul className="gl-timeline">
            {data.activities.slice(0, 10).map((x) => (
              <li key={x.id}><span>{x.note}</span><strong>{fmtDate(x.created_at)}</strong></li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
function AttnRow({ n, text, bad, onClick }: { n: number; text: string; bad?: boolean; onClick: () => void }) {
  return (
    <div className="fw-attn-row">
      <span className={`fw-attn-n${bad ? ' bad' : ''}`}>{n}</span>
      <span className="fw-attn-t">{text}</span>
      <button type="button" className="gl-btn ghost sm" onClick={onClick}>View</button>
    </div>
  )
}

// ============================================================
function ProjectsTab({ orgId, userId, data, reload, setError }: TabProps) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | FreelanceProjectStatus>('all')
  const open = data.projects.find((p) => p.id === openId) ?? null
  const rows = filter === 'all' ? data.projects : data.projects.filter((p) => p.status === filter)

  return (
    <>
      <div className="fw-toolbar">
        <div className="chips">
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All · {data.projects.length}</button>
          {PROJECT_STATUS.map((s) => (
            <button key={s.id} className={`chip ${filter === s.id ? 'active' : ''}`} onClick={() => setFilter(s.id)}>
              {s.label} · {data.projects.filter((p) => p.status === s.id).length}
            </button>
          ))}
        </div>
        <button className="gl-btn" onClick={() => setAdding(true)}>+ Add Project / Order</button>
      </div>
      {rows.length === 0 ? (
        <p className="empty-row">No projects or orders here yet.</p>
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Project / Order</th><th>Platform</th><th>Value</th><th>Due</th><th>Status</th><th>Finance</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const overdue = PROJECT_OPEN.includes(p.status) && p.due_date && new Date(p.due_date).getTime() < startOfToday().getTime()
                return (
                  <tr key={p.id} className="fw-row" onClick={() => setOpenId(p.id)}>
                    <td>{p.title}{p.service ? <span className="rp-dim"> · {p.service}</span> : ''}</td>
                    <td className="rp-dim">{p.platform ?? '—'}</td>
                    <td className="rp-dim">{money(p.order_value, p.currency)}</td>
                    <td className={overdue ? 'bad' : 'rp-dim'}>{p.due_date ? (overdue ? 'Overdue' : fmtDate(p.due_date)) : '—'}</td>
                    <td><StatusTag list={PROJECT_STATUS} id={p.status} /></td>
                    <td className="rp-dim">{p.finance_order_id ? 'Linked' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <ProjectDrawer project={open} orgId={orgId} userId={userId} onClose={() => setOpenId(null)} reload={reload} setError={setError} />
      )}
      {adding && (
        <SimpleModal title="Add project / order" fields={[
          { k: 'title', label: 'Project / order title', required: true },
          { k: 'service', label: 'Service' },
          { k: 'platform', label: 'Platform', select: PLATFORMS },
          { k: 'order_value', label: 'Order value', type: 'number' },
          { k: 'currency', label: 'Currency' },
          { k: 'due_date', label: 'Due date', type: 'date' },
        ]} onClose={() => setAdding(false)} onSubmit={async (v) => {
          const { error } = await fl.addProject(orgId, userId, {
            title: v.title.trim(), service: v.service?.trim() || null,
            platform: v.platform || null, order_value: v.order_value ? Number(v.order_value) : null,
            currency: v.currency?.trim() || null, due_date: v.due_date || null,
            start_date: new Date().toISOString().slice(0, 10), status: 'pending',
          })
          if (error) { setError(error.message); return false }
          setAdding(false); reload(); return true
        }} />
      )}
    </>
  )
}

function ProjectDrawer({ project, orgId, userId, onClose, reload, setError }: {
  project: FreelanceProject; orgId: string; userId: string
  onClose: () => void; reload: () => void; setError: (e: string | null) => void
}) {
  const p = project
  const [busy, setBusy] = useState(false)
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }
  async function setStatus(status: FreelanceProjectStatus) {
    const patch: Partial<FreelanceProject> = { status }
    patch.completed_at = status === 'completed' ? new Date().toISOString() : null
    await run(async () => {
      const r = await fl.updateProject(p.id, patch)
      if (!r.error) await fl.logActivity(orgId, userId, { project_id: p.id }, 'status_change', `${p.title}: ${status}`)
      return { error: r.error }
    })
  }
  return (
    <>
      <div className="drawer-overlay open" onClick={onClose} />
      <div className="drawer open">
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        <div className="drawer-head"><div className="drawer-avatar" aria-hidden>📦</div>
          <div><h3>{p.title}</h3><p>{[p.platform, p.service].filter(Boolean).join(' · ') || 'Project / order'}</p></div>
        </div>
        <div className="gl-drawer-sec"><h4>Status</h4>
          <select value={p.status} disabled={busy} onChange={(e) => setStatus(e.target.value as FreelanceProjectStatus)}>
            {PROJECT_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="gl-drawer-sec"><h4>Value &amp; dates</h4>
          <div className="gl-form-row">
            <label>Value<input type="number" min="0" defaultValue={p.order_value ?? ''} onBlur={(e) => run(() => fl.updateProject(p.id, { order_value: e.target.value ? Number(e.target.value) : null }))} /></label>
            <label>Due<input type="date" defaultValue={p.due_date ?? ''} onChange={(e) => run(() => fl.updateProject(p.id, { due_date: e.target.value || null }))} /></label>
          </div>
        </div>
        <div className="gl-drawer-sec"><h4>Follow-up</h4>
          <input type="datetime-local" defaultValue={p.next_follow_up_at ? p.next_follow_up_at.slice(0, 16) : ''}
            onChange={(e) => run(() => fl.updateProject(p.id, { next_follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
        </div>
        <div className="gl-drawer-sec"><h4>Finance</h4>
          {p.finance_order_id ? (
            <p className="gl-sub-note">Linked to an office-verified Finance order. Track settlement in your Wallet.</p>
          ) : (
            <>
              <p className="gl-sub-note">Not linked to Finance yet. When this order is paid, your office admin records it in Finance and links it here — that keeps your withdrawable balance accurate.</p>
              <button className="gl-btn sm ghost" disabled={busy || p.status === 'completed'} onClick={() => run(async () => {
                const r = await fl.updateProject(p.id, { status: 'completed', completed_at: new Date().toISOString() })
                if (!r.error) {
                  await fl.logActivity(orgId, userId, { project_id: p.id }, 'status_change', `${p.title}: completed`)
                  await supabase.from('notifications').insert(
                    (await supabase.from('memberships').select('user_id').eq('org_id', orgId).eq('status', 'active').eq('role', 'admin')).data?.map((m: { user_id: string }) => ({
                      org_id: orgId, user_id: m.user_id, type: 'freelance_order_ready', channel: 'in_app',
                      payload: { text: `Freelance order completed and ready to verify: "${p.title}"`, link: '/finance' }, status: 'sent',
                    })) ?? [],
                  )
                }
                return { error: r.error }
              })}>Mark completed &amp; notify office</button>
            </>
          )}
        </div>
        <div className="gl-drawer-actions">
          <button className="gl-btn ghost danger" disabled={busy} onClick={() => { if (confirm(`Delete "${p.title}"?`)) run(() => fl.deleteProject(p.id)).then(onClose) }}>Delete</button>
        </div>
      </div>
    </>
  )
}

// ============================================================
interface TabProps {
  orgId: string
  userId: string
  data: FreelanceData
  reload: () => void
  setError: (e: string | null) => void
}
function StatusTag({ list, id }: { list: { id: string; label: string; tone: string }[]; id: string }) {
  const s = list.find((x) => x.id === id)
  return <span className={`gl-tag ${s?.tone ?? 'neutral'}`}>{s?.label ?? id}</span>
}

interface Field { k: string; label: string; required?: boolean; type?: string; select?: string[] }
function SimpleModal({ title, fields, onClose, onSubmit }: {
  title: string; fields: Field[]; onClose: () => void; onSubmit: (v: Record<string, string>) => Promise<boolean>
}) {
  const [v, setV] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const req = fields.filter((f) => f.required)
  const ok = req.every((f) => (v[f.k] ?? '').trim())
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gl-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); await onSubmit(v); setBusy(false) }}>
          <h2>{title}</h2>
          {fields.map((f) => (
            <label key={f.k}>{f.label}
              {f.select ? (
                <select value={v[f.k] ?? ''} onChange={(e) => setV((s) => ({ ...s, [f.k]: e.target.value }))}>
                  {f.select.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                </select>
              ) : (
                <input type={f.type ?? 'text'} value={v[f.k] ?? ''} onChange={(e) => setV((s) => ({ ...s, [f.k]: e.target.value }))} required={f.required} />
              )}
            </label>
          ))}
          <div className="gl-drawer-actions" style={{ marginTop: 12 }}>
            <button type="submit" className="gl-btn" disabled={busy || !ok}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="gl-btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
