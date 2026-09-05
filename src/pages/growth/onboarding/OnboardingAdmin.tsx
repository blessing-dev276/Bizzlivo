import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { OnboardingItemType, OnboardingSettings, OnboardingStep, OnboardingStepItem } from '../../../types/database'

const MAX_PDF_BYTES = 20 * 1024 * 1024
// Supabase's project-level upload size cap defaults to 50MB on the free
// tier — offices expecting to upload longer videos may need that raised
// in Project Settings > Storage before this limit means anything in practice.
const MAX_VIDEO_BYTES = 200 * 1024 * 1024

const STEP_ORDER: OnboardingStep[] = ['business_explanation', 'network_varsity', 'office_policy']
const STEP_LABEL: Record<OnboardingStep, string> = {
  business_explanation: 'Business Explanation',
  network_varsity: 'Network Varsity',
  office_policy: 'Office Policy',
}
const TYPE_LABEL: Record<OnboardingItemType, string> = { pdf: 'PDF', video: 'Video', link: 'Link' }

interface MemberProgressRow {
  userId: string
  fullName: string
  businessAt: string | null
  varsityAt: string | null
  policyAt: string | null
  registeredAt: string | null
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

export default function OnboardingAdmin() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [items, setItems] = useState<OnboardingStepItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [registrationLink, setRegistrationLink] = useState('')
  const [savingLink, setSavingLink] = useState(false)

  const [addingStep, setAddingStep] = useState<OnboardingStep | null>(null)
  const [itemType, setItemType] = useState<OnboardingItemType>('pdf')
  const [itemTitle, setItemTitle] = useState('')
  const [itemFile, setItemFile] = useState<File | null>(null)
  const [itemLink, setItemLink] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [members, setMembers] = useState<MemberProgressRow[]>([])
  const [membersLoading, setMembersLoading] = useState(true)

  async function loadSettings(org: string) {
    setLoading(true)
    const [settingsRes, itemsRes] = await Promise.all([
      supabase.from('onboarding_settings').select('*').eq('org_id', org).maybeSingle(),
      supabase.from('onboarding_step_items').select('*').eq('org_id', org).order('order_index', { ascending: true }),
    ])
    const row = settingsRes.data as OnboardingSettings | null
    setRegistrationLink(row?.registration_link ?? '')
    setItems((itemsRes.data as OnboardingStepItem[]) ?? [])
    setLoading(false)
  }

  async function loadMembers(org: string) {
    setMembersLoading(true)
    const [membershipsRes, progressRes] = await Promise.all([
      supabase.from('memberships').select('user_id, profile:profiles(full_name)').eq('org_id', org).eq('status', 'active'),
      supabase.from('onboarding_progress').select('*').eq('org_id', org),
    ])
    const progressByUser = new Map((progressRes.data ?? []).map((p) => [p.user_id, p]))
    const rows: MemberProgressRow[] = ((membershipsRes.data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? []).map((m) => {
      const p = progressByUser.get(m.user_id)
      return {
        userId: m.user_id,
        fullName: m.profile?.full_name ?? 'Unknown',
        businessAt: p?.business_explanation_viewed_at ?? null,
        varsityAt: p?.network_varsity_completed_at ?? null,
        policyAt: p?.policy_acknowledged_at ?? null,
        registeredAt: p?.registered_at ?? null,
      }
    })
    setMembers(rows)
    setMembersLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    loadSettings(orgId)
    loadMembers(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const itemsByStep = useMemo(() => {
    const map = new Map<OnboardingStep, OnboardingStepItem[]>()
    for (const item of items) {
      if (!map.has(item.step)) map.set(item.step, [])
      map.get(item.step)!.push(item)
    }
    return map
  }, [items])

  async function saveRegistrationLink(e: FormEvent) {
    e.preventDefault()
    if (!orgId) return
    setSavingLink(true)
    setError(null)
    const { error: upsertErr } = await supabase.from('onboarding_settings').upsert({
      org_id: orgId,
      registration_link: registrationLink.trim() || null,
      updated_at: new Date().toISOString(),
    })
    setSavingLink(false)
    if (upsertErr) setError(upsertErr.message)
    else await loadSettings(orgId)
  }

  function openAddItem(step: OnboardingStep) {
    setAddingStep(step)
    setItemType('pdf')
    setItemTitle('')
    setItemFile(null)
    setItemLink('')
    setError(null)
  }

  async function addItem(e: FormEvent) {
    e.preventDefault()
    if (!addingStep || !orgId || !profile || !itemTitle.trim()) return
    setError(null)

    try {
      setUploading(true)
      const stepItems = itemsByStep.get(addingStep) ?? []
      const base = {
        org_id: orgId,
        step: addingStep,
        type: itemType,
        title: itemTitle.trim(),
        order_index: stepItems.length,
        created_by: profile.id,
      }

      if (itemType === 'link') {
        if (!itemLink.trim()) throw new Error('Enter a link.')
        const { error: insertError } = await supabase.from('onboarding_step_items').insert({ ...base, link_url: itemLink.trim() })
        if (insertError) throw insertError
      } else {
        if (!itemFile) throw new Error(`Choose a ${itemType} file.`)
        if (itemType === 'pdf' && itemFile.type !== 'application/pdf') throw new Error('That file is not a PDF.')
        if (itemType === 'video' && !itemFile.type.startsWith('video/')) throw new Error('That file is not a video.')
        const limit = itemType === 'pdf' ? MAX_PDF_BYTES : MAX_VIDEO_BYTES
        if (itemFile.size > limit) throw new Error(`File is too large — the limit is ${itemType === 'pdf' ? '20MB' : '200MB'}.`)

        const itemId = crypto.randomUUID()
        const ext = itemFile.name.split('.').pop() || (itemType === 'pdf' ? 'pdf' : 'mp4')
        const path = `${orgId}/${addingStep}/${itemId}.${ext}`
        const { error: upErr } = await supabase.storage.from('onboarding').upload(path, itemFile, { contentType: itemFile.type })
        if (upErr) throw upErr

        const { error: insertError } = await supabase.from('onboarding_step_items').insert({ ...base, id: itemId, file_path: path })
        if (insertError) throw insertError
      }

      setAddingStep(null)
      await loadSettings(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this item.')
    } finally {
      setUploading(false)
    }
  }

  async function deleteItem(item: OnboardingStepItem) {
    if (!confirm(`Remove "${item.title}"?`)) return
    setBusyId(item.id)
    setError(null)
    if (item.file_path) await supabase.storage.from('onboarding').remove([item.file_path])
    const { error: deleteError } = await supabase.from('onboarding_step_items').delete().eq('id', item.id)
    setBusyId(null)
    if (deleteError) setError(deleteError.message)
    else if (orgId) await loadSettings(orgId)
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Upload what members go through, in order: the business explanation, Network Varsity training, your office
        policy, then a link to your registration system. Each step can hold as many PDFs, videos, and links as you need.
      </p>

      {error && <p className="form-error">{error}</p>}

      {STEP_ORDER.map((step, idx) => (
        <div className="res-card" key={step} style={{ marginBottom: 14 }}>
          <div className="res-title-block"><h3>{idx + 1}. {STEP_LABEL[step]}</h3></div>

          <div style={{ marginTop: 10 }}>
            {(itemsByStep.get(step) ?? []).length === 0 ? (
              <p className="empty-row">Nothing uploaded yet.</p>
            ) : (
              (itemsByStep.get(step) ?? []).map((item) => (
                <div key={item.id} className="toggle-row">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="badge">{TYPE_LABEL[item.type]}</span>
                    {item.title}
                  </label>
                  <button type="button" className="secondary" onClick={() => deleteItem(item)} disabled={busyId === item.id}>Remove</button>
                </div>
              ))
            )}
            <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => openAddItem(step)}>+ Add item</button>
          </div>
        </div>
      ))}

      <div className="res-card" style={{ marginBottom: 14 }}>
        <div className="res-title-block"><h3>4. Registration Link</h3></div>
        <form onSubmit={saveRegistrationLink} style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ flex: 1, margin: 0 }}>
            Link
            <input type="url" placeholder="https://…" value={registrationLink} onChange={(e) => setRegistrationLink(e.target.value)} />
          </label>
          <button type="submit" disabled={savingLink}>{savingLink ? 'Saving…' : 'Save'}</button>
        </form>
      </div>

      {addingStep && (
        <div className="modal-backdrop" onClick={() => setAddingStep(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={addItem}>
              <h2>Add to {STEP_LABEL[addingStep]}</h2>
              <label>
                Type
                <select value={itemType} onChange={(e) => { setItemType(e.target.value as OnboardingItemType); setItemFile(null); setItemLink('') }}>
                  <option value="pdf">PDF</option>
                  <option value="video">Video</option>
                  <option value="link">Link</option>
                </select>
              </label>
              <label>
                Title
                <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} required autoFocus />
              </label>
              {itemType === 'link' ? (
                <label key="link">
                  URL
                  <input type="url" placeholder="https://…" value={itemLink} onChange={(e) => setItemLink(e.target.value)} required />
                </label>
              ) : (
                <label key="file">
                  File
                  <input
                    type="file"
                    accept={itemType === 'pdf' ? 'application/pdf' : 'video/*'}
                    onChange={(e) => setItemFile(e.target.files?.[0] ?? null)}
                    required
                  />
                </label>
              )}

              {error && <p className="form-error">{error}</p>}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={uploading || !itemTitle.trim()}>{uploading ? 'Adding…' : 'Add item'}</button>
                <button type="button" className="secondary" onClick={() => setAddingStep(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <h4 className="overview-heading" style={{ marginTop: 32 }}>MEMBER PROGRESS</h4>
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
                <th>Business Explanation</th>
                <th>Network Varsity</th>
                <th>Office Policy</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.fullName}</td>
                  <td>{fmtDate(m.businessAt)}</td>
                  <td>{fmtDate(m.varsityAt)}</td>
                  <td>{fmtDate(m.policyAt)}</td>
                  <td>{fmtDate(m.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
