import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type {
  NetworkMarketingActivity,
  NetworkMarketingBasic,
  NetworkMarketingContact,
  NetworkMarketingContactStage,
  NetworkMarketingProduct,
} from '../../../types/database'

const TABS = ['Dashboard', 'Contacts', 'NeoLife Basics', 'Products'] as const
type Tab = (typeof TABS)[number]

const STAGE_ORDER: NetworkMarketingContactStage[] = [
  'prospect', 'invited', 'presented', 'followed_up', 'won_customer', 'won_distributor', 'lost',
]
const STAGE_LABEL: Record<NetworkMarketingContactStage, string> = {
  prospect: 'Prospect',
  invited: 'Invited',
  presented: 'Presented',
  followed_up: 'Followed Up',
  won_customer: 'Won — Customer',
  won_distributor: 'Won — Distributor',
  lost: 'Lost',
}

type StageFilter = 'all' | NetworkMarketingContactStage

export default function NetworkMarketingMember() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [tab, setTab] = useState<Tab>('Dashboard')
  const [contacts, setContacts] = useState<NetworkMarketingContact[]>([])
  const [activitiesByContact, setActivitiesByContact] = useState<Map<string, NetworkMarketingActivity[]>>(new Map())
  const [basics, setBasics] = useState<NetworkMarketingBasic[]>([])
  const [products, setProducts] = useState<NetworkMarketingProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filter, setFilter] = useState<StageFilter>('all')
  const [showNewContact, setShowNewContact] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newProductId, setNewProductId] = useState('')

  const [noteContactId, setNoteContactId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  async function load(org: string, userId: string) {
    setLoading(true)
    const [contactsRes, basicsRes, productsRes] = await Promise.all([
      supabase.from('network_marketing_contacts').select('*').eq('org_id', org).eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('network_marketing_basics').select('*').eq('org_id', org).order('created_at'),
      supabase.from('network_marketing_products').select('*').eq('org_id', org).order('name'),
    ])
    const contactRows = (contactsRes.data as NetworkMarketingContact[]) ?? []
    setContacts(contactRows)
    setBasics((basicsRes.data as NetworkMarketingBasic[]) ?? [])
    setProducts((productsRes.data as NetworkMarketingProduct[]) ?? [])

    const contactIds = contactRows.map((c) => c.id)
    const activitiesRes = contactIds.length > 0
      ? await supabase.from('network_marketing_activities').select('*').in('contact_id', contactIds).order('created_at', { ascending: false })
      : { data: [] as NetworkMarketingActivity[] }
    const map = new Map<string, NetworkMarketingActivity[]>()
    for (const a of (activitiesRes.data as NetworkMarketingActivity[]) ?? []) {
      const list = map.get(a.contact_id) ?? []
      list.push(a)
      map.set(a.contact_id, list)
    }
    setActivitiesByContact(map)
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId || !profile) return
    load(orgId, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, profile])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const stageCounts = useMemo(() => {
    const counts = new Map<NetworkMarketingContactStage, number>()
    for (const stage of STAGE_ORDER) counts.set(stage, 0)
    for (const c of contacts) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1)
    return counts
  }, [contacts])

  const recentActivity = useMemo(() => {
    const contactById = new Map(contacts.map((c) => [c.id, c]))
    return [...activitiesByContact.values()]
      .flat()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 8)
      .map((a) => ({ activity: a, contactName: contactById.get(a.contact_id)?.full_name ?? 'Unknown' }))
  }, [activitiesByContact, contacts])

  const visibleContacts = filter === 'all' ? contacts : contacts.filter((c) => c.stage === filter)

  async function addContact(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !newName.trim()) return
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('network_marketing_contacts').insert({
      org_id: orgId,
      user_id: profile.id,
      full_name: newName.trim(),
      phone: newPhone.trim() || null,
      email: newEmail.trim() || null,
      interested_product_id: newProductId || null,
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNewName('')
    setNewPhone('')
    setNewEmail('')
    setNewProductId('')
    setShowNewContact(false)
    if (orgId && profile) await load(orgId, profile.id)
  }

  async function changeStage(contact: NetworkMarketingContact, stage: NetworkMarketingContactStage) {
    if (!orgId || !profile || stage === contact.stage) return
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('network_marketing_contacts')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', contact.id)
    if (!updateError) {
      await supabase.from('network_marketing_activities').insert({
        org_id: orgId,
        contact_id: contact.id,
        user_id: profile.id,
        note: `Moved to ${STAGE_LABEL[stage]}`,
        stage,
      })
    }
    setBusy(false)
    if (updateError) setError(updateError.message)
    else await load(orgId, profile.id)
  }

  async function logNote(contact: NetworkMarketingContact) {
    if (!orgId || !profile || !noteText.trim()) return
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('network_marketing_activities').insert({
      org_id: orgId,
      contact_id: contact.id,
      user_id: profile.id,
      note: noteText.trim(),
      stage: contact.stage,
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNoteText('')
    setNoteContactId(null)
    await load(orgId, profile.id)
  }

  async function removeContact(contact: NetworkMarketingContact) {
    if (!orgId || !profile) return
    if (!confirm(`Remove ${contact.full_name} from your contacts? This deletes their whole history.`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('network_marketing_contacts').delete().eq('id', contact.id)
    setBusy(false)
    if (deleteError) setError(deleteError.message)
    else await load(orgId, profile.id)
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <div className="view-tabs" style={{ marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={`view-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === 'Dashboard' && (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
            Your business at a glance — work contacts through the pipeline in the Contacts tab.
          </p>
          <div className="upcoming-list" style={{ marginBottom: 24 }}>
            {STAGE_ORDER.map((s) => (
              <span className="upcoming-pill" key={s}>{STAGE_LABEL[s]}<span className="badge active">{stageCounts.get(s) ?? 0}</span></span>
            ))}
          </div>

          <h4 className="overview-heading">RECENT ACTIVITY</h4>
          {recentActivity.length === 0 ? (
            <p className="empty-row">Nothing logged yet — add a contact and start working your pipeline.</p>
          ) : (
            recentActivity.map(({ activity, contactName }) => (
              <div key={activity.id} className="toggle-row">
                <div>
                  <strong>{contactName}</strong> — {activity.note}
                </div>
                <span className="cell-dim">{new Date(activity.created_at).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'Contacts' && (
        <div>
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <div className="chips">
              <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All · {contacts.length}</button>
              {STAGE_ORDER.map((s) => (
                <button key={s} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                  {STAGE_LABEL[s]} · {stageCounts.get(s) ?? 0}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowNewContact(true)}>+ Add contact</button>
          </div>

          {showNewContact && (
            <div className="modal-backdrop" onClick={() => setShowNewContact(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <form onSubmit={addContact}>
                  <h2>Add a contact</h2>
                  <label>
                    Name
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
                  </label>
                  <label>
                    Phone (optional)
                    <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  </label>
                  <label>
                    Email (optional)
                    <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                  </label>
                  {products.length > 0 && (
                    <label>
                      Interested product (optional)
                      <select value={newProductId} onChange={(e) => setNewProductId(e.target.value)}>
                        <option value="">— None —</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="submit" disabled={busy || !newName.trim()}>{busy ? 'Adding…' : 'Add contact'}</button>
                    <button type="button" className="secondary" onClick={() => setShowNewContact(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {visibleContacts.length === 0 ? (
            <p className="empty-row">No contacts here yet.</p>
          ) : (
            visibleContacts.map((contact) => {
              const activities = activitiesByContact.get(contact.id) ?? []
              const product = contact.interested_product_id ? productById.get(contact.interested_product_id) : null
              return (
                <div className="res-card" key={contact.id} style={{ marginBottom: 12 }}>
                  <div className="res-top">
                    <div className="res-title-block">
                      <h3>{contact.full_name}</h3>
                      <div className="exam-sub">
                        {[contact.phone, contact.email].filter(Boolean).join(' · ') || 'No contact info'}
                        {product && ` · Interested in ${product.name}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select value={contact.stage} onChange={(e) => changeStage(contact, e.target.value as NetworkMarketingContactStage)} disabled={busy}>
                        {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                      </select>
                      <button type="button" className="secondary" onClick={() => removeContact(contact)} disabled={busy}>Remove</button>
                    </div>
                  </div>

                  {activities.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      {activities.slice(0, 3).map((a) => (
                        <p key={a.id} style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '2px 0' }}>
                          {new Date(a.created_at).toLocaleDateString()} — {a.note}
                        </p>
                      ))}
                    </div>
                  )}

                  {noteContactId === contact.id ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="e.g. Called, will follow up next week…"
                        style={{ flex: 1 }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button type="button" onClick={() => logNote(contact)} disabled={busy || !noteText.trim()}>Save</button>
                        <button type="button" className="secondary" onClick={() => setNoteContactId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginTop: 10 }}
                      onClick={() => { setNoteContactId(contact.id); setNoteText('') }}
                    >
                      + Log follow-up
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'NeoLife Basics' && (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>The foundational NeoLife training curriculum your office has added.</p>
          {basics.length === 0 ? (
            <p className="empty-row">Your office hasn't added any resources yet.</p>
          ) : (
            basics.map((b) => (
              <div className="res-card" key={b.id} style={{ marginBottom: 8 }}>
                <div className="res-title-block">
                  <h3>{b.title}</h3>
                  {b.description && <p style={{ color: 'var(--text-dim)', margin: '4px 0' }}>{b.description}</p>}
                  {b.link_url && <a href={b.link_url} target="_blank" rel="noreferrer">View →</a>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'Products' && (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>Products your office has added — link a contact's interest to one from the Contacts tab.</p>
          {products.length === 0 ? (
            <p className="empty-row">Your office hasn't added any products yet.</p>
          ) : (
            products.map((p) => (
              <div className="res-card" key={p.id} style={{ marginBottom: 8 }}>
                <div className="res-title-block">
                  <h3>{p.name}</h3>
                  {p.description && <p style={{ color: 'var(--text-dim)', margin: '4px 0' }}>{p.description}</p>}
                  {p.link_url && <a href={p.link_url} target="_blank" rel="noreferrer">View →</a>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
