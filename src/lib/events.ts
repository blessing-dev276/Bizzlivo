import type { EventCategory, HQEvent } from '../types/database'

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

export function statusBadgeClass(status: DisplayStatus): string {
  if (status === 'Live') return 'active'
  if (status === 'Completed') return ''
  if (status === 'Cancelled') return 'rejected'
  return ''
}
