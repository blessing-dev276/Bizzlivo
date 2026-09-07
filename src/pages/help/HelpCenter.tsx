import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import {
  CATEGORY_LABEL,
  createTicket,
  HELP_ARTICLES,
  loadMyTickets,
  loadOrgTickets,
  STATUS_LABEL,
  updateTicket,
  type SupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../../lib/support'

type Tab = 'help' | 'contact' | 'mine' | 'triage'

export default function HelpCenter() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const isAdmin = currentMembership?.role === 'admin'
  const [tab, setTab] = useState<Tab>('help')

  return (
    <div className="page hc-page">
      <div className="page-head">
        <h1>Help &amp; Support</h1>
        <p>Learn how Bizzlivo works, or get help from your office.</p>
      </div>

      <div className="rp-tabs" role="tablist">
        <TabBtn id="help" tab={tab} setTab={setTab}>Help Center</TabBtn>
        <TabBtn id="contact" tab={tab} setTab={setTab}>Contact Support</TabBtn>
        <TabBtn id="mine" tab={tab} setTab={setTab}>My Requests</TabBtn>
        {isAdmin && <TabBtn id="triage" tab={tab} setTab={setTab}>Office Tickets</TabBtn>}
      </div>

      {tab === 'help' && (
        <div className="hc-grid">
          {HELP_ARTICLES.map((a) => (
            <article className="hc-card" key={a.title}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
              {a.to && <Link to={a.to} className="hc-link">Open {a.title} →</Link>}
            </article>
          ))}
        </div>
      )}

      {tab === 'contact' && orgId && profile && (
        <ContactForm orgId={orgId} userId={profile.id} onDone={() => setTab('mine')} />
      )}

      {tab === 'mine' && profile && <MyTickets userId={profile.id} />}

      {tab === 'triage' && isAdmin && orgId && <Triage orgId={orgId} />}
    </div>
  )
}

function TabBtn({ id, tab, setTab, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
      {children}
    </button>
  )
}

function ContactForm({ orgId, userId, onDone }: { orgId: string; userId: string; onDone: () => void }) {
  const [f, setF] = useState({ category: 'question' as TicketCategory, priority: 'normal' as TicketPriority, subject: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.subject.trim() || !f.description.trim()) return
    setBusy(true); setErr(null)
    const { error } = await createTicket({ org_id: orgId, created_by: userId, ...f, subject: f.subject.trim(), description: f.description.trim() })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <form className="hc-form" onSubmit={submit}>
      <div className="gl-form-row">
        <label>Category
          <select value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value as TicketCategory }))}>
            {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value as TicketPriority }))}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        </label>
      </div>
      <label>Subject<input value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} required /></label>
      <label>Details<textarea rows={5} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} required placeholder="What happened, and what did you expect?" /></label>
      {err && <p className="form-error">{err}</p>}
      <button type="submit" className="gl-btn" disabled={busy || !f.subject.trim() || !f.description.trim()}>{busy ? 'Sending…' : 'Send request'}</button>
    </form>
  )
}

function MyTickets({ userId }: { userId: string }) {
  const [rows, setRows] = useState<SupportTicket[] | null>(null)
  useEffect(() => { loadMyTickets(userId).then(({ data }) => setRows((data as SupportTicket[]) ?? [])) }, [userId])
  if (!rows) return <p className="empty-row">Loading…</p>
  if (rows.length === 0) return <p className="empty-row">You haven't sent any requests yet.</p>
  return (
    <div className="hc-tickets">
      {rows.map((t) => (
        <article className="hc-ticket" key={t.id}>
          <div className="hc-ticket-top">
            <strong>{t.subject}</strong>
            <span className={`gl-tag ${STATUS_LABEL[t.status].tone}`}>{STATUS_LABEL[t.status].label}</span>
          </div>
          <p className="hc-ticket-meta">{CATEGORY_LABEL[t.category]} · {new Date(t.created_at).toLocaleDateString()}</p>
          <p className="hc-ticket-body">{t.description}</p>
          {t.admin_note && <p className="gl-review-note ok"><strong>Office:</strong> {t.admin_note}</p>}
        </article>
      ))}
    </div>
  )
}

function Triage({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<(SupportTicket & { creator?: { full_name: string } })[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(() => { loadOrgTickets(orgId).then(({ data }) => setRows((data as never) ?? [])) }, [orgId])
  useEffect(load, [load])
  const open = rows?.find((t) => t.id === openId) ?? null

  if (!rows) return <p className="empty-row">Loading…</p>
  return (
    <>
      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead><tr><th>Subject</th><th>From</th><th>Category</th><th>Priority</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="rp-dim">No tickets.</td></tr> : rows.map((t) => (
              <tr key={t.id}>
                <td>{t.subject}</td>
                <td className="rp-dim">{t.creator?.full_name ?? '—'}</td>
                <td className="rp-dim">{CATEGORY_LABEL[t.category]}</td>
                <td className="rp-dim">{t.priority}</td>
                <td><span className={`gl-tag ${STATUS_LABEL[t.status].tone}`}>{STATUS_LABEL[t.status].label}</span></td>
                <td><button className="gl-btn ghost sm" onClick={() => setOpenId(t.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <>
          <div className="drawer-overlay open" onClick={() => setOpenId(null)} />
          <div className="drawer open">
            <button type="button" className="drawer-close" onClick={() => setOpenId(null)}>✕</button>
            <div className="drawer-head"><div className="drawer-avatar" aria-hidden>🎫</div>
              <div><h3>{open.subject}</h3><p>{open.creator?.full_name ?? ''} · {CATEGORY_LABEL[open.category]}</p></div>
            </div>
            <p className="gl-drawer-desc">{open.description}</p>
            <div className="gl-drawer-sec">
              <h4>Status</h4>
              <select value={open.status} onChange={async (e) => { await updateTicket(open.id, { status: e.target.value as TicketStatus }); load() }}>
                {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s].label}</option>)}
              </select>
            </div>
            <div className="gl-drawer-sec">
              <h4>Note to member</h4>
              <textarea rows={3} defaultValue={open.admin_note ?? ''} onBlur={async (e) => { await updateTicket(open.id, { admin_note: e.target.value.trim() || null }); load() }} />
            </div>
          </div>
        </>
      )}
    </>
  )
}
