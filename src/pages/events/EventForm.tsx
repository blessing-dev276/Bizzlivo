import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { notifyUsers } from '../../lib/notifications'
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABEL } from '../../lib/events'
import type { EventCategory, EventStoredStatus, EventVenueType, HQEvent } from '../../types/database'

interface MemberOption {
  id: string
  full_name: string
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultStart() {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

export default function EventForm() {
  const { eventId } = useParams<{ eventId: string }>()
  const isEdit = Boolean(eventId)
  const navigate = useNavigate()
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id

  const [members, setMembers] = useState<MemberOption[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<EventCategory>('workshop')
  const [startAt, setStartAt] = useState(toLocalInputValue(defaultStart().toISOString()))
  const [endAt, setEndAt] = useState(() => {
    const d = defaultStart()
    d.setHours(d.getHours() + 1)
    return toLocalInputValue(d.toISOString())
  })
  const [venueType, setVenueType] = useState<EventVenueType>('physical')
  const [venueLocation, setVenueLocation] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [organizerId, setOrganizerId] = useState('')
  const [status, setStatus] = useState<EventStoredStatus>('scheduled')
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, full_name)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(({ data }) => {
        const rows = (data as unknown as { user_id: string; profile: { id: string; full_name: string } | null }[]) ?? []
        setMembers(rows.filter((r) => r.profile).map((r) => r.profile as MemberOption))
      })
  }, [orgId])

  useEffect(() => {
    if (!isEdit || !eventId || !orgId) return
    supabase.from('events').select('*').eq('id', eventId).eq('org_id', orgId).single().then(({ data }) => {
      const e = data as HQEvent | null
      if (!e) {
        setError('Event not found.')
        setLoading(false)
        return
      }
      setTitle(e.title)
      setDescription(e.description ?? '')
      setCategory(e.category)
      setStartAt(toLocalInputValue(e.start_at))
      setEndAt(toLocalInputValue(e.end_at))
      setVenueType(e.venue_type)
      setVenueLocation(e.venue_location ?? '')
      setMeetingLink(e.meeting_link ?? '')
      setOrganizerId(e.organizer_id ?? '')
      setStatus(e.status)
      setLoading(false)
    })
  }, [isEdit, eventId, orgId])

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!orgId || !profile) return
    setError(null)

    if (new Date(endAt) < new Date(startAt)) {
      setError('End time must be after the start time.')
      return
    }

    setSubmitting(true)
    const payload = {
      org_id: orgId,
      title: title.trim(),
      description: description.trim() || null,
      category,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      venue_type: venueType,
      venue_location: venueLocation.trim() || null,
      meeting_link: meetingLink.trim() || null,
      organizer_id: organizerId || null,
      status,
    }

    const result = isEdit
      ? await supabase.from('events').update(payload).eq('id', eventId)
      : await supabase.from('events').insert({ ...payload, created_by: profile.id }).select('id').single()

    setSubmitting(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    const targetId = isEdit ? eventId : (result.data as { id: string }).id

    if (!isEdit && status !== 'draft') {
      const { data: memberRows } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('status', 'active')
      const recipientIds = (memberRows ?? []).map((m) => m.user_id).filter((id) => id !== profile.id)
      if (recipientIds.length > 0) {
        await notifyUsers(orgId, recipientIds, 'event_created', {
          text: `New event: "${title.trim()}"`,
          link: `/events/${targetId}`,
        })
      }
    }

    navigate(`/events/${targetId}`)
  }

  if (loading) return <div className="page"><p>Loading…</p></div>

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1>{isEdit ? 'Edit Event' : 'Create Event'}</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>

        <label>
          Description
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as EventCategory)}>
            {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{EVENT_CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Starts
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
          </label>
          <label style={{ flex: 1 }}>
            Ends
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
          </label>
        </div>

        <label>
          Venue
          <select value={venueType} onChange={(e) => setVenueType(e.target.value as EventVenueType)}>
            <option value="physical">Physical</option>
            <option value="online">Online</option>
          </select>
        </label>
        <label>
          Location
          <input value={venueLocation} onChange={(e) => setVenueLocation(e.target.value)} placeholder="e.g. Office HQ, 3rd floor" />
        </label>
        <label>
          Meeting link <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(optional — for hybrid/online attendance)</span>
          <input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://…" />
        </label>

        <label>
          Organizer
          <select value={organizerId} onChange={(e) => setOrganizerId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </label>

        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as EventStoredStatus)}>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        {error && <p className="form-error">{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
