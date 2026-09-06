// Office setup checklist — derived from real source data, no state table.
// Only `organizations.setup_dismissed_at` is stored (to hide it once done
// or explicitly dismissed).
import { supabase } from './supabase'

export interface SetupStep {
  key: string
  label: string
  route: string
  done: boolean
}

export async function loadOfficeSetup(orgId: string): Promise<{ steps: SetupStep[]; dismissed: boolean }> {
  const head = { count: 'exact' as const, head: true }
  const [org, ranks, modules, members, events] = await Promise.all([
    supabase.from('organizations').select('logo_url, whatsapp_number, base_currency, setup_dismissed_at').eq('id', orgId).maybeSingle(),
    supabase.from('business_path_ranks').select('id', head).eq('org_id', orgId).eq('is_active', true),
    supabase.from('class_modules').select('id, classes!inner(org_id, status)', head).eq('classes.org_id', orgId).eq('status', 'published').eq('classes.status', 'published'),
    supabase.from('memberships').select('id', head).eq('org_id', orgId).eq('status', 'active'),
    supabase.from('events').select('id', head).eq('org_id', orgId),
  ])
  const o = (org.data as { logo_url: string | null; whatsapp_number: string | null; base_currency: string | null; setup_dismissed_at: string | null } | null) ?? null

  const steps: SetupStep[] = [
    { key: 'profile', label: 'Complete your office profile', route: '/settings', done: !!(o?.whatsapp_number) },
    { key: 'brand', label: 'Upload a logo / brand', route: '/settings', done: !!o?.logo_url },
    { key: 'business_path', label: 'Configure your Business Path', route: '/business-path', done: (ranks.count ?? 0) > 0 },
    { key: 'learning', label: 'Set up the Learning Center', route: '/training', done: (modules.count ?? 0) > 0 },
    { key: 'members', label: 'Invite your first members', route: '/invites', done: (members.count ?? 0) > 1 },
    { key: 'finance', label: 'Configure Finance (base currency)', route: '/finance', done: !!o?.base_currency },
    { key: 'event', label: 'Create your first event', route: '/events/new', done: (events.count ?? 0) > 0 },
  ]
  return { steps, dismissed: !!o?.setup_dismissed_at }
}

export const dismissOfficeSetup = (orgId: string) =>
  supabase.from('organizations').update({ setup_dismissed_at: new Date().toISOString() }).eq('id', orgId)
