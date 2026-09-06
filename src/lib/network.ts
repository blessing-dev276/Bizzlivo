// My Network — builds a member's sponsorship tree from data they are
// already allowed to read: active memberships in the current office, the
// matching profiles (which expose sponsor_member_id via the existing
// "org-mates' profiles" SELECT policy), and each member's Business Path
// rank. No RPC, no service role, no per-node queries — four bulk reads,
// assembled client-side. Org isolation is enforced by RLS on every query
// (each is scoped to org_id / active membership).
import { supabase } from './supabase'
import type { MembershipRole, MembershipStatus, Profile } from '../types/database'

export interface NetworkPerson {
  id: string
  fullName: string
  avatarUrl: string | null
  status: string | null
  sponsorMemberId: string | null
  role: MembershipRole | null
  membershipStatus: MembershipStatus | null
  joinedAt: string | null
  rankName: string | null
  rankColor: string | null
  /** true when this person still holds an active membership in the office */
  active: boolean
}

export interface NetworkNode {
  person: NetworkPerson
  generation: number
  children: NetworkNode[]
  directCount: number
  totalCount: number
  activeCount: number
}

export interface NetworkSummary {
  total: number
  direct: number
  active: number
  removed: number
  generations: number
  perGeneration: number[]
}

export interface NetworkData {
  root: NetworkNode
  /** every descendant node, breadth-first, excluding the root */
  flat: NetworkNode[]
  byId: Map<string, NetworkNode>
  summary: NetworkSummary
}

export async function loadNetwork(orgId: string, rootUserId: string): Promise<NetworkData | null> {
  const { data: membershipRows } = await supabase
    .from('memberships')
    .select('user_id, role, status, joined_at')
    .eq('org_id', orgId)

  const memberships = (membershipRows as
    | { user_id: string; role: MembershipRole; status: MembershipStatus; joined_at: string }[]
    | null) ?? []
  const membershipByUser = new Map(memberships.map((m) => [m.user_id, m]))
  const userIds = memberships.map((m) => m.user_id)
  if (userIds.length === 0) return null

  const [{ data: profileRows }, { data: rankRows }, { data: progressRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, avatar_url, status, sponsor_member_id, sponsor_name, referral_code, created_at')
      .in('id', userIds),
    supabase.from('business_path_ranks').select('id, name, color').eq('org_id', orgId),
    supabase.from('member_rank_progress').select('user_id, current_rank_id').eq('org_id', orgId),
  ])

  const profiles = (profileRows as Profile[] | null) ?? []
  const rankById = new Map(
    ((rankRows as { id: string; name: string; color: string | null }[] | null) ?? []).map((r) => [r.id, r]),
  )
  const rankByUser = new Map(
    ((progressRows as { user_id: string; current_rank_id: string | null }[] | null) ?? []).map((p) => [
      p.user_id,
      p.current_rank_id,
    ]),
  )

  const people = new Map<string, NetworkPerson>()
  for (const p of profiles) {
    const m = membershipByUser.get(p.id) ?? null
    const rankId = rankByUser.get(p.id) ?? null
    const rank = rankId ? rankById.get(rankId) : undefined
    people.set(p.id, {
      id: p.id,
      fullName: p.full_name,
      avatarUrl: p.avatar_url,
      status: p.status,
      sponsorMemberId: p.sponsor_member_id,
      role: m?.role ?? null,
      membershipStatus: m?.status ?? null,
      joinedAt: m?.joined_at ?? null,
      rankName: rank?.name ?? null,
      rankColor: rank?.color ?? null,
      active: m?.status === 'active',
    })
  }

  const childrenByParent = new Map<string, string[]>()
  for (const p of people.values()) {
    if (!p.sponsorMemberId || !people.has(p.sponsorMemberId)) continue
    const list = childrenByParent.get(p.sponsorMemberId) ?? []
    list.push(p.id)
    childrenByParent.set(p.sponsorMemberId, list)
  }

  const rootPerson = people.get(rootUserId)
  if (!rootPerson) return null

  const byId = new Map<string, NetworkNode>()
  const visited = new Set<string>()

  function build(id: string, generation: number): NetworkNode {
    visited.add(id)
    const childIds = (childrenByParent.get(id) ?? []).filter((c) => !visited.has(c))
    const children = childIds
      .map((c) => build(c, generation + 1))
      .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName))

    let totalCount = children.length
    let activeCount = 0
    for (const child of children) {
      totalCount += child.totalCount
      activeCount += child.activeCount + (child.person.active ? 1 : 0)
    }

    const node: NetworkNode = {
      person: people.get(id)!,
      generation,
      children,
      directCount: children.length,
      totalCount,
      activeCount,
    }
    byId.set(id, node)
    return node
  }

  const root = build(rootUserId, 0)

  const flat: NetworkNode[] = []
  const queue = [...root.children]
  while (queue.length) {
    const n = queue.shift()!
    flat.push(n)
    queue.push(...n.children)
  }

  const perGeneration: number[] = []
  for (const n of flat) {
    perGeneration[n.generation - 1] = (perGeneration[n.generation - 1] ?? 0) + 1
  }
  for (let i = 0; i < perGeneration.length; i++) perGeneration[i] ??= 0

  const summary: NetworkSummary = {
    total: flat.length,
    direct: root.directCount,
    active: flat.filter((n) => n.person.active).length,
    removed: flat.filter((n) => !n.person.active).length,
    generations: perGeneration.length,
    perGeneration,
  }

  return { root, flat, byId, summary }
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
