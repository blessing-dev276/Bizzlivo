import { supabase } from './supabase'

export type TicketCategory = 'bug' | 'question' | 'billing' | 'feature_request' | 'other'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high'

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  bug: 'Report a problem',
  question: 'Question / how do I…',
  billing: 'Billing',
  feature_request: 'Feature request',
  other: 'Something else',
}
export const STATUS_LABEL: Record<TicketStatus, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'blue' },
  in_progress: { label: 'In Progress', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  closed: { label: 'Closed', tone: 'muted' },
}

export interface SupportTicket {
  id: string
  org_id: string
  created_by: string
  category: TicketCategory
  subject: string
  description: string
  priority: TicketPriority
  status: TicketStatus
  admin_note: string | null
  handled_by: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export const loadMyTickets = (userId: string) =>
  supabase.from('support_tickets').select('*').eq('created_by', userId).order('created_at', { ascending: false })

export const loadOrgTickets = (orgId: string) =>
  supabase
    .from('support_tickets')
    .select('*, creator:profiles!support_tickets_created_by_fkey(full_name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

export const createTicket = (row: {
  org_id: string
  created_by: string
  category: TicketCategory
  subject: string
  description: string
  priority: TicketPriority
}) => supabase.from('support_tickets').insert({ ...row, status: 'open' })

export const updateTicket = (id: string, patch: Partial<SupportTicket>) =>
  supabase.from('support_tickets').update({
    ...patch,
    updated_at: new Date().toISOString(),
    ...(patch.status === 'resolved' || patch.status === 'closed' ? { resolved_at: new Date().toISOString() } : {}),
  }).eq('id', id)

// Static Help Center content — links into the app + short explainers.
export const HELP_ARTICLES: { title: string; body: string; to?: string }[] = [
  { title: 'Business Path', body: 'Your office defines a ladder of ranks. Each rank has required Learning and Task items — finish them all to be promoted (automatically, or on staff approval).', to: '/business-path' },
  { title: 'Goals', body: 'Plan monthly and 90-day goals, track progress, then submit finished goals for office review. Approved goals can satisfy Business Path requirements.', to: '/goals' },
  { title: 'My Network', body: 'Track prospects and follow-ups, see who you sponsored, and share your referral link so new members join connected to you.', to: '/my-team' },
  { title: 'Wallet & Finance', body: 'Your Wallet shows verified earnings and available balance. Withdrawals are requested from the Wallet and approved by your office.', to: '/wallet' },
  { title: 'Notifications', body: 'The Notification Center collects everything that needs your attention. Choose which categories you receive in Settings → Notifications.', to: '/notifications' },
]
