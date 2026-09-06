// Freelance Workspace domain layer — the member-facing CRM for the
// freelancing side of the business (prospects → clients → projects).
// Separate from Network Marketing (my-team); money still lives in Finance
// (freelance_projects.finance_order_id links to an admin-verified order).
// See 0049_freelance.sql.
import { supabase } from '../supabase'

export type FreelanceProspectStatus =
  | 'lead' | 'contacted' | 'replied' | 'negotiating' | 'proposal_sent' | 'won' | 'lost'
export type FreelanceProjectStatus =
  | 'new' | 'in_progress' | 'delivered' | 'revision' | 'completed' | 'cancelled'

export const PROSPECT_STATUS: { id: FreelanceProspectStatus; label: string; tone: string }[] = [
  { id: 'lead', label: 'Lead', tone: 'neutral' },
  { id: 'contacted', label: 'Contacted', tone: 'blue' },
  { id: 'replied', label: 'Replied', tone: 'blue' },
  { id: 'negotiating', label: 'Negotiating', tone: 'amber' },
  { id: 'proposal_sent', label: 'Proposal Sent', tone: 'amber' },
  { id: 'won', label: 'Won', tone: 'green' },
  { id: 'lost', label: 'Lost', tone: 'muted' },
]
export const PROJECT_STATUS: { id: FreelanceProjectStatus; label: string; tone: string }[] = [
  { id: 'new', label: 'New', tone: 'neutral' },
  { id: 'in_progress', label: 'In Progress', tone: 'blue' },
  { id: 'delivered', label: 'Delivered', tone: 'amber' },
  { id: 'revision', label: 'Revision', tone: 'amber' },
  { id: 'completed', label: 'Completed', tone: 'green' },
  { id: 'cancelled', label: 'Cancelled', tone: 'muted' },
]
export const PLATFORMS = ['Fiverr', 'Upwork', 'Contra', 'LinkedIn', 'Instagram', 'Direct', 'Referral', 'Other']
export const PROSPECT_OPEN: FreelanceProspectStatus[] = ['lead', 'contacted', 'replied', 'negotiating', 'proposal_sent']
export const PROJECT_OPEN: FreelanceProjectStatus[] = ['new', 'in_progress', 'delivered', 'revision']

export interface FreelanceClient {
  id: string
  org_id: string
  member_id: string
  name: string
  company: string | null
  platform: string | null
  contact_link: string | null
  services: string[]
  notes: string | null
  created_at: string
  updated_at: string
}
export interface FreelanceProspect {
  id: string
  org_id: string
  member_id: string
  name: string
  company: string | null
  platform: string | null
  service: string | null
  contact_link: string | null
  status: FreelanceProspectStatus
  expected_value: number | null
  currency: string | null
  source: string | null
  last_contacted_at: string | null
  next_follow_up_at: string | null
  notes: string | null
  converted_client_id: string | null
  created_at: string
  updated_at: string
}
export interface FreelanceProject {
  id: string
  org_id: string
  member_id: string
  client_id: string | null
  prospect_id: string | null
  title: string
  service: string | null
  platform: string | null
  order_value: number | null
  currency: string | null
  start_date: string | null
  due_date: string | null
  status: FreelanceProjectStatus
  notes: string | null
  next_follow_up_at: string | null
  follow_up_note: string | null
  finance_order_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
export interface FreelanceActivity {
  id: string
  org_id: string
  member_id: string
  prospect_id: string | null
  client_id: string | null
  project_id: string | null
  kind: string
  note: string
  created_at: string
}

export function money(v: number | null | undefined, currency?: string | null): string {
  if (v == null) return '—'
  const n = Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
  return currency ? `${currency} ${n}` : `₦${n}`
}
const now = () => new Date().toISOString()
const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ---------- reads ----------
export interface FreelanceData {
  prospects: FreelanceProspect[]
  clients: FreelanceClient[]
  projects: FreelanceProject[]
  activities: FreelanceActivity[]
}
export async function loadFreelance(orgId: string, userId: string): Promise<FreelanceData> {
  const [p, c, pr, a] = await Promise.all([
    supabase.from('freelance_prospects').select('*').eq('org_id', orgId).eq('member_id', userId).order('created_at', { ascending: false }),
    supabase.from('freelance_clients').select('*').eq('org_id', orgId).eq('member_id', userId).order('name'),
    supabase.from('freelance_projects').select('*').eq('org_id', orgId).eq('member_id', userId).order('created_at', { ascending: false }),
    supabase.from('freelance_activities').select('*').eq('org_id', orgId).eq('member_id', userId).order('created_at', { ascending: false }).limit(40),
  ])
  return {
    prospects: (p.data as FreelanceProspect[]) ?? [],
    clients: (c.data as FreelanceClient[]) ?? [],
    projects: (pr.data as FreelanceProject[]) ?? [],
    activities: (a.data as FreelanceActivity[]) ?? [],
  }
}

export interface FreelanceAttention {
  prospectFollowupsDue: number
  projectFollowupsDue: number
  projectsOverdue: number
  proposalsOut: number
}
export function attentionFrom(d: Pick<FreelanceData, 'prospects' | 'projects'>): FreelanceAttention {
  const t = startOfToday().getTime()
  return {
    prospectFollowupsDue: d.prospects.filter(
      (x) => PROSPECT_OPEN.includes(x.status) && x.next_follow_up_at && new Date(x.next_follow_up_at).getTime() <= Date.now(),
    ).length,
    projectFollowupsDue: d.projects.filter(
      (x) => PROJECT_OPEN.includes(x.status) && x.next_follow_up_at && new Date(x.next_follow_up_at).getTime() <= Date.now(),
    ).length,
    projectsOverdue: d.projects.filter(
      (x) => PROJECT_OPEN.includes(x.status) && x.due_date && new Date(x.due_date).getTime() < t,
    ).length,
    proposalsOut: d.prospects.filter((x) => x.status === 'proposal_sent').length,
  }
}

// ---------- writes ----------
export const fl = {
  addProspect: (orgId: string, userId: string, patch: Partial<FreelanceProspect>) =>
    supabase.from('freelance_prospects').insert({ org_id: orgId, member_id: userId, name: 'New prospect', ...patch }),
  updateProspect: (id: string, patch: Partial<FreelanceProspect>) =>
    supabase.from('freelance_prospects').update({ ...patch, updated_at: now() }).eq('id', id),
  deleteProspect: (id: string) => supabase.from('freelance_prospects').delete().eq('id', id),

  addClient: (orgId: string, userId: string, patch: Partial<FreelanceClient>) =>
    supabase.from('freelance_clients').insert({ org_id: orgId, member_id: userId, name: 'New client', ...patch }).select().single(),
  updateClient: (id: string, patch: Partial<FreelanceClient>) =>
    supabase.from('freelance_clients').update({ ...patch, updated_at: now() }).eq('id', id),
  deleteClient: (id: string) => supabase.from('freelance_clients').delete().eq('id', id),

  addProject: (orgId: string, userId: string, patch: Partial<FreelanceProject>) =>
    supabase.from('freelance_projects').insert({ org_id: orgId, member_id: userId, title: 'New project', ...patch }),
  updateProject: (id: string, patch: Partial<FreelanceProject>) =>
    supabase.from('freelance_projects').update({ ...patch, updated_at: now() }).eq('id', id),
  deleteProject: (id: string) => supabase.from('freelance_projects').delete().eq('id', id),

  logActivity: (orgId: string, userId: string, ref: { prospect_id?: string; client_id?: string; project_id?: string }, kind: string, note: string) =>
    supabase.from('freelance_activities').insert({ org_id: orgId, member_id: userId, kind, note, ...ref }),
}

// Convert a won prospect into a client (idempotent-ish: reuses the link).
export async function convertProspectToClient(p: FreelanceProspect): Promise<string | null> {
  if (p.converted_client_id) return p.converted_client_id
  const { data, error } = await fl.addClient(p.org_id, p.member_id, {
    name: p.name,
    company: p.company,
    platform: p.platform,
    contact_link: p.contact_link,
    services: p.service ? [p.service] : [],
  })
  if (error || !data) return null
  const clientId = (data as FreelanceClient).id
  await fl.updateProspect(p.id, { status: 'won', converted_client_id: clientId })
  await fl.logActivity(p.org_id, p.member_id, { prospect_id: p.id, client_id: clientId }, 'status_change', 'Converted to client')
  return clientId
}

// Lazy follow-up nudge — one "freelance follow-ups due" notification per
// member per day (deduped by a same-day check; Phase 3's Notification
// Center replaces this with a proper dedupe_key RPC).
export async function runFreelanceMaintenance(orgId: string, userId: string, attention: FreelanceAttention) {
  const due = attention.prospectFollowupsDue + attention.projectFollowupsDue + attention.projectsOverdue
  if (due === 0) return
  try {
    const since = startOfToday().toISOString()
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'freelance_followup')
      .gte('created_at', since)
    if ((count ?? 0) > 0) return
    await supabase.from('notifications').insert({
      org_id: orgId,
      user_id: userId,
      type: 'freelance_followup',
      channel: 'in_app',
      payload: { text: `${due} freelance follow-up${due === 1 ? '' : 's'} need attention`, link: '/freelance' },
      status: 'sent',
    })
  } catch {
    /* non-fatal */
  }
}
