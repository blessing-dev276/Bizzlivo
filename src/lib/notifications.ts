// Best-effort in-app notification helpers. Every call site wraps these in
// try/catch and ignores failures — a notification failing to send should
// never block the primary action (assigning an exam, submitting work, etc).
import { supabase } from './supabase'
import type { NotificationPayload } from '../types/database'

type Target = { kind: 'user' | 'group'; id: string }

/** Resolves group targets to member ids via group_members, merges with direct user ids, dedupes. */
export async function expandTargetsToUserIds(targets: Target[]): Promise<string[]> {
  const directIds = targets.filter((t) => t.kind === 'user').map((t) => t.id)
  const groupIds = targets.filter((t) => t.kind === 'group').map((t) => t.id)

  const groupMemberIds: string[] = []
  if (groupIds.length > 0) {
    const { data } = await supabase.from('group_members').select('user_id').in('group_id', groupIds)
    for (const row of data ?? []) groupMemberIds.push(row.user_id)
  }

  return [...new Set([...directIds, ...groupMemberIds])]
}

export async function notifyUsers(orgId: string, userIds: string[], type: string, payload: NotificationPayload) {
  const uniqueIds = [...new Set(userIds)]
  if (uniqueIds.length === 0) return
  await supabase.from('notifications').insert(
    uniqueIds.map((userId) => ({
      org_id: orgId,
      user_id: userId,
      type,
      channel: 'in_app',
      payload,
      status: 'sent',
    }))
  )
}

export async function notifyOrgAdmins(orgId: string, type: string, payload: NotificationPayload) {
  const { data } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('role', ['admin', 'trainer'])
  const adminIds = (data ?? []).map((m) => m.user_id)
  await notifyUsers(orgId, adminIds, type, payload)
}
