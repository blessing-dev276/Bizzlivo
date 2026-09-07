import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import ThemeToggle from '../../components/ThemeToggle'
import {
  clearPlanOverride,
  extendTrial,
  getAiUsage,
  getAudit,
  getEmailStats,
  getOrgDetail,
  getOverview,
  getPlans,
  getPlatformSettings,
  getSupport,
  listOrgs,
  listSubscriptions,
  listUsers,
  naira,
  platformClearMustChange,
  platformIdentity,
  platformRecordLogin,
  resolvePlatformUsername,
  savePlatformSettings,
  setOrgStatus,
  setPlanOverride,
  STATUS_TONE,
  type PlatformOrgRow,
  type PlatformOverview,
} from '../../lib/platform'

// ============================================================
// Entry: routes /platform/login unguarded, everything else guarded.
// ============================================================
export default function Platform() {
  return (
    <Routes>
      <Route path="login" element={<PlatformLogin />} />
      <Route path="*" element={<PlatformShell />} />
    </Routes>
  )
}

// ============================================================
// Login — dedicated, minimal, high-security look
// ============================================================
function PlatformLogin() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [ident, setIdent] = useState('admin-bizzlivo')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    platformIdentity().then((i) => { if (i.isAdmin) navigate('/platform', { replace: true }) })
  }, [session, navigate])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      let email = ident.trim()
      if (!email.includes('@')) {
        const { data } = await resolvePlatformUsername(email)
        if (!data) throw new Error('Unknown platform account.')
        email = data as string
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
      if (error) throw error
      const i = await platformIdentity()
      if (!i.isAdmin) {
        await supabase.auth.signOut()
        throw new Error('This account has no platform access.')
      }
      await platformRecordLogin().catch(() => {})
      navigate('/platform', { replace: true })
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pl-login">
      <form className="pl-login-card" onSubmit={submit}>
        <div className="pl-login-brand">BIZZLIVO</div>
        <h1>Platform Administration</h1>
        <p>Authorized platform operators only.</p>
        <label>Username or email<input value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
        {err && <p className="form-error">{err}</p>}
        <button type="submit" className="pl-login-btn" disabled={busy || !pw}>{busy ? 'Signing in…' : 'Sign In'}</button>
        <Link to="/" className="pl-login-back">← Back to Bizzlivo</Link>
      </form>
    </div>
  )
}

// ============================================================
// Shell — guard + sidebar + topbar + nested routes
// ============================================================
const NAV: { section: string; items: { to: string; label: string; end?: boolean }[] }[] = [
  { section: 'Overview', items: [{ to: '/platform', label: 'Dashboard', end: true }] },
  { section: 'Organizations', items: [
    { to: '/platform/organizations', label: 'Organizations' },
    { to: '/platform/subscriptions', label: 'Subscriptions' },
  ] },
  { section: 'Platform', items: [
    { to: '/platform/users', label: 'Users' },
    { to: '/platform/ai', label: 'AI Usage' },
    { to: '/platform/email', label: 'Email' },
    { to: '/platform/support', label: 'Support' },
    { to: '/platform/audit', label: 'Audit' },
  ] },
  { section: 'System', items: [
    { to: '/platform/plans', label: 'Plans & Entitlements' },
    { to: '/platform/settings', label: 'Platform Settings' },
  ] },
  { section: 'Account', items: [{ to: '/platform/security', label: 'Security' }] },
]

function PlatformShell() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')
  const [mustChange, setMustChange] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!session) { setState('denied'); return }
    ;(async () => {
      const i = await platformIdentity()
      if (!i.isAdmin) { setState('denied'); return }
      // pull username / must_change from the login-record RPC (idempotent)
      const rec = await platformRecordLogin().catch(() => null)
      setUsername(rec?.username ?? null)
      setRole(rec?.role ?? (i.isSuper ? 'super_admin' : 'platform_admin'))
      setMustChange(rec?.must_change_password ?? false)
      setState('ok')
    })()
  }, [session, loading])

  if (state === 'checking') return <div className="pl-boot">Verifying platform access…</div>
  if (state === 'denied') return <Navigate to="/platform/login" replace />

  return (
    <div className="pl-app">
      <aside className="pl-side">
        <div className="pl-side-brand">Bizzlivo <span>Platform</span></div>
        <nav>
          {NAV.map((s) => (
            <div className="pl-side-sec" key={s.section}>
              <span className="pl-side-label">{s.section}</span>
              {s.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className="pl-side-exit" onClick={() => navigate('/')}>← Exit to app</button>
      </aside>

      <main className="pl-main">
        <header className="pl-top">
          <PlatformSearch />
          <div className="pl-top-right">
            <ThemeToggle />
            <span className="pl-acct">
              <strong>{username ?? 'admin-bizzlivo'}</strong>
              <span>{role === 'super_admin' ? 'Super Admin' : 'Platform Admin'}</span>
            </span>
            <button type="button" className="pl-signout" onClick={async () => { await supabase.auth.signOut(); navigate('/platform/login') }}>Logout</button>
          </div>
        </header>

        <div className="pl-content">
          {mustChange && (
            <div className="pl-banner">
              For security, set a new password before continuing. <Link to="/platform/security">Change password →</Link>
            </div>
          )}
          <Routes>
            <Route index element={<Overview />} />
            <Route path="organizations" element={<Orgs />} />
            <Route path="organizations/:orgId" element={<OrgDetail />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="users" element={<Users />} />
            <Route path="ai" element={<AiUsage />} />
            <Route path="email" element={<EmailOps />} />
            <Route path="support" element={<Support />} />
            <Route path="audit" element={<Audit />} />
            <Route path="plans" element={<Plans />} />
            <Route path="settings" element={<Settings />} />
            <Route path="security" element={<Security onDone={() => setMustChange(false)} />} />
            <Route path="*" element={<Navigate to="/platform" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

// ---- shared bits ----
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const run = useCallback(() => {
    setLoading(true); setErr(null)
    fn().then((d) => setData(d)).catch((e) => setErr(e.message)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(run, [run])
  return { data, err, loading, reload: run }
}
function KPI({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="pl-kpi">
      <span className="pl-kpi-l">{label}</span>
      <span className="pl-kpi-v">{value}</span>
      <span className="pl-kpi-s">{sub ?? ' '}</span>
    </div>
  )
}
function Tag({ s }: { s: string }) { return <span className={`gl-tag ${STATUS_TONE(s)}`}>{s}</span> }
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="pl-panel">
      <div className="pl-panel-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  )
}
function ErrBox({ err, retry }: { err: string; retry: () => void }) {
  return <div className="rp-error"><p>Could not load this section.</p><code className="rp-error-msg">{err}</code><button className="gl-btn ghost sm" onClick={retry}>Retry</button></div>
}
function fmtDate(v: unknown) { return v ? new Date(v as string).toLocaleDateString() : '—' }
function MiniBars({ points }: { points: { month: string; count: number }[] }) {
  if (points.length < 2) return <p className="pl-muted">Not enough history to chart.</p>
  const max = Math.max(1, ...points.map((p) => p.count))
  return (
    <div className="pl-bars">
      {points.map((p) => (
        <div className="pl-bar" key={p.month} title={`${p.month}: ${p.count}`}>
          <span style={{ height: `${(p.count / max) * 100}%` }} />
          <em>{p.month.slice(5)}</em>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// Global platform search
// ============================================================
function PlatformSearch() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<{ kind: string; label: string; sub: string; route: string }[]>([])
  const [open, setOpen] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return }
    const t = setTimeout(async () => {
      const [o, u] = await Promise.all([listOrgs('all', q), listUsers(q)])
      const orgHits = (Array.isArray(o) ? o : []).slice(0, 5).map((x) => ({ kind: 'Org', label: x.name, sub: x.plan, route: `/platform/organizations/${x.id}` }))
      const userHits = (Array.isArray(u) ? u : []).slice(0, 5).map((x) => ({ kind: 'User', label: String(x.name ?? x.email), sub: String(x.email ?? ''), route: '/platform/users' }))
      setRows([...orgHits, ...userHits])
      setOpen(true)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="pl-search">
      <input placeholder="Search organizations, users…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => rows.length && setOpen(true)} />
      {open && rows.length > 0 && (
        <>
          <div className="pl-search-back" onClick={() => setOpen(false)} />
          <div className="pl-search-menu">
            {rows.map((r, i) => (
              <button key={i} type="button" onClick={() => { setOpen(false); setQ(''); nav(r.route) }}>
                <span className="pl-search-kind">{r.kind}</span>
                <span className="pl-search-label">{r.label}</span>
                <span className="pl-search-sub">{r.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// Overview
// ============================================================
function Overview() {
  const { data, err, loading, reload } = useAsync<PlatformOverview>(getOverview, [])
  const [metric, setMetric] = useState<'orgs' | 'users'>('orgs')
  if (err) return <ErrBox err={err} retry={reload} />
  const d = data
  const conv = d && d.organizations > 0 ? Math.round((d.paid_organizations / d.organizations) * 100) : 0

  return (
    <>
      <div className="pl-head">
        <h1>Platform Overview</h1>
        <p>Monitor Bizzlivo organizations, subscriptions, usage and platform operations.</p>
      </div>

      <div className="pl-kpis">
        <KPI label="Organizations" value={loading ? '—' : d?.organizations} sub={d ? `+${d.new_orgs_month} this month` : ''} />
        <KPI label="Paid orgs" value={loading ? '—' : d?.paid_organizations} sub={d ? `${conv}% conversion` : ''} />
        <KPI label="Active orgs" value={loading ? '—' : d?.active_organizations} sub={d ? `${d.suspended_organizations} suspended` : ''} />
        <KPI label="Total users" value={loading ? '—' : d?.total_users?.toLocaleString()} sub={d ? `${d.active_users_7d} active (7d)` : ''} />
        <KPI label="MRR" value={loading ? '—' : naira(d?.mrr_kobo ?? 0)} sub={d ? `${d.subscriptions_active} active subs` : ''} />
        <KPI label="AI generations" value={loading ? '—' : d?.ai_generations_month} sub={d ? `${d.ai_questions_month} questions` : ''} />
      </div>

      <div className="pl-row2">
        <Panel title="Platform growth" action={
          <div className="pl-seg">
            <button className={metric === 'orgs' ? 'on' : ''} onClick={() => setMetric('orgs')}>Organizations</button>
            <button className={metric === 'users' ? 'on' : ''} onClick={() => setMetric('users')}>Users</button>
          </div>
        }>
          {loading || !d ? <p className="pl-muted">Loading…</p> : <MiniBars points={metric === 'orgs' ? d.org_growth : d.user_growth} />}
        </Panel>
        <Panel title="Subscription mix">
          {loading || !d ? <p className="pl-muted">Loading…</p> : (
            <div className="pl-mix">
              <div><strong>{d.plan_mix.free}</strong><span>Free</span></div>
              <div><strong>{d.plan_mix.growth}</strong><span>Growth</span></div>
              <div><strong>{d.plan_mix.business}</strong><span>Business</span></div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Needs Attention">
        {loading || !d ? <p className="pl-muted">Loading…</p> : d.attention.length === 0 ? (
          <p className="pl-muted">Nothing needs intervention right now.</p>
        ) : (
          <div className="pl-attn">
            {d.attention.map((a, i) => (
              <div key={i} className="pl-attn-row">
                <span className="pl-attn-n">{a.count}</span>
                <span className="pl-attn-t">{a.text}</span>
                <Link to={a.route} className="gl-btn ghost sm">View</Link>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent organizations" action={<Link to="/platform/organizations" className="pl-link">All organizations →</Link>}>
        {loading || !d ? <p className="pl-muted">Loading…</p> : (
          <div className="rp-table-wrap"><table className="rp-table">
            <thead><tr><th>Organization</th><th>Owner</th><th>Plan</th><th>Members</th><th>Status</th><th>Created</th><th>Last active</th></tr></thead>
            <tbody>
              {d.recent_orgs.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/platform/organizations/${o.id}`}>{o.name}</Link></td>
                  <td className="rp-dim">{o.owner ?? '—'}</td>
                  <td className="rp-dim">{o.plan}</td>
                  <td className="rp-dim">{o.members}</td>
                  <td><Tag s={o.status} /></td>
                  <td className="rp-dim">{fmtDate(o.created_at)}</td>
                  <td className="rp-dim">{fmtDate(o.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Platform activity">
        {loading || !d ? <p className="pl-muted">Loading…</p> : d.recent_activity.length === 0 ? <p className="pl-muted">No activity.</p> : (
          <ul className="pl-feed">
            {d.recent_activity.map((a, i) => <li key={i}><span>{a.summary}</span><em>{fmtDate(a.created_at)}</em></li>)}
          </ul>
        )}
      </Panel>
    </>
  )
}

// ============================================================
// Organizations
// ============================================================
function Orgs() {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const { data, err, loading, reload } = useAsync<PlatformOrgRow[]>(() => listOrgs(filter, q), [filter])
  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : []
    if (!q.trim()) return list
    const n = q.toLowerCase()
    return list.filter((o) => o.name.toLowerCase().includes(n) || (o.owner_email ?? '').toLowerCase().includes(n) || (o.owner_name ?? '').toLowerCase().includes(n))
  }, [data, q])

  if (err) return <ErrBox err={err} retry={reload} />
  return (
    <>
      <div className="pl-head"><h1>Organizations</h1><p>Every office using Bizzlivo.</p></div>
      <div className="pl-filters">
        {['all', 'free', 'growth', 'business', 'active', 'suspended', 'past_due'].map((f) => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f.replace('_', ' ')}</button>
        ))}
        <input className="net-search" placeholder="Search name / owner / email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Organization</th><th>Owner</th><th>Plan</th><th>Members</th><th>AI (mo)</th><th>Status</th><th>Created</th><th>Last active</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} className="rp-dim">No organizations match.</td></tr> : rows.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/platform/organizations/${o.id}`}>{o.name}</Link>{o.has_override && <span className="pl-ovr">override</span>}</td>
                <td className="rp-dim">{o.owner_name ?? '—'}<br /><span className="pl-tiny">{o.owner_email ?? ''}</span></td>
                <td className="rp-dim">{o.plan}</td>
                <td className="rp-dim">{o.members}</td>
                <td className="rp-dim">{o.ai_month}</td>
                <td><Tag s={o.status} /></td>
                <td className="rp-dim">{fmtDate(o.created_at)}</td>
                <td className="rp-dim">{fmtDate(o.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ============================================================
// Organization detail
// ============================================================
function OrgDetail() {
  const { orgId } = useParams<{ orgId: string }>()
  const [tab, setTab] = useState('overview')
  const { data, err, loading, reload } = useAsync<Record<string, unknown>>(() => getOrgDetail(orgId!), [orgId])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (err) return <ErrBox err={err} retry={reload} />
  if (loading || !data) return <p className="empty-row">Loading…</p>
  const org = (data.org ?? {}) as Record<string, unknown>
  const owner = (data.owner ?? {}) as Record<string, string>
  const usage = (data.usage ?? {}) as Record<string, number>
  const override = data.override as Record<string, unknown> | null
  const sub = data.subscription as Record<string, unknown> | null
  const status = String(org.status ?? 'active')

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true); setMsg(null)
    const { error } = await fn()
    setBusy(false)
    setMsg(error ? error.message : ok)
    if (!error) reload()
  }

  return (
    <>
      <Link to="/platform/organizations" className="pl-link">← Organizations</Link>
      <div className="pl-head" style={{ marginTop: 8 }}>
        <h1>{String(org.name)}</h1>
        <p>{String(org.slug)} · <Tag s={status} /> · {String(owner.name ?? 'no owner')} ({String(owner.email ?? '—')})</p>
      </div>
      {msg && <p className="form-info">{msg}</p>}

      <div className="rp-tabs">
        {['overview', 'members', 'subscription', 'usage', 'activity', 'support', 'audit'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="pl-kpis">
            <KPI label="Plan" value={String(org.plan_tier)} sub={override ? `override of ${String(override.original_plan)}` : ''} />
            <KPI label="Members" value={usage.members ?? 0} sub={usage.max_members != null ? `limit ${usage.max_members}` : 'unlimited'} />
            <KPI label="AI this month" value={usage.ai_generations ?? 0} sub={`limit ${usage.ai_limit ?? '—'}`} />
            <KPI label="Published exams" value={usage.published_exams ?? 0} />
            <KPI label="Created" value={fmtDate(org.created_at)} />
            <KPI label="Base currency" value={String(org.base_currency ?? '—')} />
          </div>
          <Panel title="Actions">
            <div className="pl-actions">
              {status === 'active'
                ? <ReasonAction label="Suspend organization" danger busy={busy} onSubmit={(r) => act(() => setOrgStatus(orgId!, 'suspended', r), 'Organization suspended.')} />
                : <ReasonAction label="Reactivate organization" busy={busy} onSubmit={(r) => act(() => setOrgStatus(orgId!, 'active', r), 'Organization reactivated.')} />}
              <PlanOverrideAction orgId={orgId!} current={String(org.plan_tier)} hasOverride={!!override} busy={busy} onDone={reload} setMsg={setMsg} />
              {sub && <ReasonAction label="Extend trial 14 days" busy={busy} onSubmit={(r) => act(() => extendTrial(orgId!, 14, r), 'Trial extended.')} />}
            </div>
          </Panel>
        </>
      )}

      {tab === 'members' && (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
          <tbody>{((data.members ?? []) as Record<string, unknown>[]).map((m, i) => (
            <tr key={i}><td>{String(m.name)}</td><td className="rp-dim">{String(m.email)}</td><td className="rp-dim">{String(m.role)}</td><td><Tag s={String(m.status)} /></td><td className="rp-dim">{fmtDate(m.joined_at)}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      {tab === 'subscription' && (
        sub ? (
          <ul className="pl-kv">
            {Object.entries(sub).map(([k, v]) => <li key={k}><span>{k}</span><strong>{String(v ?? '—')}</strong></li>)}
          </ul>
        ) : <p className="empty-row">No subscription record — this office is on the default plan.</p>
      )}

      {tab === 'usage' && (
        <ul className="pl-kv">{Object.entries(usage).map(([k, v]) => <li key={k}><span>{k}</span><strong>{String(v)}</strong></li>)}</ul>
      )}

      {tab === 'activity' && (
        <ul className="pl-feed">{((data.activity ?? []) as Record<string, unknown>[]).map((a, i) => <li key={i}><span>{String(a.summary)}</span><em>{fmtDate(a.created_at)}</em></li>)}
          {((data.activity ?? []) as unknown[]).length === 0 && <li><span className="pl-muted">No activity.</span></li>}
        </ul>
      )}

      {tab === 'support' && (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Subject</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{((data.support ?? []) as Record<string, unknown>[]).map((t, i) => (
            <tr key={i}><td>{String(t.subject)}</td><td className="rp-dim">{String(t.priority)}</td><td><Tag s={String(t.status)} /></td><td className="rp-dim">{fmtDate(t.created_at)}</td></tr>
          ))}
          {((data.support ?? []) as unknown[]).length === 0 && <tr><td colSpan={4} className="rp-dim">No tickets.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'audit' && (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Action</th><th>Actor</th><th>When</th><th>Detail</th></tr></thead>
          <tbody>{((data.audit ?? []) as Record<string, unknown>[]).map((a, i) => (
            <tr key={i}><td>{String(a.action)}</td><td className="rp-dim">{String(a.actor ?? '—')}</td><td className="rp-dim">{fmtDate(a.created_at)}</td><td className="rp-dim pl-json">{JSON.stringify(a.metadata)}</td></tr>
          ))}
          {((data.audit ?? []) as unknown[]).length === 0 && <tr><td colSpan={4} className="rp-dim">No audit entries.</td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  )
}

function ReasonAction({ label, danger, busy, onSubmit }: { label: string; danger?: boolean; busy: boolean; onSubmit: (reason: string) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (!open) return <button className={`gl-btn ghost sm ${danger ? 'danger' : ''}`} onClick={() => setOpen(true)}>{label}</button>
  return (
    <span className="pl-reason">
      <input placeholder="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className={`gl-btn sm ${danger ? 'danger' : ''}`} disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())}>Confirm</button>
      <button className="gl-btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}
function PlanOverrideAction({ orgId, current, hasOverride, busy, onDone, setMsg }: {
  orgId: string; current: string; hasOverride: boolean; busy: boolean; onDone: () => void; setMsg: (m: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState(current === 'free' ? 'growth' : 'business')
  const [reason, setReason] = useState('')
  const [expires, setExpires] = useState('')
  if (hasOverride) {
    return <button className="gl-btn ghost sm" disabled={busy} onClick={async () => { const { error } = await clearPlanOverride(orgId); setMsg(error ? error.message : 'Override cleared.'); if (!error) onDone() }}>Clear plan override</button>
  }
  if (!open) return <button className="gl-btn ghost sm" onClick={() => setOpen(true)}>Override plan</button>
  return (
    <span className="pl-reason">
      <select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="free">free</option><option value="growth">growth</option><option value="business">business</option></select>
      <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      <button className="gl-btn sm" disabled={busy || !reason.trim()} onClick={async () => {
        const { error } = await setPlanOverride(orgId, plan, reason.trim(), expires ? new Date(expires).toISOString() : null)
        setMsg(error ? error.message : `Plan overridden to ${plan}.`); if (!error) { setOpen(false); onDone() }
      }}>Apply</button>
      <button className="gl-btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}

// ============================================================
// Subscriptions
// ============================================================
function Subscriptions() {
  const [filter, setFilter] = useState('all')
  const { data, err, loading, reload } = useAsync<Record<string, unknown>[]>(() => listSubscriptions(filter), [filter])
  if (err) return <ErrBox err={err} retry={reload} />
  const rows = Array.isArray(data) ? data : []
  return (
    <>
      <div className="pl-head"><h1>Subscriptions</h1><p>Billing state across every organization.</p></div>
      <div className="pl-filters">
        {['all', 'free', 'growth', 'business', 'active', 'past_due', 'cancelled'].map((f) => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Cycle</th><th>Amount</th><th>Provider</th><th>Next billing</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="rp-dim">No subscriptions. Every office is on the default free plan.</td></tr> : rows.map((s, i) => (
              <tr key={i}>
                <td><Link to={`/platform/organizations/${s.org_id}`}>{String(s.org)}</Link></td>
                <td className="rp-dim">{String(s.plan)}</td>
                <td><Tag s={String(s.status)} /></td>
                <td className="rp-dim">{String(s.billing_cycle ?? '—')}</td>
                <td className="rp-dim">{s.amount_kobo ? naira(s.amount_kobo as number) : '—'}</td>
                <td className="rp-dim">{String(s.provider ?? '—')}</td>
                <td className="rp-dim">{fmtDate(s.current_period_end)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ============================================================
// Users
// ============================================================
function Users() {
  const [q, setQ] = useState('')
  const { data, err, loading, reload } = useAsync<Record<string, unknown>[]>(() => listUsers(''), [])
  if (err) return <ErrBox err={err} retry={reload} />
  const all = Array.isArray(data) ? data : []
  const rows = q.trim() ? all.filter((u) => `${u.name} ${u.email} ${u.org}`.toLowerCase().includes(q.toLowerCase())) : all
  return (
    <>
      <div className="pl-head"><h1>Users</h1><p>{all.length} accounts across all organizations.</p></div>
      <input className="net-search" placeholder="Search name / email / org…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300, marginBottom: 14 }} />
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Name</th><th>Email</th><th>Organization</th><th>Office role</th><th>Platform role</th><th>Status</th><th>Joined</th><th>Last active</th></tr></thead>
          <tbody>
            {rows.slice(0, 200).map((u, i) => (
              <tr key={i}>
                <td>{String(u.name ?? '—')}</td>
                <td className="rp-dim">{String(u.email ?? '—')}</td>
                <td className="rp-dim">{u.org_id ? <Link to={`/platform/organizations/${u.org_id}`}>{String(u.org)}</Link> : '—'}</td>
                <td className="rp-dim">{String(u.office_role ?? '—')}</td>
                <td className="rp-dim">{u.platform_role ? <span className="gl-tag blue">{String(u.platform_role)}</span> : '—'}</td>
                <td><Tag s={String(u.membership_status ?? 'none')} /></td>
                <td className="rp-dim">{fmtDate(u.created_at)}</td>
                <td className="rp-dim">{fmtDate(u.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ============================================================
// AI usage
// ============================================================
function AiUsage() {
  const { data, err, loading, reload } = useAsync<Record<string, unknown>[]>(getAiUsage, [])
  if (err) return <ErrBox err={err} retry={reload} />
  const rows = Array.isArray(data) ? data : []
  const totalGen = rows.reduce((s, r) => s + Number(r.generations || 0), 0)
  const totalQ = rows.reduce((s, r) => s + Number(r.questions || 0), 0)
  const over = rows.filter((r) => r.gen_limit != null && Number(r.generations) >= Number(r.gen_limit))
  return (
    <>
      <div className="pl-head"><h1>AI Usage</h1><p>Current calendar month, per organization.</p></div>
      <div className="pl-kpis">
        <KPI label="Generations (mo)" value={loading ? '—' : totalGen} />
        <KPI label="Questions (mo)" value={loading ? '—' : totalQ.toLocaleString()} />
        <KPI label="Orgs at/over limit" value={loading ? '—' : over.length} />
      </div>
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Organization</th><th>Plan</th><th>Generations</th><th>Limit</th><th>Usage</th><th>Questions</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const pct = r.gen_limit ? Math.round((Number(r.generations) / Number(r.gen_limit)) * 100) : 0
            return (
              <tr key={i}>
                <td><Link to={`/platform/organizations/${r.org_id}`}>{String(r.org)}</Link></td>
                <td className="rp-dim">{String(r.plan)}</td>
                <td className="rp-dim">{String(r.generations)}</td>
                <td className="rp-dim">{String(r.gen_limit ?? '∞')}</td>
                <td className={pct >= 100 ? 'bad' : 'rp-dim'}>{r.gen_limit ? `${pct}%` : '—'}</td>
                <td className="rp-dim">{String(r.questions)}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
    </>
  )
}

// ============================================================
// Email ops
// ============================================================
function EmailOps() {
  const { data, err, loading, reload } = useAsync(getEmailStats, [])
  if (err) return <ErrBox err={err} retry={reload} />
  const d = data
  return (
    <>
      <div className="pl-head"><h1>Email</h1><p>Transactional delivery via Resend (outbox + send log).</p></div>
      <div className="pl-kpis">
        <KPI label="Sent" value={loading ? '—' : d?.sent} />
        <KPI label="Failed" value={loading ? '—' : d?.failed} />
        <KPI label="Pending in outbox" value={loading ? '—' : d?.pending} />
      </div>
      {loading ? <p className="empty-row">Loading…</p> : (d?.recent?.length ?? 0) === 0 ? (
        <p className="empty-row">No email has been logged yet.</p>
      ) : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Recipient</th><th>Org</th><th>Type</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>{d!.recent.map((e, i) => (
            <tr key={i}>
              <td className="rp-dim">{String(e.recipient)}</td>
              <td className="rp-dim">{String(e.org ?? '—')}</td>
              <td className="rp-dim">{String(e.type)}</td>
              <td><Tag s={String(e.status)} /></td>
              <td className="rp-dim">{fmtDate(e.created_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  )
}

// ============================================================
// Support
// ============================================================
function Support() {
  const { data, err, loading, reload } = useAsync<Record<string, unknown>[]>(getSupport, [])
  const [status, setStatus] = useState('all')
  if (err) return <ErrBox err={err} retry={reload} />
  const all = Array.isArray(data) ? data : []
  const rows = status === 'all' ? all : all.filter((t) => t.status === status)
  return (
    <>
      <div className="pl-head"><h1>Support</h1><p>Tickets from every organization.</p></div>
      <div className="pl-filters">
        {['all', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
          <button key={s} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{s.replace('_', ' ')}</button>
        ))}
      </div>
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Subject</th><th>Organization</th><th>User</th><th>Category</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="rp-dim">No tickets.</td></tr> : rows.map((t, i) => (
              <tr key={i}>
                <td>{String(t.subject)}{t.admin_note ? <span className="pl-tiny"> · replied</span> : ''}</td>
                <td className="rp-dim">{String(t.org)}</td>
                <td className="rp-dim">{String(t.user)}</td>
                <td className="rp-dim">{String(t.category)}</td>
                <td className="rp-dim">{String(t.priority)}</td>
                <td><Tag s={String(t.status)} /></td>
                <td className="rp-dim">{fmtDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="pl-muted" style={{ marginTop: 10 }}>Platform admins have read visibility here. Ticket replies are handled by the office admin in that org’s Help &amp; Support console.</p>
    </>
  )
}

// ============================================================
// Audit
// ============================================================
function Audit() {
  const [q, setQ] = useState('')
  const { data, err, loading, reload } = useAsync<Record<string, unknown>[]>(() => getAudit(''), [])
  if (err) return <ErrBox err={err} retry={reload} />
  const all = Array.isArray(data) ? data : []
  const rows = q.trim() ? all.filter((a) => `${a.action} ${a.actor} ${a.org}`.toLowerCase().includes(q.toLowerCase())) : all
  return (
    <>
      <div className="pl-head"><h1>Audit</h1><p>Platform-wide record of privileged actions.</p></div>
      <input className="net-search" placeholder="Filter by action / actor / org…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300, marginBottom: 14 }} />
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="rp-table-wrap"><table className="rp-table">
          <thead><tr><th>Action</th><th>Actor</th><th>Organization</th><th>When</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.slice(0, 150).map((a, i) => (
              <tr key={i}>
                <td>{String(a.action)}</td>
                <td className="rp-dim">{String(a.actor ?? '—')}</td>
                <td className="rp-dim">{String(a.org ?? '—')}</td>
                <td className="rp-dim">{new Date(a.created_at as string).toLocaleString()}</td>
                <td className="rp-dim pl-json">{JSON.stringify(a.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ============================================================
// Plans
// ============================================================
function Plans() {
  const { data, err, loading, reload } = useAsync(async () => { const { data } = await getPlans(); return (data ?? []) as Record<string, unknown>[] }, [])
  if (err) return <ErrBox err={err} retry={reload} />
  const rows = data ?? []
  return (
    <>
      <div className="pl-head"><h1>Plans &amp; Entitlements</h1><p>The single source of truth is <code>plan_limits</code>. Prices are read from there.</p></div>
      {loading ? <p className="empty-row">Loading…</p> : (
        <div className="pl-plans">
          {rows.map((p) => (
            <div className="pl-plan" key={String(p.plan)}>
              <h3>{String(p.plan)}</h3>
              <div className="pl-plan-price">{naira(Number(p.price_monthly_kobo))}<span>/mo</span></div>
              <div className="pl-plan-price sm">{naira(Number(p.price_yearly_kobo))}<span>/yr</span></div>
              <ul>
                <li>Members: {String(p.max_members ?? '∞')}</li>
                <li>Admins: {String(p.max_admins ?? '∞')}</li>
                <li>Published exams: {String(p.max_published_exams ?? '∞')}</li>
                <li>AI generations/mo: {String(p.ai_exam_generations_per_month)}</li>
                <li>AI questions/mo: {String(p.ai_questions_per_month)}</li>
                <li>Reports: {String(p.reports_level ?? '—')}</li>
                <li>Removes badge: {p.removes_badge ? 'yes' : 'no'}</li>
                <li>Custom branding: {p.custom_branding ? 'yes' : 'no'}</li>
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="pl-muted" style={{ marginTop: 12 }}>Editing plan pricing/limits is done directly in <code>plan_limits</code> (a migration), not here — this view is read-only so the frontend can’t become the pricing source of truth.</p>
    </>
  )
}

// ============================================================
// Settings
// ============================================================
function Settings() {
  const { data, loading, reload } = useAsync(getPlatformSettings, [])
  const [signup, setSignup] = useState(true)
  const [maint, setMaint] = useState(false)
  const [supportEmail, setSupportEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (data) { setSignup(data.signup_enabled); setMaint(data.maintenance_mode); setSupportEmail(data.support_email ?? '') }
  }, [data])
  async function save() {
    const { error } = await savePlatformSettings(signup, maint, supportEmail)
    setMsg(error ? error.message : 'Saved.')
    if (!error) reload()
  }
  if (loading) return <p className="empty-row">Loading…</p>
  return (
    <>
      <div className="pl-head"><h1>Platform Settings</h1><p>Only settings that are actually wired into the app.</p></div>
      {msg && <p className="form-info">{msg}</p>}
      <div className="ns-list" style={{ maxWidth: 520 }}>
        <label className="ns-row"><span><strong>Signup enabled</strong><span className="ns-help">Allow new offices to register.</span></span><input type="checkbox" checked={signup} onChange={(e) => setSignup(e.target.checked)} /></label>
        <label className="ns-row"><span><strong>Maintenance mode</strong><span className="ns-help">Show a maintenance notice; blocks non-platform sign-ins.</span></span><input type="checkbox" checked={maint} onChange={(e) => setMaint(e.target.checked)} /></label>
      </div>
      <label style={{ display: 'block', maxWidth: 520, marginTop: 16 }}>Support email<input value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@bizzlivo.com" /></label>
      <button className="gl-btn" style={{ marginTop: 14 }} onClick={save}>Save settings</button>
      <p className="pl-muted" style={{ marginTop: 10 }}>Wiring the toggles into signup / the app shell is a follow-up; the values are stored and audited now.</p>
    </>
  )
}

// ============================================================
// Security
// ============================================================
function Security({ onDone }: { onDone: () => void }) {
  const { session } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function change(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 10) return setMsg({ ok: false, t: 'Use at least 10 characters for a platform account.' })
    if (pw !== pw2) return setMsg({ ok: false, t: 'Passwords don’t match.' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (!error) await platformClearMustChange()
    setBusy(false)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'Password updated.' })
    if (!error) { setPw(''); setPw2(''); onDone() }
  }

  return (
    <>
      <div className="pl-head"><h1>Security</h1><p>This account has platform-wide access — keep it locked down.</p></div>
      <ul className="pl-kv" style={{ maxWidth: 480 }}>
        <li><span>Account</span><strong>{session?.user?.email}</strong></li>
        <li><span>Last sign-in</span><strong>{session?.user?.last_sign_in_at ? new Date(session.user.last_sign_in_at).toLocaleString() : '—'}</strong></li>
      </ul>
      {msg && <p className={msg.ok ? 'form-info' : 'form-error'}>{msg.t}</p>}
      <form className="sec-block" onSubmit={change} style={{ maxWidth: 480 }}>
        <h3>Change password</h3>
        <label>New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <label>Confirm<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
        <button type="submit" className="gl-btn ghost sm" disabled={busy || !pw}>Update password</button>
      </form>
      <div className="sec-block" style={{ maxWidth: 480 }}>
        <h3>Sessions</h3>
        <p className="sec-cur">End every other signed-in session for this account.</p>
        <button type="button" className="gl-btn ghost sm danger" onClick={async () => { await supabase.auth.signOut({ scope: 'others' }); setMsg({ ok: true, t: 'Other sessions signed out.' }) }}>Sign out other sessions</button>
      </div>
    </>
  )
}
