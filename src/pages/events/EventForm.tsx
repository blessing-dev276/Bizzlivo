import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageSkeleton } from '../../components/AppSkeleton'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { notifyUsers } from '../../lib/notifications'
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABEL } from '../../lib/events'
import { buildRRule, parseRRule, describeRRule, WEEKDAY_LABELS, type RecurrencePreset } from '../../lib/recurrence'
import type {
  EventAudienceKind, EventCategory, EventStoredStatus, HQEvent,
  MeetingProvider, RecurrenceEndType,
} from '../../types/database'

const REMINDER_WINDOWS = [
  { m: 1440, label: '1 day before' },
  { m: 60, label: '1 hour before' },
  { m: 30, label: '30 minutes before' },
  { m: 10, label: '10 minutes before' },
]
const FREQUENCIES: { key: RecurrencePreset; label: string }[] = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'selected_days', label: 'Selected days' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'custom', label: 'Custom interval' },
]

interface Opt { id: string; label: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function localDatetimeIn(hoursAhead: number): string {
  const d = new Date()
  d.setHours(d.getHours() + hoursAhead, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EventForm() {
  const { eventId } = useParams<{ eventId: string }>()
  const isEdit = Boolean(eventId)
  const navigate = useNavigate()
  const { profile, currentMembership } = useAuth()
  const org = currentMembership?.organization
  const orgId = org?.id

  const [members, setMembers] = useState<Opt[]>([])
  const [teams, setTeams] = useState<Opt[]>([])
  const [ranks, setRanks] = useState<Opt[]>([])

  // basics
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<EventCategory>('training_session')
  const [organizerId, setOrganizerId] = useState('')
  const [status, setStatus] = useState<EventStoredStatus>('scheduled')

  // type
  const [isRecurring, setIsRecurring] = useState(false)
  const [oneTimeStart, setOneTimeStart] = useState(localDatetimeIn(1))
  const [oneTimeEnd, setOneTimeEnd] = useState(localDatetimeIn(2))

  // recurrence
  const [preset, setPreset] = useState<RecurrencePreset>('daily')
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4])
  const [interval, setIntervalN] = useState(1)
  const [customFreq, setCustomFreq] = useState<'daily' | 'weekly'>('daily')
  const [seriesStartDate, setSeriesStartDate] = useState(today())
  const [localStartTime, setLocalStartTime] = useState('21:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [timezone, setTimezone] = useState('Africa/Lagos')
  const [endType, setEndType] = useState<RecurrenceEndType>('never')
  const [recurrenceUntil, setRecurrenceUntil] = useState('')
  const [recurrenceCount, setRecurrenceCount] = useState(12)

  // location
  const [venueType, setVenueType] = useState<'physical' | 'online'>('online')
  const [venueLocation, setVenueLocation] = useState('')
  const [meetingProvider, setMeetingProvider] = useState<MeetingProvider>('external')
  const [meetingUrl, setMeetingUrl] = useState('')

  // reminders + audience
  const [reminders, setReminders] = useState<number[]>([30])
  const [emailReminders, setEmailReminders] = useState(false)
  const [audienceKind, setAudienceKind] = useState<EventAudienceKind>('all')
  const [audienceRefs, setAudienceRefs] = useState<string[]>([])

  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tzOptions = useMemo(() => {
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
      if (all?.length) return all
    } catch { /* older browsers */ }
    return ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London', 'America/New_York', 'UTC']
  }, [])

  useEffect(() => {
    if (org?.timezone) setTimezone(org.timezone)
  }, [org?.timezone])

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const [mRes, gRes, rRes] = await Promise.all([
        supabase.from('memberships').select('user_id, profile:profiles(id, full_name)').eq('org_id', orgId).eq('status', 'active'),
        supabase.from('groups').select('id, name').eq('org_id', orgId),
        supabase.from('business_path_ranks').select('id, name').eq('org_id', orgId).eq('is_active', true).order('order_index'),
      ])
      const mrows = (mRes.data as unknown as { profile: { id: string; full_name: string } | null }[]) ?? []
      setMembers(mrows.filter((r) => r.profile).map((r) => ({ id: r.profile!.id, label: r.profile!.full_name })))
      setTeams(((gRes.data as { id: string; name: string }[]) ?? []).map((g) => ({ id: g.id, label: g.name })))
      setRanks(((rRes.data as { id: string; name: string }[]) ?? []).map((r) => ({ id: r.id, label: r.name })))
    })()
  }, [orgId])

  useEffect(() => {
    if (!isEdit || !eventId || !orgId) return
    ;(async () => {
      const { data } = await supabase.from('events').select('*').eq('id', eventId).eq('org_id', orgId).single()
      const e = data as HQEvent | null
      if (!e) { setError('Event not found.'); setLoading(false); return }
      setTitle(e.title); setDescription(e.description ?? ''); setCategory(e.category)
      setOrganizerId(e.organizer_id ?? ''); setStatus(e.status)
      setVenueType(e.venue_type); setVenueLocation(e.venue_location ?? '')
      setMeetingProvider(e.meeting_provider === 'none' ? 'external' : e.meeting_provider)
      setMeetingUrl(e.meeting_url ?? e.meeting_link ?? '')
      setReminders(e.reminder_minutes?.length ? e.reminder_minutes : [30])
      setEmailReminders(e.email_reminders)
      setIsRecurring(e.is_recurring)
      if (e.is_recurring && e.recurrence_rule) {
        const p = parseRRule(e.recurrence_rule)
        setPreset(p.preset ?? 'daily')
        if (p.weekdays) setWeekdays(p.weekdays)
        if (p.interval) setIntervalN(p.interval)
        if (p.customFreq) setCustomFreq(p.customFreq)
        setSeriesStartDate(e.series_start_date ?? today())
        setLocalStartTime(e.local_start_time ?? '21:00')
        setDurationMinutes(e.duration_minutes ?? 60)
        setTimezone(e.timezone ?? 'Africa/Lagos')
        setEndType(e.recurrence_end_type)
        setRecurrenceUntil(e.recurrence_until ?? '')
        setRecurrenceCount(e.recurrence_count ?? 12)
      } else if (e.start_at && e.end_at) {
        const toInput = (iso: string) => {
          const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0')
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
        }
        setOneTimeStart(toInput(e.start_at)); setOneTimeEnd(toInput(e.end_at))
      }
      const { data: aud } = await supabase.from('event_audiences').select('kind, ref_id').eq('event_id', eventId).is('occurrence_id', null)
      const rows = (aud as { kind: EventAudienceKind; ref_id: string | null }[]) ?? []
      if (rows.length) {
        setAudienceKind(rows[0].kind)
        setAudienceRefs(rows.map((r) => r.ref_id).filter((x): x is string => !!x))
      }
      setLoading(false)
    })()
  }, [isEdit, eventId, orgId])

  const rulePreview = useMemo(() => {
    if (!isRecurring) return ''
    try {
      const rule = buildRRule({ preset, weekdays, interval, customFreq, seriesStartDate })
      return describeRRule(rule, localStartTime)
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid recurrence'
    }
  }, [isRecurring, preset, weekdays, interval, customFreq, seriesStartDate, localStartTime])

  function toggleWeekday(i: number) {
    setWeekdays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b)))
  }
  function toggleReminder(m: number) {
    setReminders((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => b - a)))
  }
  function toggleRef(id: string) {
    setAudienceRefs((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!orgId || !profile) return
    setError(null)

    if (!title.trim()) { setError('Title is required.'); return }
    if (venueType === 'online' && meetingProvider === 'external' && !meetingUrl.trim()) {
      setError('Add the meeting link, or switch the provider.'); return
    }
    if (venueType === 'physical' && !venueLocation.trim()) { setError('Add the venue.'); return }

    let recurrenceRule: string | null = null
    if (isRecurring) {
      try {
        recurrenceRule = buildRRule({ preset, weekdays, interval, customFreq, seriesStartDate })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid recurrence.'); return
      }
      if (endType === 'until' && !recurrenceUntil) { setError('Pick an end date.'); return }
    } else if (new Date(oneTimeEnd) < new Date(oneTimeStart)) {
      setError('End time must be after the start time.'); return
    }

    setSubmitting(true)
    const payload: Record<string, unknown> = {
      org_id: orgId,
      title: title.trim(),
      description: description.trim() || null,
      category,
      organizer_id: organizerId || null,
      status,
      venue_type: venueType,
      venue_location: venueType === 'physical' ? venueLocation.trim() : null,
      meeting_provider: venueType === 'online' ? meetingProvider : 'none',
      meeting_url: venueType === 'online' && meetingProvider === 'external' ? meetingUrl.trim() : null,
      meeting_link: null,
      reminder_minutes: reminders.length ? reminders : [30],
      email_reminders: emailReminders,
      is_recurring: isRecurring,
      // recurring fields
      recurrence_rule: isRecurring ? recurrenceRule : null,
      series_start_date: isRecurring ? seriesStartDate : null,
      local_start_time: isRecurring ? localStartTime : null,
      duration_minutes: isRecurring ? durationMinutes : null,
      timezone: isRecurring ? timezone : (org?.timezone ?? null),
      recurrence_end_type: isRecurring ? endType : 'never',
      recurrence_until: isRecurring && endType === 'until' ? recurrenceUntil : null,
      recurrence_count: isRecurring && endType === 'count' ? recurrenceCount : null,
      // one-time fields
      start_at: isRecurring ? null : new Date(oneTimeStart).toISOString(),
      end_at: isRecurring ? null : new Date(oneTimeEnd).toISOString(),
      // Google Meet gets synced by the integration later; save unsynced now.
      sync_status: venueType === 'online' && meetingProvider === 'google_meet' ? 'not_synced' : 'not_synced',
    }

    const res = isEdit
      ? await supabase.from('events').update(payload).eq('id', eventId)
      : await supabase.from('events').insert({ ...payload, created_by: profile.id }).select('id').single()

    if (res.error) { setSubmitting(false); setError(res.error.message); return }
    const targetId = isEdit ? eventId! : (res.data as { id: string }).id

    // audience: replace series-level rows
    await supabase.from('event_audiences').delete().eq('event_id', targetId).is('occurrence_id', null)
    const audRows: { org_id: string; event_id: string; kind: EventAudienceKind; ref_id: string | null }[] =
      audienceKind === 'all' || audienceKind === 'leadership'
        ? [{ org_id: orgId, event_id: targetId, kind: audienceKind, ref_id: null }]
        : audienceRefs.map((ref) => ({ org_id: orgId, event_id: targetId, kind: audienceKind, ref_id: ref }))
    if (audRows.length) await supabase.from('event_audiences').insert(audRows)

    if (!isEdit && status !== 'draft') {
      const { data: memberRows } = await supabase
        .from('memberships').select('user_id').eq('org_id', orgId).eq('status', 'active')
      const recipients = (memberRows ?? []).map((m) => m.user_id).filter((id) => id !== profile.id)
      if (recipients.length) {
        await notifyUsers(orgId, recipients, 'event_created', {
          text: `New ${isRecurring ? 'recurring ' : ''}event: "${title.trim()}"`,
          link: `/events/${targetId}`,
        }).catch(() => {})
      }
    }

    setSubmitting(false)
    navigate(`/events/${targetId}`)
  }

  if (loading) return <PageSkeleton />

  return (
    <div className="page" style={{ maxWidth: 620 }}>
      <h1>{isEdit ? 'Edit event' : 'Create event'}</h1>
      <form onSubmit={handleSubmit} className="set-sections">

        {/* Basics */}
        <section className="set-card">
          <div className="set-card-head"><h2>Details</h2></div>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Daily Business Training" /></label>
          <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="set-field-grid">
            <label>Category
              <select value={category} onChange={(e) => setCategory(e.target.value as EventCategory)}>
                {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{EVENT_CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label>Organizer
              <select value={organizerId} onChange={(e) => setOrganizerId(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
        </section>

        {/* Event type */}
        <section className="set-card">
          <div className="set-card-head"><h2>Event type</h2></div>
          <div className="seg-radio">
            <label><input type="radio" checked={!isRecurring} onChange={() => setIsRecurring(false)} /> One-time</label>
            <label><input type="radio" checked={isRecurring} onChange={() => setIsRecurring(true)} /> Recurring</label>
          </div>

          {!isRecurring ? (
            <div className="set-field-grid" style={{ marginTop: 12 }}>
              <label>Starts<input type="datetime-local" value={oneTimeStart} onChange={(e) => setOneTimeStart(e.target.value)} required /></label>
              <label>Ends<input type="datetime-local" value={oneTimeEnd} onChange={(e) => setOneTimeEnd(e.target.value)} required /></label>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <label>Frequency
                <select value={preset} onChange={(e) => setPreset(e.target.value as RecurrencePreset)}>
                  {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>

              {(preset === 'weekly' || preset === 'selected_days' || (preset === 'custom' && customFreq === 'weekly')) && (
                <div className="day-picker">
                  {WEEKDAY_LABELS.map((d, i) => (
                    <button type="button" key={d} className={weekdays.includes(i) ? 'on' : ''} onClick={() => toggleWeekday(i)}>{d}</button>
                  ))}
                </div>
              )}
              {preset === 'custom' && (
                <div className="set-field-grid">
                  <label>Repeat every
                    <input type="number" min={1} value={interval} onChange={(e) => setIntervalN(Math.max(1, Number(e.target.value)))} />
                  </label>
                  <label>Unit
                    <select value={customFreq} onChange={(e) => setCustomFreq(e.target.value as 'daily' | 'weekly')}>
                      <option value="daily">days</option><option value="weekly">weeks</option>
                    </select>
                  </label>
                </div>
              )}

              <div className="set-field-grid">
                <label>Series starts<input type="date" value={seriesStartDate} onChange={(e) => setSeriesStartDate(e.target.value)} required /></label>
                <label>Time<input type="time" value={localStartTime} onChange={(e) => setLocalStartTime(e.target.value)} required /></label>
              </div>
              <div className="set-field-grid">
                <label>Duration (minutes)<input type="number" min={5} step={5} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(5, Number(e.target.value)))} /></label>
                <label>Timezone
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {tzOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </label>
              </div>

              <label>Ends
                <select value={endType} onChange={(e) => setEndType(e.target.value as RecurrenceEndType)}>
                  <option value="never">Never</option>
                  <option value="until">On a date</option>
                  <option value="count">After N occurrences</option>
                </select>
              </label>
              {endType === 'until' && <label>End date<input type="date" value={recurrenceUntil} onChange={(e) => setRecurrenceUntil(e.target.value)} /></label>}
              {endType === 'count' && <label>Occurrences<input type="number" min={1} value={recurrenceCount} onChange={(e) => setRecurrenceCount(Math.max(1, Number(e.target.value)))} /></label>}

              {rulePreview && <p className="set-hint" style={{ marginTop: 4 }}>{rulePreview}{timezone ? ` · ${timezone}` : ''}</p>}
            </div>
          )}
        </section>

        {/* Location */}
        <section className="set-card">
          <div className="set-card-head"><h2>Location</h2></div>
          <div className="seg-radio">
            <label><input type="radio" checked={venueType === 'physical'} onChange={() => setVenueType('physical')} /> Physical</label>
            <label><input type="radio" checked={venueType === 'online'} onChange={() => setVenueType('online')} /> Online</label>
          </div>
          {venueType === 'physical' ? (
            <label style={{ marginTop: 12 }}>Venue / address<input value={venueLocation} onChange={(e) => setVenueLocation(e.target.value)} placeholder="Office HQ, 3rd floor" /></label>
          ) : (
            <div style={{ marginTop: 12 }}>
              <label>Meeting provider
                <select value={meetingProvider} onChange={(e) => setMeetingProvider(e.target.value as MeetingProvider)}>
                  <option value="external">External link (Zoom, Teams, Meet…)</option>
                  <option value="google_meet">Google Meet (auto-created)</option>
                </select>
              </label>
              {meetingProvider === 'external' ? (
                <label>Meeting link<input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://…" /></label>
              ) : (
                <p className="set-hint">
                  A Meet link is created through your office's connected Google account when the event is saved.
                  {' '}<Link to="/settings/integrations">Connect Google</Link> if you haven't. Until then the event saves without a link and shows “conference not created”.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Reminders */}
        <section className="set-card">
          <div className="set-card-head"><h2>Reminders</h2><p>One in-app reminder is recommended. Add more only if you need them.</p></div>
          <div className="chk-list">
            {REMINDER_WINDOWS.map((r) => (
              <label key={r.m}><input type="checkbox" checked={reminders.includes(r.m)} onChange={() => toggleReminder(r.m)} /> {r.label}</label>
            ))}
          </div>
          <label className="set-toggle" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={emailReminders} onChange={(e) => setEmailReminders(e.target.checked)} />
            <span><strong>Also send email reminders</strong><span className="set-hint">Off by default — in-app only avoids inbox spam for a daily meeting.</span></span>
          </label>
        </section>

        {/* Audience */}
        <section className="set-card">
          <div className="set-card-head"><h2>Audience</h2></div>
          <label>Who is this for?
            <select value={audienceKind} onChange={(e) => { setAudienceKind(e.target.value as EventAudienceKind); setAudienceRefs([]) }}>
              <option value="all">All members</option>
              <option value="leadership">Leadership only (admin, trainer, team leader)</option>
              <option value="team">Specific team(s)</option>
              <option value="rank">Specific rank(s)</option>
              <option value="member">Specific member(s)</option>
            </select>
          </label>
          {audienceKind === 'team' && <RefPicker options={teams} selected={audienceRefs} onToggle={toggleRef} empty="No teams yet." />}
          {audienceKind === 'rank' && <RefPicker options={ranks} selected={audienceRefs} onToggle={toggleRef} empty="No ranks configured." />}
          {audienceKind === 'member' && <RefPicker options={members} selected={audienceRefs} onToggle={toggleRef} empty="No members." />}
        </section>

        {/* Status */}
        <section className="set-card">
          <div className="set-card-head"><h2>Publish</h2></div>
          <div className="seg-radio">
            <label><input type="radio" checked={status === 'scheduled'} onChange={() => setStatus('scheduled')} /> Publish now</label>
            <label><input type="radio" checked={status === 'draft'} onChange={() => setStatus('draft')} /> Save as draft</label>
          </div>
        </section>

        {error && <p className="form-error">{error}</p>}
        <div className="set-actions" style={{ display: 'flex', gap: 10 }}>
          <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : isEdit ? 'Save changes' : isRecurring ? 'Create event series' : 'Create event'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

function RefPicker({ options, selected, onToggle, empty }: { options: Opt[]; selected: string[]; onToggle: (id: string) => void; empty: string }) {
  if (options.length === 0) return <p className="set-hint">{empty}</p>
  return (
    <div className="chk-list" style={{ marginTop: 8 }}>
      {options.map((o) => (
        <label key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} /> {o.label}</label>
      ))}
    </div>
  )
}
