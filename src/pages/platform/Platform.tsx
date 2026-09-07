import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// Bizzlivo Super Admin. Entirely separate from office roles — gated by
// is_platform_admin() (0003). All data comes from the security-definer
// platform RPCs, which enforce the check themselves.
function usePlatformAdmin() {
  const { profile, session, loading } = useAuth()
  const [state, setState] = useState<'checking' | 'yes' | 'no' | 'anon'>('checking')
  useEffect(() => {
    if (loading) return
    if (!session) {
      setState('anon')
      return
    }
    if (!profile) return
    supabase.rpc('is_platform_admin').then(({ data }) => setState(data === true ? 'yes' : 'no'))
  }, [profile, session, loading])
  return state
}

const naira = (kobo: number) => `₦${Math.round((kobo || 0) / 100).toLocaleString()}`

export default function Platform() {
  const state = usePlatformAdmin()
  if (state === 'checking') return <div className="page"><p className="empty-row">Checking access…</p></div>
  if (state === 'anon') return <Navigate to="/login" replace />
  if (state === 'no') return <Navigate to="/" replace />
  return (
    <div className="page plat-page">
      <div className="plat-nav">
        <strong>Bizzlivo Platform</strong>
        <Link to="/platform">Overview</Link>
        <Link to="/platform/orgs">Organizations</Link>
        <Link to="/" className="plat-exit">← Exit to app</Link>
      </div>
      <Routes>
        <Route index element={<PlatformOverview />} />
        <Route path="orgs" element={<PlatformOrgs />} />
        <Route path="orgs/:orgId" element={<PlatformOrgDetail />} />
        <Route path="*" element={<Navigate to="/platform" replace />} />
      </Routes>
    </div>
  )
}

interface Overview {
  organizations: number
  active_organizations: number
  paid_organizations: number
  free_organizations: number
  total_users: number
  active_users_7d: number
  mrr_kobo: number
  ai_usage_month: number
  recent_orgs: { id: string; name: string; plan: string; status: string; created_at: string }[]
  _error?: string
}

function PlatformOverview() {
  const [d, setD] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('platform_overview').then(({ data, error }) => {
      if (error) setErr(error.message)
      else if ((data as Overview)?._error) setErr((data as Overview)._error!)
      else setD(data as Overview)
    })
  }, [])
  if (err) return <div className="rp-error"><p>{err}</p></div>
  if (!d) return <p className="empty-row">Loading…</p>
  return (
    <>
      <h1>Platform Overview</h1>
      <div className="rp-metrics">
        <M label="Organizations" v={d.organizations} sub={`${d.active_organizations} active`} />
        <M label="Paid orgs" v={d.paid_organizations} sub={`${d.free_organizations} free`} />
        <M label="Total users" v={d.total_users} sub={`${d.active_users_7d} active (7d)`} />
        <M label="MRR" v={naira(d.mrr_kobo)} sub="from active subscriptions" />
        <M label="AI generations (month)" v={d.ai_usage_month} />
      </div>
      <h2 style={{ marginTop: 24 }}>Newest organizations</h2>
      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead><tr><th>Name</th><th>Plan</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>
            {d.recent_orgs.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td><td className="rp-dim">{o.plan}</td><td className="rp-dim">{o.status}</td>
                <td className="rp-dim">{new Date(o.created_at).toLocaleDateString()}</td>
                <td><Link className="gl-btn ghost sm" to={`/platform/orgs/${o.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

interface Office {
  org_id: string
  name: string
  slug: string
  plan_tier: string
  status: string
  member_count: number
  exam_count: number
  last_attempt_at: string | null
  created_at: string
}

function PlatformOrgs() {
  const [rows, setRows] = useState<Office[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    supabase.rpc('admin_list_offices').then(({ data }) => setRows((data as Office[]) ?? []))
  }, [])
  if (!rows) return <p className="empty-row">Loading…</p>
  const visible = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <h1>Organizations</h1>
      <input className="net-search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260, marginBottom: 14 }} />
      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead><tr><th>Name</th><th>Plan</th><th>Status</th><th>Members</th><th>Last activity</th><th /></tr></thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o.org_id}>
                <td>{o.name}<span className="rp-dim"> · {o.slug}</span></td>
                <td className="rp-dim">{o.plan_tier}</td>
                <td><span className={`gl-tag ${o.status === 'active' ? 'green' : 'red'}`}>{o.status}</span></td>
                <td className="rp-dim">{o.member_count}</td>
                <td className="rp-dim">{o.last_attempt_at ? new Date(o.last_attempt_at).toLocaleDateString() : '—'}</td>
                <td><Link className="gl-btn ghost sm" to={`/platform/orgs/${o.org_id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function PlatformOrgDetail() {
  const { orgId } = useParams<{ orgId: string }>()
  const [d, setD] = useState<{ org: { name: string; status: string; plan_tier: string; slug: string }; members: unknown[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!orgId) return
    supabase.rpc('admin_get_office_detail', { target_org_id: orgId }).then(({ data }) => setD(data as never))
  }, [orgId])
  useEffect(load, [load])

  async function setStatus(status: string) {
    if (!orgId || !confirm(`Set this organization to "${status}"?`)) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_set_office_status', { target_org_id: orgId, new_status: status })
    setBusy(false)
    setMsg(error ? error.message : `Status set to ${status}.`)
    load()
  }
  async function setPlan(plan: string) {
    if (!orgId) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_set_plan_tier', { target_org_id: orgId, new_plan: plan })
    setBusy(false)
    setMsg(error ? error.message : `Plan set to ${plan}.`)
    load()
  }

  if (!d) return <p className="empty-row">Loading…</p>
  const o = d.org
  return (
    <>
      <Link to="/platform/orgs" className="rp-jump">← Organizations</Link>
      <h1>{o.name}</h1>
      <p className="rp-dim">{o.slug} · plan {o.plan_tier} · <span className={`gl-tag ${o.status === 'active' ? 'green' : 'red'}`}>{o.status}</span> · {d.members?.length ?? 0} members</p>
      {msg && <p className="form-info">{msg}</p>}

      <section className="gl-drawer-sec" style={{ marginTop: 16 }}>
        <h4>Status</h4>
        <div className="gl-drawer-actions">
          {o.status !== 'active' && <button className="gl-btn" disabled={busy} onClick={() => setStatus('active')}>Reactivate</button>}
          {o.status === 'active' && <button className="gl-btn ghost danger" disabled={busy} onClick={() => setStatus('suspended')}>Suspend</button>}
        </div>
      </section>
      <section className="gl-drawer-sec">
        <h4>Plan override</h4>
        <div className="gl-drawer-actions">
          {['free', 'growth', 'business'].map((p) => (
            <button key={p} className="gl-btn ghost sm" disabled={busy || o.plan_tier === p} onClick={() => setPlan(p)}>{p}</button>
          ))}
        </div>
        <p className="gl-sub-note">Every status / plan change is written to audit_log.</p>
      </section>
    </>
  )
}

function M({ label, v, sub }: { label: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="rp-metric">
      <span className="rp-metric-label">{label}</span>
      <span className="rp-metric-value">{v}</span>
      <span className="rp-metric-sub">{sub ?? ' '}</span>
    </div>
  )
}
