import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { KIND_ICON, resourceKind } from '../../lib/resourceKind'
import {
  areaDef,
  loadMemberCtx,
  loadSectionModules,
  loadSections,
  moduleProgress,
  type MemberCtx,
  type ModuleWithItems,
  type Section,
} from '../../lib/learningCenter'
import type { LearningArea, NetworkMarketingProduct, Resource } from '../../types/database'
import OnboardingMember from '../growth/onboarding/OnboardingMember'

function ClassesAreaView({ area }: { area: LearningArea }) {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id

  const [sections, setSections] = useState<{ section: Section; modules: ModuleWithItems[] }[]>([])
  const [ctx, setCtx] = useState<MemberCtx | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!orgId || !profile) return
    setLoading(true)
    const [secs, memberCtx] = await Promise.all([loadSections(orgId, area), loadMemberCtx(orgId, profile.id)])
    const published = secs.filter((s) => s.status === 'published')
    const withMods = await Promise.all(
      published.map(async (section) => ({ section, modules: await loadSectionModules(orgId, section.id, true) })),
    )
    setSections(withMods)
    setCtx(memberCtx)
    setLoading(false)
  }, [orgId, profile, area])

  useEffect(() => {
    reload()
  }, [reload])

  if (loading || !ctx) return <p className="md-muted">Loading…</p>
  if (sections.every((s) => s.modules.length === 0)) {
    return <p className="empty-row">Your office hasn't published anything here yet — check back soon.</p>
  }

  return (
    <div className="lc-member-sections">
      {sections.map(({ section, modules }) =>
        modules.length === 0 ? null : (
          <div key={section.id} className="lc-member-section">
            <h3 className="lc-member-section-title">{section.title}</h3>
            {section.description && <p className="md-muted" style={{ margin: '2px 0 10px' }}>{section.description}</p>}
            {modules.map((mod) => {
              const p = moduleProgress(mod, ctx)
              return (
                <Link to={`/training/classes/${section.id}`} className="lc-member-module" key={mod.id}>
                  <span className={`lc-member-check ${p.complete ? 'done' : ''}`}>
                    {p.complete && <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                  <span className="lc-member-module-body">
                    <span className="lc-member-module-title">{mod.title}</span>
                    <span className="lc-member-module-meta">
                      {mod.items.map((it) => it.type === 'test' || it.type === 'quiz' ? 'Quiz' : it.type[0].toUpperCase() + it.type.slice(1)).join(' • ') || 'No content'}
                    </span>
                  </span>
                  <span className="lc-member-module-prog">{p.done}/{p.total}</span>
                </Link>
              )
            })}
          </div>
        ),
      )}
    </div>
  )
}

function ProductsView() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [products, setProducts] = useState<NetworkMarketingProduct[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [examTokens, setExamTokens] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const { data: prods } = await supabase.from('network_marketing_products').select('*').eq('org_id', orgId).eq('is_active', true).order('order_index')
      const rows = (prods as NetworkMarketingProduct[]) ?? []
      setProducts(rows)
      const resIds = rows.flatMap((p) => [p.video_resource_id, p.pdf_resource_id].filter(Boolean) as string[])
      const examIds = rows.map((p) => p.exam_id).filter(Boolean) as string[]
      const [{ data: res }, { data: ex }] = await Promise.all([
        resIds.length ? supabase.from('resources').select('*').in('id', resIds) : Promise.resolve({ data: [] as Resource[] }),
        examIds.length ? supabase.from('exams').select('id, public_token').in('id', examIds) : Promise.resolve({ data: [] as { id: string; public_token: string }[] }),
      ])
      const u = new Map<string, string>()
      for (const r of (res as Resource[]) ?? []) {
        if (r.file_type === 'pdf') {
          const { data } = await supabase.storage.from('resources').createSignedUrl(r.file_url, 3600)
          if (data?.signedUrl) u.set(r.id, data.signedUrl)
        } else u.set(r.id, r.file_url)
      }
      setUrls(u)
      setExamTokens(new Map(((ex as { id: string; public_token: string }[]) ?? []).map((e) => [e.id, e.public_token])))
      setLoading(false)
    })()
  }, [orgId])

  if (loading) return <p className="md-muted">Loading…</p>
  if (products.length === 0) return <p className="empty-row">No products yet.</p>

  return (
    <div className="lc-member-sections">
      {products.map((p) => (
        <div className="res-card" key={p.id} style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{p.name}</h3>
          {p.description && <p className="md-muted" style={{ margin: '4px 0 10px' }}>{p.description}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {p.video_resource_id && urls.get(p.video_resource_id) && <a className="md-btn ghost sm" href={urls.get(p.video_resource_id)} target="_blank" rel="noreferrer">Watch video</a>}
            {p.pdf_resource_id && urls.get(p.pdf_resource_id) && <a className="md-btn ghost sm" href={urls.get(p.pdf_resource_id)} target="_blank" rel="noreferrer">Open PDF</a>}
            {p.exam_id && examTokens.get(p.exam_id) && <Link className="md-btn ghost sm" to={`/take/${examTokens.get(p.exam_id)}`}>Take quiz</Link>}
            {p.link_url && <a className="md-btn ghost sm" href={p.link_url} target="_blank" rel="noreferrer">Learn more</a>}
          </div>
        </div>
      ))}
    </div>
  )
}

function PdLibraryView() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [resources, setResources] = useState<Resource[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [filter, setFilter] = useState<'all' | 'pdf' | 'podcast' | 'video'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const { data: links } = await supabase.from('personal_development_resources').select('resource_id').eq('org_id', orgId)
      const ids = ((links as { resource_id: string }[]) ?? []).map((r) => r.resource_id)
      if (ids.length === 0) { setResources([]); setLoading(false); return }
      const { data } = await supabase.from('resources').select('*').in('id', ids).order('title')
      const rows = (data as Resource[]) ?? []
      setResources(rows)
      const u = new Map<string, string>()
      for (const r of rows) {
        if (r.file_type === 'pdf') {
          const { data: s } = await supabase.storage.from('resources').createSignedUrl(r.file_url, 3600)
          if (s?.signedUrl) u.set(r.id, s.signedUrl)
        } else u.set(r.id, r.file_url)
      }
      setUrls(u)
      setLoading(false)
    })()
  }, [orgId])

  if (loading) return <p className="md-muted">Loading…</p>
  const visible = filter === 'all' ? resources : resources.filter((r) => resourceKind(r) === filter)

  return (
    <div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {(['all', 'pdf', 'podcast', 'video'] as const).map((k) => (
          <button key={k} type="button" className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
            {k === 'all' ? 'All' : k === 'pdf' ? 'Books & PDFs' : k === 'podcast' ? 'Podcasts' : 'Videos'}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="empty-row">Nothing here yet.</p>
      ) : (
        visible.map((r) => (
          <div className="res-card" key={r.id} style={{ marginBottom: 8 }}>
            <div className="res-top">
              <div className="res-left">
                <div className="res-icon">{KIND_ICON[resourceKind(r)]}</div>
                <div className="res-title-block"><h3>{r.title}</h3></div>
              </div>
              {urls.get(r.id) && <a className="md-btn ghost sm" href={urls.get(r.id)} target="_blank" rel="noreferrer">Open →</a>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default function MemberArea({ areaKey }: { areaKey: string }) {
  const def = areaDef(areaKey)
  const [tab, setTab] = useState(0)
  if (!def) return <div className="page lc"><p className="empty-row">Unknown area.</p></div>

  return (
    <div className="page lc">
      <div className="lc-head">
        <Link to="/training" className="dash-see-all">← Learning Center</Link>
        <h1>{def.label}</h1>
        <p>{def.blurb}</p>
      </div>

      {def.tabs && (
        <div className="view-tabs" style={{ marginBottom: 20 }}>
          {def.tabs.map((t, i) => (
            <button key={t} type="button" className={`view-tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>
      )}

      {areaKey === 'onboarding' && <OnboardingMember />}
      {areaKey === 'freelancing' && <ClassesAreaView area="freelancing" />}
      {areaKey === 'income_development' && <ClassesAreaView area="income_development" />}
      {areaKey === 'network_marketing' && (tab === 0 ? <ClassesAreaView area="network_marketing" /> : <ProductsView />)}
      {areaKey === 'personal_development' && (tab === 0 ? <ClassesAreaView area="personal_development" /> : <PdLibraryView />)}
    </div>
  )
}
