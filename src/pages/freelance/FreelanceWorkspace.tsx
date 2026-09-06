import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  attentionFrom,
  convertProspectToClient,
  fl,
  loadFreelance,
  money,
  PLATFORMS,
  PROJECT_OPEN,
  PROJECT_STATUS,
  PROSPECT_OPEN,
  PROSPECT_STATUS,
  runFreelanceMaintenance,
  type FreelanceClient,
  type FreelanceData,
  type FreelanceProject,
  type FreelanceProjectStatus,
  type FreelanceProspect,
  type FreelanceProspectStatus,
} from '../../lib/freelance'

type View = 'overview' | 'prospects' | 'clients' | 'projects'
const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'prospects', label: 'Prospects' },
  { id: 'clients', label: 'Clients' },
  { id: 'projects', label: 'Projects' },
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
    runFreelanceMaintenance(orgId, userId, attentionFrom(d))
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
          <p>Run your freelancing business — track prospects, clients and the work you deliver.</p>
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
      {view === 'prospects' && <ProspectsTab orgId={orgId} userId={userId} data={data} reload={reload} setError={setError} />}
      {view === 'clients' && <ClientsTab orgId={orgId} userId={userId} data={data} reload={reload} setError={setError} />}
      {view === 'projects' && <ProjectsTab orgId={orgId} userId={userId} data={data} reload={reload} setError={setError} />}
    </div>
  )
}

// ============================================================
function OverviewTab({ data, onJump }: { data: FreelanceData; onJump: (v: View) => void }) {
  const a = attentionFrom(data)
  const activeProspects = data.prospects.filter((p) => PROSPECT_OPEN.includes(p.status)).length
  const openProjects = data.projects.filter((p) => PROJECT_OPEN.includes(p.status)).length
  const thisMonth = new Date()
  thisMonth.setDate(1)
  thisMonth.setHours(0, 0, 0, 0)
  const wonThisMonth = data.projects.filter(
    (p) => p.status === 'completed' && p.completed_at && new Date(p.completed_at) >= thisMonth,
  ).length
  const verified = data.projects
    .filter((p) => p.finance_order_id && p.order_value)
    .reduce((s, p) => s + Number(p.order_value), 0)

  return (
    <>
      <div className="fw-metrics">
        <button className="fw-metric" onClick={() => onJump('prospects')}>
          <span className="fw-m-v">{activeProspects}</span><span className="fw-m-l">Active Prospects</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('clients')}>
          <span className="fw-m-v">{data.clients.length}</span><span className="fw-m-l">Clients</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{openProjects}</span><span className="fw-m-l">Open Projects</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{wonThisMonth}</span><span className="fw-m-l">Completed This Month</span>
        </button>
        <button className="fw-metric" onClick={() => onJump('projects')}>
          <span className="fw-m-v">{money(verified)}</span><span className="fw-m-l">Verified Earnings</span>
        </button>
      </div>

      <section className="gl-drawer-sec">
        <h4>Needs Attention</h4>
        {a.prospectFollowupsDue + a.projectFollowupsDue + a.projectsOverdue + a.proposalsOut === 0 ? (
          <p className="empty-row">Nothing needs chasing right now.</p>
        ) : (
          <div className="fw-attn">
            {a.prospectFollowupsDue > 0 && <AttnRow n={a.prospectFollowupsDue} text="prospect follow-ups due" onClick={() => onJump('prospects')} />}
            {a.projectFollowupsDue > 0 && <AttnRow n={a.projectFollowupsDue} text="project follow-ups due" onClick={() => onJump('projects')} />}
            {a.projectsOverdue > 0 && <AttnRow n={a.projectsOverdue} text="projects past their due date" bad onClick={() => onJump('projects')} />}
            {a.proposalsOut > 0 && <AttnRow n={a.proposalsOut} text="proposals awaiting a response" onClick={() => onJump('prospects')} />}
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
function ProspectsTab({ orgId, userId, data, reload, setError }: TabProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | FreelanceProspectStatus>('all')
  const [adding, setAdding] = useState(false)
  const open = data.prospects.find((p) => p.id === openId) ?? null
  const rows = filter === 'all' ? data.prospects : data.prospects.filter((p) => p.status === filter)

  return (
    <>
      <div className="fw-toolbar">
        <div className="chips">
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All · {data.prospects.length}</button>
          {PROSPECT_STATUS.map((s) => (
            <button key={s.id} className={`chip ${filter === s.id ? 'active' : ''}`} onClick={() => setFilter(s.id)}>
              {s.label} · {data.prospects.filter((p) => p.status === s.id).length}
            </button>
          ))}
        </div>
        <button className="gl-btn" onClick={() => setAdding(true)}>+ Add Prospect</button>
      </div>

      {rows.length === 0 ? (
        <p className="empty-row">No prospects here yet.</p>
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Name</th><th>Platform</th><th>Service</th><th>Status</th><th>Value</th><th>Follow-up</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const overdue = p.next_follow_up_at && new Date(p.next_follow_up_at).getTime() < startOfToday().getTime()
                return (
                  <tr key={p.id} className="fw-row" onClick={() => setOpenId(p.id)}>
                    <td>{p.name}{p.company ? <span className="rp-dim"> · {p.company}</span> : ''}</td>
                    <td className="rp-dim">{p.platform ?? '—'}</td>
                    <td className="rp-dim">{p.service ?? '—'}</td>
                    <td><StatusTag list={PROSPECT_STATUS} id={p.status} /></td>
                    <td className="rp-dim">{money(p.expected_value, p.currency)}</td>
                    <td className={overdue ? 'bad' : 'rp-dim'}>{p.next_follow_up_at ? (overdue ? 'Overdue' : fmtDate(p.next_follow_up_at)) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ProspectDrawer prospect={open} orgId={orgId} userId={userId} onClose={() => setOpenId(null)} reload={reload} setError={setError} />
      )}
      {adding && (
        <ProspectModal orgId={orgId} userId={userId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} setError={setError} />
      )}
    </>
  )
}

function ProspectDrawer({ prospect, orgId, userId, onClose, reload, setError }: {
  prospect: FreelanceProspect; orgId: string; userId: string; onClose: () => void; reload: () => void; setError: (e: string | null) => void
}) {
  const p = prospect
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }
  async function setStatus(status: FreelanceProspectStatus) {
    if (status === p.status) return
    await run(async () => {
      const r = await fl.updateProspect(p.id, { status })
      if (!r.error) await fl.logActivity(orgId, userId, { prospect_id: p.id }, 'status_change', `Status → ${status}`)
      return { error: r.error }
    })
  }
  const wa = p.contact_link
  return (
    <>
      <div className="drawer-overlay open" onClick={onClose} />
      <div className="drawer open">
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        <div className="drawer-head">
          <div className="drawer-avatar" aria-hidden>💼</div>
          <div><h3>{p.name}</h3><p>{[p.company, p.platform, p.service].filter(Boolean).join(' · ') || 'Freelance prospect'}</p></div>
        </div>

        <div className="gl-drawer-sec">
          <h4>Status</h4>
          <select value={p.status} disabled={busy} onChange={(e) => setStatus(e.target.value as FreelanceProspectStatus)}>
            {PROSPECT_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div className="gl-drawer-sec">
          <h4>Follow-up</h4>
          <input type="datetime-local" defaultValue={p.next_follow_up_at ? p.next_follow_up_at.slice(0, 16) : ''}
            onChange={(e) => run(() => fl.updateProspect(p.id, { next_follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
          <p className="rp-dim" style={{ fontSize: 12 }}>Last contacted: {fmtDate(p.last_contacted_at)}</p>
        </div>

        <div className="gl-drawer-sec">
          <h4>Quick actions</h4>
          <div className="gl-drawer-actions">
            {wa && <a className="gl-btn sm" href={wa} target="_blank" rel="noreferrer">Open contact</a>}
            <button className="gl-btn sm ghost" disabled={busy} onClick={() => run(async () => {
              const r = await fl.updateProspect(p.id, { last_contacted_at: new Date().toISOString() })
              if (!r.error) await fl.logActivity(orgId, userId, { prospect_id: p.id }, 'contact', 'Logged contact')
              return { error: r.error }
            })}>Log contact</button>
            {!p.converted_client_id && (
              <button className="gl-btn sm" disabled={busy} onClick={async () => {
                setBusy(true); await convertProspectToClient(p); setBusy(false); reload()
              }}>Convert to client</button>
            )}
          </div>
        </div>

        <div className="gl-drawer-sec">
          <h4>Add note</h4>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="gl-btn sm" disabled={busy || !note.trim()} onClick={() => run(async () => {
            const r = await fl.logActivity(orgId, userId, { prospect_id: p.id }, 'note', note.trim())
            setNote('')
            return { error: r.error }
          })}>Save note</button>
        </div>

        <div className="gl-drawer-actions">
          <button className="gl-btn ghost danger" disabled={busy} onClick={() => { if (confirm(`Delete "${p.name}"?`)) run(() => fl.deleteProspect(p.id)).then(onClose) }}>Delete</button>
        </div>
      </div>
    </>
  )
}

function ProspectModal({ orgId, userId, onClose, onSaved, setError }: {
  orgId: string; userId: string; onClose: () => void; onSaved: () => void; setError: (e: string | null) => void
}) {
  const [f, setF] = useState({ name: '', company: '', platform: '', service: '', contact_link: '', expected_value: '', currency: 'NGN', source: '', next_follow_up_at: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return
    setBusy(true); setError(null)
    const { error } = await fl.addProspect(orgId, userId, {
      name: f.name.trim(), company: f.company.trim() || null, platform: f.platform || null,
      service: f.service.trim() || null, contact_link: f.contact_link.trim() || null,
      expected_value: f.expected_value ? Number(f.expected_value) : null, currency: f.currency || null,
      source: f.source.trim() || null,
      next_follow_up_at: f.next_follow_up_at ? new Date(f.next_follow_up_at).toISOString() : null,
    })
    setBusy(false)
    if (error) setError(error.message)
    else onSaved()
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gl-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={save}>
          <h2>Add freelance prospect</h2>
          <label>Name / Company<input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></label>
          <div className="gl-form-row">
            <label>Platform
              <select value={f.platform} onChange={(e) => set('platform', e.target.value)}>
                <option value="">—</option>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>Service<input value={f.service} onChange={(e) => set('service', e.target.value)} placeholder="e.g. GHL setup" /></label>
          </div>
          <label>Contact / Profile link<input value={f.contact_link} onChange={(e) => set('contact_link', e.target.value)} /></label>
          <div className="gl-form-row">
            <label>Expected value<input type="number" min="0" value={f.expected_value} onChange={(e) => set('expected_value', e.target.value)} /></label>
            <label>Currency<input value={f.currency} onChange={(e) => set('currency', e.target.value)} /></label>
          </div>
          <div className="gl-form-row">
            <label>Source<input value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Referral, DM…" /></label>
            <label>Next follow-up<input type="datetime-local" value={f.next_follow_up_at} onChange={(e) => set('next_follow_up_at', e.target.value)} /></label>
          </div>
          <div className="gl-drawer-actions" style={{ marginTop: 12 }}>
            <button type="submit" className="gl-btn" disabled={busy || !f.name.trim()}>{busy ? 'Adding…' : 'Add prospect'}</button>
            <button type="button" className="gl-btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================
function ClientsTab({ orgId, userId, data, reload, setError }: TabProps) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = data.clients.find((c) => c.id === openId) ?? null
  const projectsByClient = useMemo(() => {
    const m = new Map<string, FreelanceProject[]>()
    for (const p of data.projects) if (p.client_id) m.set(p.client_id, [...(m.get(p.client_id) ?? []), p])
    return m
  }, [data.projects])

  return (
    <>
      <div className="fw-toolbar">
        <span className="rp-dim">{data.clients.length} client{data.clients.length === 1 ? '' : 's'}</span>
        <button className="gl-btn" onClick={() => setAdding(true)}>+ Add Client</button>
      </div>
      {data.clients.length === 0 ? (
        <p className="empty-row">No clients yet — convert a won prospect or add one directly.</p>
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Client</th><th>Platform</th><th>Services</th><th>Projects</th><th>Verified earnings</th></tr></thead>
            <tbody>
              {data.clients.map((c) => {
                const projs = projectsByClient.get(c.id) ?? []
                const earned = projs.filter((p) => p.finance_order_id && p.order_value).reduce((s, p) => s + Number(p.order_value), 0)
                return (
                  <tr key={c.id} className="fw-row" onClick={() => setOpenId(c.id)}>
                    <td>{c.name}{c.company ? <span className="rp-dim"> · {c.company}</span> : ''}</td>
                    <td className="rp-dim">{c.platform ?? '—'}</td>
                    <td className="rp-dim">{c.services.join(', ') || '—'}</td>
                    <td className="rp-dim">{projs.length}</td>
                    <td className="rp-dim">{money(earned)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="drawer-overlay open" onClick={() => setOpenId(null)} />
      )}
      {open && (
        <div className="drawer open">
          <button type="button" className="drawer-close" onClick={() => setOpenId(null)}>✕</button>
          <div className="drawer-head"><div className="drawer-avatar" aria-hidden>🤝</div><div><h3>{open.name}</h3><p>{[open.company, open.platform].filter(Boolean).join(' · ') || 'Client'}</p></div></div>
          <div className="gl-drawer-sec"><h4>Contact</h4><p className="rp-dim">{open.contact_link || '—'}</p></div>
          <div className="gl-drawer-sec"><h4>Services</h4><p className="rp-dim">{open.services.join(', ') || '—'}</p></div>
          <div className="gl-drawer-sec"><h4>Projects</h4>
            <ul className="gl-timeline">
              {(projectsByClient.get(open.id) ?? []).map((p) => (
                <li key={p.id}><span>{p.title}</span><strong>{PROJECT_STATUS.find((s) => s.id === p.status)?.label}</strong></li>
              ))}
              {(projectsByClient.get(open.id) ?? []).length === 0 && <li><span className="rp-dim">No projects yet</span><strong /></li>}
            </ul>
          </div>
          <div className="gl-drawer-actions">
            <button className="gl-btn ghost danger" onClick={async () => { if (confirm(`Delete "${open.name}"?`)) { await fl.deleteClient(open.id); setOpenId(null); reload() } }}>Delete</button>
          </div>
        </div>
      )}
      {adding && (
        <SimpleModal title="Add client" fields={[
          { k: 'name', label: 'Name / Company', required: true },
          { k: 'company', label: 'Company' },
          { k: 'platform', label: 'Platform', select: PLATFORMS },
          { k: 'contact_link', label: 'Contact link' },
          { k: 'services', label: 'Services (comma separated)' },
        ]} onClose={() => setAdding(false)} onSubmit={async (v) => {
          const { error } = await fl.addClient(orgId, userId, {
            name: v.name.trim(), company: v.company?.trim() || null, platform: v.platform || null,
            contact_link: v.contact_link?.trim() || null,
            services: v.services ? v.services.split(',').map((s) => s.trim()).filter(Boolean) : [],
          })
          if (error) { setError(error.message); return false }
          setAdding(false); reload(); return true
        }} />
      )}
    </>
  )
}

// ============================================================
function ProjectsTab({ orgId, userId, data, reload, setError }: TabProps) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | FreelanceProjectStatus>('all')
  const open = data.projects.find((p) => p.id === openId) ?? null
  const rows = filter === 'all' ? data.projects : data.projects.filter((p) => p.status === filter)
  const clientName = (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? '—'

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
        <button className="gl-btn" onClick={() => setAdding(true)}>+ Add Project</button>
      </div>
      {rows.length === 0 ? (
        <p className="empty-row">No projects here yet.</p>
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Project</th><th>Client</th><th>Value</th><th>Due</th><th>Status</th><th>Finance</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const overdue = PROJECT_OPEN.includes(p.status) && p.due_date && new Date(p.due_date).getTime() < startOfToday().getTime()
                return (
                  <tr key={p.id} className="fw-row" onClick={() => setOpenId(p.id)}>
                    <td>{p.title}</td>
                    <td className="rp-dim">{clientName(p.client_id)}</td>
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
        <ProjectDrawer project={open} orgId={orgId} userId={userId} clients={data.clients} onClose={() => setOpenId(null)} reload={reload} setError={setError} />
      )}
      {adding && (
        <SimpleModal title="Add project / order" fields={[
          { k: 'title', label: 'Project title', required: true },
          { k: 'client', label: 'Client', select: ['', ...data.clients.map((c) => c.name)] },
          { k: 'service', label: 'Service' },
          { k: 'platform', label: 'Platform', select: PLATFORMS },
          { k: 'order_value', label: 'Order value', type: 'number' },
          { k: 'currency', label: 'Currency' },
          { k: 'due_date', label: 'Due date', type: 'date' },
        ]} onClose={() => setAdding(false)} onSubmit={async (v) => {
          const client = data.clients.find((c) => c.name === v.client)
          const { error } = await fl.addProject(orgId, userId, {
            title: v.title.trim(), client_id: client?.id ?? null, service: v.service?.trim() || null,
            platform: v.platform || null, order_value: v.order_value ? Number(v.order_value) : null,
            currency: v.currency?.trim() || null, due_date: v.due_date || null, start_date: new Date().toISOString().slice(0, 10),
          })
          if (error) { setError(error.message); return false }
          setAdding(false); reload(); return true
        }} />
      )}
    </>
  )
}

function ProjectDrawer({ project, orgId, userId, clients, onClose, reload, setError }: {
  project: FreelanceProject; orgId: string; userId: string; clients: FreelanceClient[]
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
    if (status === 'completed') patch.completed_at = new Date().toISOString()
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
          <div><h3>{p.title}</h3><p>{[clients.find((c) => c.id === p.client_id)?.name, p.platform, p.service].filter(Boolean).join(' · ') || 'Project'}</p></div>
        </div>
        <div className="gl-drawer-sec"><h4>Status</h4>
          <select value={p.status} disabled={busy} onChange={(e) => setStatus(e.target.value as FreelanceProjectStatus)}>
            {PROJECT_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="gl-drawer-sec"><h4>Client</h4>
          <select value={p.client_id ?? ''} disabled={busy} onChange={(e) => run(() => fl.updateProject(p.id, { client_id: e.target.value || null }))}>
            <option value="">— none —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="gl-drawer-sec"><h4>Value & dates</h4>
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