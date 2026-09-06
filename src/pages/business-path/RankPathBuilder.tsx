import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { ITEM_KIND_LABEL, loadRankItems } from '../../lib/businessPath'
import type {
  BusinessPathItem,
  BusinessPathItemKind,
  BusinessPathRank,
  BusinessPathSection,
} from '../../types/database'

type Opt = { id: string; title: string }

const KIND_GROUPS: { group: string; kinds: BusinessPathItemKind[] }[] = [
  { group: 'Rank requirements (auto-validated)', kinds: ['profile_completion', 'onboarding_completion', 'learning_count', 'goal_created', 'three_month_goals', 'direct_member_count'] },
  { group: 'Content (auto-completes from Bizzlivo)', kinds: ['class', 'exam', 'assignment', 'resource', 'link'] },
  { group: 'Activity (counted from member data)', kinds: ['daily_reports', 'prospects_added', 'followups_logged', 'event_attendance', 'income_logged', 'monthly_goal'] },
  { group: 'Manual', kinds: ['manual_admin', 'manual_self'] },
]

const LEARNING_AREA_LABEL: Record<string, string> = {
  network_marketing: 'Network Marketing',
  freelancing: 'Freelancing',
  personal_development: 'Personal Development',
  income_development: 'Income Development',
}

const KIND_HELP: Partial<Record<BusinessPathItemKind, string>> = {
  profile_completion: 'Done automatically once the member fills the required profile fields (phone, photo, sponsor).',
  onboarding_completion: 'Done automatically once every published onboarding module is complete.',
  learning_count: 'Done automatically once the member completes the required number of modules in a learning area.',
  goal_created: 'Done automatically once the member has any goal for the current month.',
  three_month_goals: 'Done automatically once the member has goals for this month and the next two.',
  direct_member_count: 'Counts members who joined with this member as their sponsor.',
  class: 'Done when the member finishes every item in the class.',
  exam: 'Done when the member has a passing submitted attempt.',
  assignment: 'Done when the member’s submission is approved.',
  resource: 'Member opens it and confirms they’ve studied it.',
  link: 'Member opens the link and confirms.',
  daily_reports: 'Counts daily reports filed since the member reached this rank.',
  prospects_added: 'Counts contacts the member has added since reaching this rank.',
  followups_logged: 'Counts follow-up notes logged since reaching this rank.',
  event_attendance: 'Done from event attendance — a specific event, or any N events.',
  income_logged: 'Counts income-log entries (or a total amount) since reaching this rank.',
  monthly_goal: 'Done when the member completes any monthly goal this month.',
  manual_admin: 'Only an admin or team leader can mark this done for the member.',
  manual_self: 'The member marks this done themselves.',
}

interface ItemForm {
  section: BusinessPathSection
  kind: BusinessPathItemKind
  title: string
  instructions: string
  is_required: boolean
  contentId: string
  linkUrl: string
  eventId: string
  targetCount: string
  targetAmount: string
  incomeMode: 'count' | 'amount'
  learningArea: string
  validationMode: 'automatic' | 'manual'
}
const blankForm = (section: BusinessPathSection): ItemForm => ({
  section,
  kind: section === 'learning' ? 'learning_count' : 'profile_completion',
  title: '',
  instructions: '',
  is_required: true,
  contentId: '',
  linkUrl: '',
  eventId: '',
  targetCount: '',
  targetAmount: '',
  incomeMode: 'count',
  learningArea: 'network_marketing',
  validationMode: 'automatic',
})

// Kinds where the member (or staff) can toggle manual approval.
const VALIDATION_TOGGLE_KINDS = new Set<BusinessPathItemKind>([
  'profile_completion', 'onboarding_completion', 'learning_count', 'goal_created',
  'three_month_goals', 'direct_member_count', 'class', 'exam', 'assignment',
  'daily_reports', 'prospects_added', 'followups_logged', 'event_attendance', 'income_logged', 'monthly_goal',
])

export default function RankPathBuilder() {
  const { rankId } = useParams<{ rankId: string }>()
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const readOnly = currentMembership?.role !== 'admin'

  const [rank, setRank] = useState<BusinessPathRank | null>(null)
  const [items, setItems] = useState<BusinessPathItem[]>([])
  const [classes, setClasses] = useState<Opt[]>([])
  const [exams, setExams] = useState<Opt[]>([])
  const [assignments, setAssignments] = useState<Opt[]>([])
  const [resources, setResources] = useState<Opt[]>([])
  const [events, setEvents] = useState<Opt[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<BusinessPathItem | null>(null)
  const [form, setForm] = useState<ItemForm>(blankForm('learning'))

  async function load() {
    if (!orgId || !rankId) return
    setLoading(true)
    const [{ data: rankRow }, itemRows, cls, exm, asg, res, evt] = await Promise.all([
      supabase.from('business_path_ranks').select('*').eq('id', rankId).eq('org_id', orgId).maybeSingle(),
      loadRankItems(orgId, rankId),
      supabase.from('classes').select('id, title').eq('org_id', orgId).eq('status', 'published').order('title'),
      supabase.from('exams').select('id, title').eq('org_id', orgId).eq('status', 'published').order('title'),
      supabase.from('coursework_assignments').select('id, title').eq('org_id', orgId).order('title'),
      supabase.from('resources').select('id, title').eq('org_id', orgId).order('title'),
      supabase.from('events').select('id, title, start_at').eq('org_id', orgId).order('start_at', { ascending: false }).limit(60),
    ])
    setRank((rankRow as BusinessPathRank) ?? null)
    setItems(itemRows)
    setClasses((cls.data as Opt[]) ?? [])
    setExams((exm.data as Opt[]) ?? [])
    setAssignments((asg.data as Opt[]) ?? [])
    setResources((res.data as Opt[]) ?? [])
    setEvents(((evt.data as { id: string; title: string }[]) ?? []).map((e) => ({ id: e.id, title: e.title })))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, rankId])

  const byId = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of [...classes, ...exams, ...assignments, ...resources, ...events]) m.set(o.id, o.title)
    return m
  }, [classes, exams, assignments, resources, events])

  const learning = items.filter((i) => i.section === 'learning').sort((a, b) => a.order_index - b.order_index)
  const tasks = items.filter((i) => i.section === 'task').sort((a, b) => a.order_index - b.order_index)

  function contentOptions(kind: BusinessPathItemKind): Opt[] {
    if (kind === 'class') return classes
    if (kind === 'exam') return exams
    if (kind === 'assignment') return assignments
    if (kind === 'resource') return resources
    return []
  }

  function linkedLabel(item: BusinessPathItem): string {
    const id = item.class_id || item.exam_id || item.coursework_assignment_id || item.resource_id || item.event_id
    if (id) return byId.get(id) ?? 'linked content'
    if (item.link_url) return item.link_url
    if (item.target_amount != null) return `₦${Number(item.target_amount).toLocaleString()} total`
    if (item.target_count != null) return `${item.target_count}×`
    return '—'
  }

  function openAdd(section: BusinessPathSection) {
    setEditing(null)
    setForm(blankForm(section))
    setError(null)
    setShowForm(true)
  }
  function openEdit(item: BusinessPathItem) {
    setEditing(item)
    setForm({
      section: item.section,
      kind: item.kind,
      title: item.title,
      instructions: item.instructions ?? '',
      is_required: item.is_required,
      contentId: item.class_id || item.exam_id || item.coursework_assignment_id || item.resource_id || '',
      linkUrl: item.link_url ?? '',
      eventId: item.event_id ?? '',
      targetCount: item.target_count != null ? String(item.target_count) : '',
      targetAmount: item.target_amount != null ? String(item.target_amount) : '',
      incomeMode: item.target_amount != null ? 'amount' : 'count',
      learningArea: item.learning_area ?? 'network_marketing',
      validationMode: item.validation_mode ?? 'automatic',
    })
    setError(null)
    setShowForm(true)
  }

  function pointerPayload(f: ItemForm) {
    const p = {
      class_id: null as string | null,
      exam_id: null as string | null,
      coursework_assignment_id: null as string | null,
      resource_id: null as string | null,
      link_url: null as string | null,
      event_id: null as string | null,
      target_count: null as number | null,
      target_amount: null as number | null,
      learning_area: null as string | null,
      validation_mode: VALIDATION_TOGGLE_KINDS.has(f.kind) ? f.validationMode : 'automatic',
    }
    switch (f.kind) {
      case 'class': p.class_id = f.contentId || null; break
      case 'exam': p.exam_id = f.contentId || null; break
      case 'assignment': p.coursework_assignment_id = f.contentId || null; break
      case 'resource': p.resource_id = f.contentId || null; break
      case 'link': p.link_url = f.linkUrl.trim() || null; break
      case 'learning_count':
        p.learning_area = f.learningArea
        p.target_count = Number(f.targetCount) || 1
        break
      case 'direct_member_count':
        p.target_count = Number(f.targetCount) || 1
        break
      case 'event_attendance':
        if (f.eventId) p.event_id = f.eventId
        else p.target_count = Number(f.targetCount) || 1
        break
      case 'income_logged':
        if (f.incomeMode === 'amount') p.target_amount = Number(f.targetAmount) || null
        else p.target_count = Number(f.targetCount) || 1
        break
      case 'daily_reports':
      case 'prospects_added':
      case 'followups_logged':
        p.target_count = Number(f.targetCount) || 1
        break
      // manual / self / profile_completion / onboarding_completion / goal_created /
      // three_month_goals need no extra config
    }
    return p
  }

  function validate(f: ItemForm): string | null {
    if (!f.title.trim()) return 'Give the item a title.'
    if (['class', 'exam', 'assignment', 'resource'].includes(f.kind) && !f.contentId) return 'Pick the content to link.'
    if (f.kind === 'link' && !f.linkUrl.trim()) return 'Enter a URL.'
    if (f.kind === 'learning_count' && !f.learningArea) return 'Pick a learning area.'
    if (f.kind === 'income_logged' && f.incomeMode === 'amount' && !f.targetAmount) return 'Enter a target amount.'
    return null
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !rankId || !profile) return
    const v = validate(form)
    if (v) { setError(v); return }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        section: form.section,
        kind: form.kind,
        title: form.title.trim(),
        instructions: form.instructions.trim() || null,
        is_required: form.is_required,
        ...pointerPayload(form),
      }
      if (editing) {
        const { error: e1 } = await supabase.from('business_path_items').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
        if (e1) throw e1
      } else {
        const sectionItems = form.section === 'learning' ? learning : tasks
        const { error: e2 } = await supabase.from('business_path_items').insert({
          org_id: orgId,
          rank_id: rankId,
          order_index: sectionItems.length,
          created_by: profile.id,
          ...payload,
        })
        if (e2) throw e2
      }
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.')
    } finally {
      setBusy(false)
    }
  }

  async function move(item: BusinessPathItem, dir: -1 | 1) {
    const list = item.section === 'learning' ? learning : tasks
    const idx = list.findIndex((i) => i.id === item.id)
    const swap = list[idx + dir]
    if (!swap) return
    setBusy(true)
    await Promise.all([
      supabase.from('business_path_items').update({ order_index: swap.order_index }).eq('id', item.id),
      supabase.from('business_path_items').update({ order_index: item.order_index }).eq('id', swap.id),
    ])
    setBusy(false)
    await load()
  }

  async function remove(item: BusinessPathItem) {
    if (!confirm(`Remove "${item.title}"? Members' completion of the underlying content isn't affected.`)) return
    setBusy(true)
    const { error: e1 } = await supabase.from('business_path_items').delete().eq('id', item.id)
    setBusy(false)
    if (e1) setError(e1.message)
    else await load()
  }

  if (loading) return <div className="page bp"><p className="md-muted">Loading…</p></div>
  if (!rank) return <div className="page bp"><p className="empty-row">Rank not found.</p></div>

  const renderSection = (title: string, section: BusinessPathSection, list: BusinessPathItem[]) => (
    <div className="bp-builder-sec">
      <div className="list-head">
        <h2>{title}</h2>
        {!readOnly && <button type="button" className="btn-ghost" onClick={() => openAdd(section)}>+ Add item</button>}
      </div>
      {list.length === 0 ? (
        <p className="empty-row">Nothing here yet.</p>
      ) : (
        list.map((item, idx) => (
          <div className="bp-build-row" key={item.id}>
            <span className="bp-build-idx">{idx + 1}</span>
            <div className="bp-build-main">
              <h4>{item.title}</h4>
              <div className="sub">
                <span className="badge">{ITEM_KIND_LABEL[item.kind] ?? item.kind}</span>
                <span>{linkedLabel(item)}</span>
                {!item.is_required && <span className="bp-item-optional">Optional</span>}
              </div>
            </div>
            {!readOnly && (
              <div className="bp-build-actions">
                <button type="button" className="bp-move" onClick={() => move(item, -1)} disabled={busy || idx === 0}>↑</button>
                <button type="button" className="bp-move" onClick={() => move(item, 1)} disabled={busy || idx === list.length - 1}>↓</button>
                <button type="button" className="btn-ghost" onClick={() => openEdit(item)}>Edit</button>
                <button type="button" className="btn-ghost" onClick={() => remove(item)}>Remove</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )

  const isContentKind = ['class', 'exam', 'assignment', 'resource'].includes(form.kind)

  return (
    <div className="page bp">
      <div className="bp-head">
        <p style={{ fontSize: 12.5, margin: 0 }}>
          <Link to="/business-path" className="dash-see-all">Business Path</Link> › {rank.name}
        </p>
        <h1>{rank.icon ? `${rank.icon} ` : ''}{rank.name}</h1>
        {rank.description && <p>{rank.description}</p>}
      </div>

      {error && <p className="form-error">{error}</p>}

      {renderSection('Learning Path', 'learning', learning)}
      {renderSection('Business Tasks', 'task', tasks)}

      {showForm && !readOnly && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={save}>
              <h2>{editing ? 'Edit item' : `Add ${form.section === 'learning' ? 'learning item' : 'task'}`}</h2>

              <label>
                Section
                <select value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value as BusinessPathSection }))}>
                  <option value="learning">Learning Path</option>
                  <option value="task">Business Tasks</option>
                </select>
              </label>

              <label>
                Type
                <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as BusinessPathItemKind, contentId: '', eventId: '' }))}>
                  {KIND_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.kinds.map((k) => <option key={k} value={k}>{ITEM_KIND_LABEL[k]}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              {KIND_HELP[form.kind] && <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '-8px 0 12px' }}>{KIND_HELP[form.kind]}</p>}

              {isContentKind && (
                <label>
                  {form.kind === 'class' ? 'Class' : form.kind === 'exam' ? 'Exam' : form.kind === 'assignment' ? 'Assignment' : 'Resource'}
                  <select
                    value={form.contentId}
                    onChange={(e) => {
                      const id = e.target.value
                      const t = contentOptions(form.kind).find((o) => o.id === id)?.title
                      setForm((f) => ({ ...f, contentId: id, title: f.title || t || '' }))
                    }}
                  >
                    <option value="">— Select —</option>
                    {contentOptions(form.kind).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                  </select>
                </label>
              )}

              {form.kind === 'link' && (
                <label>
                  URL
                  <input value={form.linkUrl} onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))} placeholder="https://…" />
                </label>
              )}

              {form.kind === 'event_attendance' && (
                <>
                  <label>
                    Specific event (optional)
                    <select value={form.eventId} onChange={(e) => setForm((f) => ({ ...f, eventId: e.target.value }))}>
                      <option value="">— Any event —</option>
                      {events.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                    </select>
                  </label>
                  {!form.eventId && (
                    <label style={{ maxWidth: 160 }}>
                      How many events
                      <input type="number" min="1" value={form.targetCount} onChange={(e) => setForm((f) => ({ ...f, targetCount: e.target.value }))} placeholder="1" />
                    </label>
                  )}
                </>
              )}

              {['daily_reports', 'prospects_added', 'followups_logged', 'direct_member_count'].includes(form.kind) && (
                <label style={{ maxWidth: 160 }}>
                  Target count
                  <input type="number" min="1" value={form.targetCount} onChange={(e) => setForm((f) => ({ ...f, targetCount: e.target.value }))} placeholder="5" />
                </label>
              )}

              {form.kind === 'learning_count' && (
                <div className="field-row">
                  <label>
                    Learning area
                    <select value={form.learningArea} onChange={(e) => setForm((f) => ({ ...f, learningArea: e.target.value }))}>
                      {Object.entries(LEARNING_AREA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label style={{ maxWidth: 160 }}>
                    Required modules
                    <input type="number" min="1" value={form.targetCount} onChange={(e) => setForm((f) => ({ ...f, targetCount: e.target.value }))} placeholder="5" />
                  </label>
                </div>
              )}

              {form.kind === 'income_logged' && (
                <>
                  <label>
                    Measure by
                    <select value={form.incomeMode} onChange={(e) => setForm((f) => ({ ...f, incomeMode: e.target.value as 'count' | 'amount' }))}>
                      <option value="count">Number of entries</option>
                      <option value="amount">Total amount (₦)</option>
                    </select>
                  </label>
                  {form.incomeMode === 'count' ? (
                    <label style={{ maxWidth: 160 }}>
                      Entries
                      <input type="number" min="1" value={form.targetCount} onChange={(e) => setForm((f) => ({ ...f, targetCount: e.target.value }))} placeholder="1" />
                    </label>
                  ) : (
                    <label style={{ maxWidth: 200 }}>
                      Total ₦
                      <input type="number" min="0" value={form.targetAmount} onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} placeholder="10000" />
                    </label>
                  )}
                </>
              )}

              <label>
                Title shown to members
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
              </label>
              <label>
                Instructions (optional)
                <textarea rows={2} value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} />
              </label>
              {VALIDATION_TOGGLE_KINDS.has(form.kind) && (
                <label>
                  Validation
                  <select value={form.validationMode} onChange={(e) => setForm((f) => ({ ...f, validationMode: e.target.value as 'automatic' | 'manual' }))}>
                    <option value="automatic">Automatic — Bizzlivo checks the data</option>
                    <option value="manual">Manual approval — a staff member confirms</option>
                  </select>
                </label>
              )}

              <label className="toggle-row" style={{ border: 'none', padding: 0 }}>
                <span>Required for promotion</span>
                <input type="checkbox" checked={form.is_required} onChange={(e) => setForm((f) => ({ ...f, is_required: e.target.checked }))} />
              </label>

              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save' : 'Add item'}</button>
                <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
