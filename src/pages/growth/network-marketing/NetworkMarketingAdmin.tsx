import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { NetworkMarketingBasic, NetworkMarketingContact, NetworkMarketingProduct } from '../../../types/database'

const TABS = ['NeoLife Basics', 'Products', 'Member Progress'] as const
type Tab = (typeof TABS)[number]

interface MemberRow {
  userId: string
  fullName: string
  total: number
  wonCustomers: number
  wonDistributors: number
  inProgress: number
}

export default function NetworkMarketingAdmin() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const [tab, setTab] = useState<Tab>('NeoLife Basics')

  const [basics, setBasics] = useState<NetworkMarketingBasic[]>([])
  const [basicsLoading, setBasicsLoading] = useState(true)
  const [basicsBusyId, setBasicsBusyId] = useState<string | null>(null)
  const [basicsError, setBasicsError] = useState<string | null>(null)

  const [basicTitle, setBasicTitle] = useState('')
  const [basicDescription, setBasicDescription] = useState('')
  const [basicLinkUrl, setBasicLinkUrl] = useState('')
  const [addingBasic, setAddingBasic] = useState(false)

  const [products, setProducts] = useState<NetworkMarketingProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [adding, setAdding] = useState(false)

  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(true)

  async function loadBasics(org: string) {
    setBasicsLoading(true)
    const { data } = await supabase.from('network_marketing_basics').select('*').eq('org_id', org).order('created_at')
    setBasics((data as NetworkMarketingBasic[]) ?? [])
    setBasicsLoading(false)
  }

  async function loadProducts(org: string) {
    setLoading(true)
    const { data } = await supabase.from('network_marketing_products').select('*').eq('org_id', org).order('name')
    setProducts((data as NetworkMarketingProduct[]) ?? [])
    setLoading(false)
  }

  async function loadMembers(org: string) {
    setMembersLoading(true)
    const [membershipsRes, contactsRes] = await Promise.all([
      supabase.from('memberships').select('user_id, profile:profiles(full_name)').eq('org_id', org).eq('status', 'active'),
      supabase.from('network_marketing_contacts').select('user_id, stage').eq('org_id', org),
    ])
    const contacts = (contactsRes.data as Pick<NetworkMarketingContact, 'user_id' | 'stage'>[]) ?? []
    const byUser = new Map<string, Pick<NetworkMarketingContact, 'user_id' | 'stage'>[]>()
    for (const c of contacts) {
      const list = byUser.get(c.user_id) ?? []
      list.push(c)
      byUser.set(c.user_id, list)
    }
    const rows: MemberRow[] = ((membershipsRes.data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? []).map((m) => {
      const list = byUser.get(m.user_id) ?? []
      const wonCustomers = list.filter((c) => c.stage === 'won_customer').length
      const wonDistributors = list.filter((c) => c.stage === 'won_distributor').length
      const lost = list.filter((c) => c.stage === 'lost').length
      return {
        userId: m.user_id,
        fullName: m.profile?.full_name ?? 'Unknown',
        total: list.length,
        wonCustomers,
        wonDistributors,
        inProgress: list.length - wonCustomers - wonDistributors - lost,
      }
    })
    setMembers(rows)
    setMembersLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    loadBasics(orgId)
    loadProducts(orgId)
    loadMembers(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addBasic(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !basicTitle.trim()) return
    setAddingBasic(true)
    setBasicsError(null)
    const { error: insertError } = await supabase.from('network_marketing_basics').insert({
      org_id: orgId,
      title: basicTitle.trim(),
      description: basicDescription.trim() || null,
      link_url: basicLinkUrl.trim() || null,
      added_by: profile.id,
    })
    setAddingBasic(false)
    if (insertError) {
      setBasicsError(insertError.message)
      return
    }
    setBasicTitle('')
    setBasicDescription('')
    setBasicLinkUrl('')
    await loadBasics(orgId)
  }

  async function removeBasic(basic: NetworkMarketingBasic) {
    if (!orgId) return
    setBasicsBusyId(basic.id)
    const { error: deleteError } = await supabase.from('network_marketing_basics').delete().eq('id', basic.id)
    setBasicsBusyId(null)
    if (deleteError) setBasicsError(deleteError.message)
    else await loadBasics(orgId)
  }

  async function addProduct(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !name.trim()) return
    setAdding(true)
    setError(null)
    const { error: insertError } = await supabase.from('network_marketing_products').insert({
      org_id: orgId,
      name: name.trim(),
      description: description.trim() || null,
      link_url: linkUrl.trim() || null,
      added_by: profile.id,
    })
    setAdding(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setName('')
    setDescription('')
    setLinkUrl('')
    await loadProducts(orgId)
  }

  async function removeProduct(product: NetworkMarketingProduct) {
    if (!orgId) return
    setBusyId(product.id)
    const { error: deleteError } = await supabase.from('network_marketing_products').delete().eq('id', product.id)
    setBusyId(null)
    if (deleteError) setError(deleteError.message)
    else await loadProducts(orgId)
  }

  return (
    <div>
      <div className="view-tabs" style={{ marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={`view-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'NeoLife Basics' ? (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
            The foundational NeoLife training curriculum your members work through — e.g. Sound Health, Cool Wealth, Fact About Life.
          </p>
          {basicsError && <p className="form-error">{basicsError}</p>}

          <h4 className="overview-heading">RESOURCES ({basics.length})</h4>
          {basicsLoading ? (
            <p className="empty-row">Loading…</p>
          ) : basics.length === 0 ? (
            <p className="empty-row">Nothing added yet — add one below.</p>
          ) : (
            basics.map((b) => (
              <div className="res-card" key={b.id} style={{ marginBottom: 8 }}>
                <div className="res-top">
                  <div className="res-title-block">
                    <h3>{b.title}</h3>
                    {b.description && <p style={{ color: 'var(--text-dim)', margin: '4px 0' }}>{b.description}</p>}
                    {b.link_url && <a href={b.link_url} target="_blank" rel="noreferrer">View →</a>}
                  </div>
                  <button type="button" className="secondary" onClick={() => removeBasic(b)} disabled={basicsBusyId === b.id}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}

          <h4 className="overview-heading" style={{ marginTop: 28 }}>ADD A RESOURCE</h4>
          <form onSubmit={addBasic} className="upload-panel">
            <label>
              Title
              <input value={basicTitle} onChange={(e) => setBasicTitle(e.target.value)} placeholder="e.g. Sound Health" />
            </label>
            <label>
              Description (optional)
              <textarea value={basicDescription} onChange={(e) => setBasicDescription(e.target.value)} rows={2} />
            </label>
            <label>
              Link (optional)
              <input type="url" value={basicLinkUrl} onChange={(e) => setBasicLinkUrl(e.target.value)} placeholder="https://…" />
            </label>
            <div className="upload-actions">
              <button type="submit" disabled={addingBasic || !basicTitle.trim()}>{addingBasic ? 'Adding…' : 'Add resource'}</button>
            </div>
          </form>
        </div>
      ) : tab === 'Products' ? (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
            Products your members can link a contact's interest to — reference info only, no inventory or checkout.
          </p>
          {error && <p className="form-error">{error}</p>}

          <h4 className="overview-heading">PRODUCTS ({products.length})</h4>
          {loading ? (
            <p className="empty-row">Loading…</p>
          ) : products.length === 0 ? (
            <p className="empty-row">Nothing added yet — add one below.</p>
          ) : (
            products.map((p) => (
              <div className="res-card" key={p.id} style={{ marginBottom: 8 }}>
                <div className="res-top">
                  <div className="res-title-block">
                    <h3>{p.name}</h3>
                    {p.description && <p style={{ color: 'var(--text-dim)', margin: '4px 0' }}>{p.description}</p>}
                    {p.link_url && <a href={p.link_url} target="_blank" rel="noreferrer">View →</a>}
                  </div>
                  <button type="button" className="secondary" onClick={() => removeProduct(p)} disabled={busyId === p.id}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}

          <h4 className="overview-heading" style={{ marginTop: 28 }}>ADD A PRODUCT</h4>
          <form onSubmit={addProduct} className="upload-panel">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NeoLifeShake" />
            </label>
            <label>
              Description (optional)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </label>
            <label>
              Link (optional)
              <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
            </label>
            <div className="upload-actions">
              <button type="submit" disabled={adding || !name.trim()}>{adding ? 'Adding…' : 'Add product'}</button>
            </div>
          </form>
        </div>
      ) : (
        <div>
          <div className="upcoming-list" style={{ marginBottom: 20 }}>
            <span className="upcoming-pill">Members tracked<span className="badge active">{members.length}</span></span>
            <span className="upcoming-pill">Total contacts<span className="badge active">{members.reduce((s, m) => s + m.total, 0)}</span></span>
            <span className="upcoming-pill">Won customers<span className="badge active">{members.reduce((s, m) => s + m.wonCustomers, 0)}</span></span>
            <span className="upcoming-pill">Won distributors<span className="badge active">{members.reduce((s, m) => s + m.wonDistributors, 0)}</span></span>
          </div>

          <h4 className="overview-heading">MEMBER PIPELINES</h4>
          {membersLoading ? (
            <p className="empty-row">Loading…</p>
          ) : members.length === 0 ? (
            <p className="empty-row">No members yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Total contacts</th>
                    <th>In progress</th>
                    <th>Won customers</th>
                    <th>Won distributors</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.fullName}</td>
                      <td>{m.total}</td>
                      <td>{m.inProgress}</td>
                      <td>{m.wonCustomers}</td>
                      <td>{m.wonDistributors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
