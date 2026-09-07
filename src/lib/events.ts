import type { EventCategory, HQEvent } from '../types/database'
import type { OccurrenceDisplayStatus, ResolvedOccurrence } from './eventSeries'

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  orientation: 'Orientation',
  leadership_meeting: 'Leadership Meeting',
  network_marketing_training: 'Network Marketing Training',
  freelancing_training: 'Freelancing Training',
  skill_development_class: 'Skill Development Class',
  product_training: 'Product Training',
  workshop: 'Workshop',
  webinar: 'Webinar',
  recognition_event: 'Recognition Event',
  team_meeting: 'Team Meeting',
  office_announcement: 'Office Announcement',
  neolife_meeting: 'NeoLife Meeting',
  assignment_deadline: 'Assignment Deadline',
  custom_event: 'Custom Event',
  training_session: 'Training Session',
}

export const EVENT_CATEGORIES = Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]

export type DisplayStatus = 'Draft' | 'Scheduled' | 'Live' | 'Completed' | 'Cancelled'

// "Live"/"Completed" aren't stored — they're derived from the time window so
// nothing needs a background job to flip status the instant an event starts
// or ends. Only draft/scheduled/cancelled are ever written to the DB.
export function displayStatus(event: Pick<HQEvent, 'status' | 'start_at' | 'end_at'>): DisplayStatus {
  if (event.status === 'cancelled') return 'Cancelled'
  if (event.status === 'draft') return 'Draft'
  const now = Date.now()
  const start = new Date(event.start_at).getTime()
  const end = new Date(event.end_at).getTime()
  if (now < start) return 'Scheduled'
  if (now <= end) return 'Live'
  return 'Completed'
}

export function statusBadgeClass(status: DisplayStatus | OccurrenceDisplayStatus): string {
  if (status === 'Live' || status === 'live') return 'active'
  if (status === 'Cancelled' || status === 'cancelled') return 'rejected'
  return ''
}

// ---- occurrence helpers (Phase B) -----------------------------------------

/** How long until an occurrence starts / how long it's been live, phrased. */
export function relativeStart(startAt: Date, endAt: Date, now: Date = new Date()): string {
  const ms = startAt.getTime() - now.getTime()
  if (ms <= 0) {
    return now <= endAt ? 'Live now' : 'Ended'
  }
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `Starts in ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Starts in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `Starts in ${days} day${days === 1 ? '' : 's'}`
}

/** Join button policy: online, has a URL, not cancelled, and within
 *  [start − 15 min, end]. Admins can widen this later; this is the default. */
export function canJoinNow(o: Pick<ResolvedOccurrence, 'venueType' | 'meetingUrl' | 'status' | 'startAt' | 'endAt'>, now: Date = new Date()): boolean {
  if (o.venueType !== 'online' || !o.meetingUrl || o.status === 'cancelled') return false
  return now >= new Date(o.startAt.getTime() - 15 * 60000) && now <= o.endAt
}

export function occurrenceStatusLabel(s: OccurrenceDisplayStatus): string {
  return { scheduled: 'Scheduled', live: 'Live now', completed: 'Completed', cancelled: 'Cancelled' }[s]
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Today", "Tomorrow", or "Thu 12 Sep" for an occurrence date. */
export function dayLabel(d: Date, now: Date = new Date()): string {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  return `${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })}`
}
