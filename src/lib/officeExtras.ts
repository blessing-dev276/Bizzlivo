// Shared domain layer for the connected-OS phases 3/4/5:
// Notification Center, Office Announcements, Admin Member 360.
import { supabase } from './supabase'

// ============================================================
// Notifications v2
// ============================================================
export type NotifCategory =
  | 'action' | 'business' | 'goals' | 'learning' | 'finance' | 'office' | 'network' | 'freelance' | 'system'

export const NOTIF_TABS: { id: 'all' | NotifCategory; label: string; match?: NotifCategory[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Action', match: ['action', 'goals'] },
  { id: 'business', label: 'Business', match: ['business', 'network', 'freelance'] },
  { id: 'learning', label: 'Learning', match: ['learning'] },
  { id: 'finance', label: 'Finance', match: ['finance'] },
  { id: 'office', label: 'Office', match: ['office'] },
]

export interface NotifRow {
  id: string
  type: string
  category: string | null
  payload: { text?: string; link?: string } | null
  read_at: string | null
  created_at: string
}

export async function loadNotifications(userId: string, limit = 60): Promise<NotifRow[]> {
  const { data } = await supabase
    .from('notifications')
    .select('id, type, category, payload, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data as NotifRow[]) ?? []
}
export const markNotificationRead = (id: string) =>
  supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
export const markAllNotificationsRead = (ids: string[]) =>
  supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)

export interface NotificationPrefs {
  goal_reminders: boolean
  learning: boolean
  finance: boolean
  events: boolean
  announcements: boolean
  // Email mirror (0053). email_account is always-on and not user-editable.
  email_goals: boolean
  email_finance: boolean
  email_events: boolean
  email_announcements: boolean
  email_learning: boolean
}
export const DEFAULT_PREFS: NotificationPrefs = {
  goal_reminders: true, learning: true, finance: true, events: true, announcements: true,
  email_goals: true, email_finance: true, email_events: true, email_announcements: true,
  email_learning: false,
}
export async function loadPrefs(userId: string): Promise<NotificationPrefs> {
  const { data } = await supabase.from('notification_prefs').select('*').eq('user_id', userId).maybeSingle()
  return { ...DEFAULT_PREFS, ...(data as Partial<NotificationPrefs> | null) }
}
export const savePrefs = (userId: string, prefs: NotificationPrefs) =>
  supabase.from('notification_prefs').upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() })

// ============================================================
// Office Announcements
// ============================================================
export type AnnouncementAudience = 'all' | 'team' | 'rank' | 'members'
export type AnnouncementPriority = 'low' | 'normal' | 'high'

export interface Announcement {
  id: string
  org_id: string
  title: string
  body: string
  audience_type: AnnouncementAudience
  audience_ids: string[]
  priority: AnnouncementPriority
  link: string | null
  related_event_id: string | null
  publish_at: string
  expires_at: string | null
  pinned: boolean
  requires_ack: boolean
  created_by: string
  created_at: string
}
export interface AnnouncementRead {
  announcement_id: string
  user_id: string
  read_at: string | null
  acked_at: string | null
}

export async function loadMemberAnnouncements(userId: string): Promise<{ items: Announcement[]; reads: Map<string, AnnouncementRead> }> {
  const { data } = await supabase
    .from('office_announcements')
    .select('*')
    .order('pinned', { ascending: false })
    .order('publish_at', { ascending: false })
  const items = (data as Announcement[]) ?? []
  const { data: r } = await supabase
    .from('announcement_reads')
    .select('*')
    .eq('user_id', userId)
    .in('announcement_id', items.map((a) => a.id).length ? items.map((a) => a.id) : ['00000000-0000-0000-0000-000000000000'])
  const reads = new Map<string, AnnouncementRead>()
  for (const row of (r as AnnouncementRead[]) ?? []) reads.set(row.announcement_id, row)
  return { items, reads }
}
export const markAnnouncementRead = (announcementId: string, userId: string) =>
  supabase.from('announcement_reads').upsert(
    { announcement_id: announcementId, user_id: userId, read_at: new Date().toISOString() },
    { onConflict: 'announcement_id,user_id' },
  )
export const ackAnnouncement = (announcementId: string, userId: string) =>
  supabase.from('announcement_reads').upsert(
    { announcement_id: announcementId, user_id: userId, read_at: new Date().toISOString(), acked_at: new Date().toISOString() },
    { onConflict: 'announcement_id,user_id' },
  )

export async function loadAdminAnnouncements(orgId: string): Promise<Announcement[]> {
  const { data } = await supabase
    .from('office_announcements')
    .select('*')
    .eq('org_id', orgId)
    .order('publish_at', { ascending: false })
  return (data as Announcement[]) ?? []
}
export const createAnnouncement = (row: Partial<Announcement> & { org_id: string; created_by: string; title: string; body: string }) =>
  supabase.from('office_announcements').insert(row)
export const updateAnnouncement = (id: string, patch: Partial<Announcement>) =>
  supabase.from('office_announcements').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
export const deleteAnnouncement = (id: string) =>
  supabase.from('office_announcements').delete().eq('id', id)

// ============================================================
// Admin Member 360
// ============================================================
export interface Member360 {
  name: string
  avatar_url: string | null
  role: string
  membership_status: string
  team: string | null
  rank: string | null
  rank_started_at: string | null
  bp_required_total: number
  bp_required_done: number
  bp_percent: number
  bp_items: { title: string; required: boolean; complete: boolean }[]
  goals_total: number
  goals_done: number
  goals_this_month: number
  goals_changes_requested: number
  direct_members: number
  prospects: number
  prospect_followups_overdue: number
  freelance_prospects: number
  freelance_clients: number
  freelance_projects_open: number
  freelance_projects_overdue: number
  freelance_verified_earnings: number
  available_balance: unknown
  income_total: number
  exams_passed: number
  joined_at: string | null
  last_activity: string | null
  _error?: string
}
export async function loadMember360(orgId: string, userId: string): Promise<Member360> {
  const { data, error } = await supabase.rpc('report_member', { p_org: orgId, p_user: userId })
  if (error) throw new Error(error.message)
  const d = data as Member360
  if (d?._error) throw new Error(d._error)
  return d
}

export function member360Attention(m: Member360): string[] {
  const out: string[] = []
  if (m.goals_this_month === 0) out.push('No goals set for this month')
  if (m.goals_changes_requested > 0) out.push(`${m.goals_changes_requested} goal change${m.goals_changes_requested > 1 ? 's' : ''} requested`)
  if (m.prospect_followups_overdue > 0) out.push(`${m.prospect_followups_overdue} overdue prospect follow-up${m.prospect_followups_overdue > 1 ? 's' : ''}`)
  if (m.freelance_projects_overdue > 0) out.push(`${m.freelance_projects_overdue} freelance project${m.freelance_projects_overdue > 1 ? 's' : ''} past due`)
  if (m.rank_started_at) {
    const days = Math.floor((Date.now() - new Date(m.rank_started_at).getTime()) / 86_400_000)
    if (days >= 21 && m.bp_percent < 50) out.push(`Business Path stalled ${days} days at ${m.bp_percent}%`)
  }
  return out
}
