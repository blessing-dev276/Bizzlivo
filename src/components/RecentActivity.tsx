import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// Permission matrix from the spec: Admin sees everything ('full'), Trainer
// sees a training-relevant slice, Team Leader sees just their team's
// activity, and a plain Member sees only their own — everyone gets
// *something*, unlike AI Office Insights where plain members get nothing.
type AccessTier = 'full' | 'relevant' | 'team' | 'personal'
type Bucket = 'members' | 'teams' | 'training' | 'office' | 'events'
const FILTERS: { key: Bucket | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'members', label: 'Members' },
  { key: 'teams', label: 'Teams' },
  { key: 'training', label: 'Training' },
  { key: 'office', label: 'Office' },
  { key: 'events', label: 'Events' },
]
const FEED_LIMIT = 20
const PER_KIND_LIMIT = 10

interface FeedItem {
  key: string
  bucket: Bucket
  actorName: string | null
  actorAvatarUrl: string | null
  text: string
  at: string
  status?: { label: string; tone: 'good' | 'bad' }
}

interface ProfileLite {
  full_name: string
  avatar_url: string | null
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0]?.toUpperCase() || '?'
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function Avatar({ name, url }: { name: string | null; url: string | null }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) return <img className="avatar log-avatar" src={url} onError={() => setFailed(true)} alt="" />
  return <div className="avatar log-avatar">{name ? initialsOf(name) : '?'}</div>
}

export default function RecentActivity() {
  const { currentMembership, profile } = useAuth()
  const role = currentMembership?.role
  const orgId = currentMembership?.organization.id

  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Bucket | 'all'>('all')
  const [search, setSearch] = useState('')

  const access: AccessTier =
    role === 'admin' ? 'full' : role === 'trainer' ? 'relevant' : role === 'team_leader' ? 'team' : 'personal'

  const availableFilters = access === 'relevant' ? FILTERS.filter((f) => f.key !== 'teams') : access === 'team' || access === 'personal' ? FILTERS.filter((f) => f.key === 'all' || f.key === 'members' || f.key === 'teams' || f.key === 'training') : FILTERS

  useEffect(() => {
    if (!orgId || !profile) return
    let cancelled = false

    async function load(org: string, userId: string) {
      setLoading(true)
      const results: FeedItem[] = []

      // Scope: who this tier's "member-level" items (attempts/coursework/
      // joins) are drawn from — everyone in the org for full/relevant, just
      // the leader's own team for 'team', just themselves for 'personal'.
      let scopeUserIds: string[] | null = null
      let ledGroupIds: string[] = []
      if (access === 'team') {
        const { data: led } = await supabase.from('groups').select('id').eq('org_id', org).eq('leader_id', userId)
        ledGroupIds = (led ?? []).map((g) => g.id)
        if (ledGroupIds.length === 0) {
          if (!cancelled) {
            setItems([])
            setLoading(false)
          }
          return
        }
        const { data: members } = await supabase.from('group_members').select('user_id').in('group_id', ledGroupIds)
        scopeUserIds = [...new Set((members ?? []).map((m) => m.user_id))]
      } else if (access === 'personal') {
        scopeUserIds = [userId]
      }

      const includeOrgActions = access === 'full' || access === 'relevant'
      const includeTeamManagement = access === 'full' || access === 'team'

      const attemptsQuery = supabase
        .from('attempts')
        .select('user_id, taker_name, is_guest, passed, submitted_at, profile:profiles(full_name, avatar_url), exam:exams(title)')
        .eq('org_id', org)
        .eq('status', 'submitted')
        .not('submitted_at', 'is', null)
        .order('submitted_at', { ascending: false })
        .limit(PER_KIND_LIMIT)
      const courseworkQuery = supabase
        .from('coursework_submissions')
        .select('user_id, status, submitted_at, reviewed_at, profile:profiles(full_name, avatar_url), assignment:coursework_assignments(title)')
        .eq('org_id', org)
        .order('submitted_at', { ascending: false })
        .limit(PER_KIND_LIMIT)
      const joinsQuery = supabase
        .from('memberships')
        .select('user_id, joined_at, profile:profiles(full_name, avatar_url)')
        .eq('org_id', org)
        .eq('status', 'active')
        .order('joined_at', { ascending: false })
        .limit(PER_KIND_LIMIT)

      if (scopeUserIds) {
        attemptsQuery.in('user_id', scopeUserIds)
        courseworkQuery.in('user_id', scopeUserIds)
        joinsQuery.in('user_id', scopeUserIds)
      } else {
        attemptsQuery.eq('is_guest', false)
      }

      const queries: PromiseLike<unknown>[] = [attemptsQuery, courseworkQuery, joinsQuery]
      if (includeTeamManagement) {
        queries.push(
          supabase
            .from('group_members')
            .select('user_id, created_at, profile:profiles(full_name, avatar_url), group:groups(name)')
            .in('group_id', ledGroupIds.length > 0 ? ledGroupIds : (await supabase.from('groups').select('id').eq('org_id', org)).data?.map((g) => g.id) ?? [])
            .order('created_at', { ascending: false })
            .limit(PER_KIND_LIMIT),
        )
      }
      if (includeOrgActions) {
        queries.push(
          supabase.from('resources').select('title, created_at, profile:profiles!uploaded_by(full_name, avatar_url)').eq('org_id', org).order('created_at', { ascending: false }).limit(PER_KIND_LIMIT),
          supabase.from('exams').select('title, status, created_at, profile:profiles!created_by(full_name, avatar_url)').eq('org_id', org).order('created_at', { ascending: false }).limit(PER_KIND_LIMIT),
          supabase.from('invites').select('email, created_at, profile:profiles!invited_by(full_name, avatar_url)').eq('org_id', org).order('created_at', { ascending: false }).limit(PER_KIND_LIMIT),
          supabase.from('events').select('title, created_at, profile:profiles!organizer_id(full_name, avatar_url)').eq('org_id', org).order('created_at', { ascending: false }).limit(PER_KIND_LIMIT),
        )
      }
      if (access === 'full') {
        queries.push(supabase.from('groups').select('name, created_at').eq('org_id', org).order('created_at', { ascending: false }).limit(PER_KIND_LIMIT))
      }

      const settled = await Promise.all(queries)
      if (cancelled) return

      const [attemptsRes, courseworkRes, joinsRes, ...rest] = settled as { data: unknown[] | null }[]

      for (const a of (attemptsRes.data as unknown as { user_id: string | null; taker_name: string | null; is_guest: boolean; passed: boolean | null; submitted_at: string; profile: ProfileLite | null; exam: { title: string } | null }[]) ?? []) {
        const who = a.is_guest ? a.taker_name ?? 'A guest' : a.profile?.full_name ?? 'A member'
        results.push({
          key: `attempt-${a.submitted_at}-${who}`,
          bucket: 'members',
          actorName: a.profile?.full_name ?? null,
          actorAvatarUrl: a.profile?.avatar_url ?? null,
          text: `${who} ${a.passed ? 'passed' : 'took'} ${a.exam?.title ?? 'an exam'}`,
          at: a.submitted_at,
          status: a.passed === null ? undefined : { label: a.passed ? 'Passed' : 'Failed', tone: a.passed ? 'good' : 'bad' },
        })
      }

      for (const s of (courseworkRes.data as unknown as { status: string; submitted_at: string; reviewed_at: string | null; profile: ProfileLite | null; assignment: { title: string } | null }[]) ?? []) {
        const who = s.profile?.full_name ?? 'A member'
        const title = s.assignment?.title ?? 'an assignment'
        const at = s.status === 'submitted' ? s.submitted_at : s.reviewed_at ?? s.submitted_at
        results.push({
          key: `coursework-${at}-${who}`,
          bucket: 'training',
          actorName: s.profile?.full_name ?? null,
          actorAvatarUrl: s.profile?.avatar_url ?? null,
          text: `${who} submitted "${title}"`,
          at,
          status:
            s.status === 'approved' ? { label: 'Approved', tone: 'good' } :
            s.status === 'rejected' ? { label: 'Rejected', tone: 'bad' } :
            s.status === 'changes_requested' ? { label: 'Changes requested', tone: 'bad' } : undefined,
        })
      }

      for (const m of (joinsRes.data as unknown as { user_id: string; joined_at: string; profile: ProfileLite | null }[]) ?? []) {
        const who = m.profile?.full_name ?? 'A member'
        results.push({
          key: `joined-${m.joined_at}-${who}`,
          bucket: 'members',
          actorName: m.profile?.full_name ?? null,
          actorAvatarUrl: m.profile?.avatar_url ?? null,
          text: `${who} joined the office`,
          at: m.joined_at,
        })
      }

      let restIdx = 0
      if (includeTeamManagement) {
        const res = rest[restIdx++] as { data: unknown[] | null }
        for (const gm of (res.data as unknown as { user_id: string; created_at: string; profile: ProfileLite | null; group: { name: string } | null }[]) ?? []) {
          const who = gm.profile?.full_name ?? 'A member'
          results.push({
            key: `team-member-${gm.created_at}-${who}`,
            bucket: 'teams',
            actorName: gm.profile?.full_name ?? null,
            actorAvatarUrl: gm.profile?.avatar_url ?? null,
            text: `${who} was added to ${gm.group?.name ?? 'a team'}`,
            at: gm.created_at,
          })
        }
      }
      if (includeOrgActions) {
        const resourcesRes = rest[restIdx++] as { data: unknown[] | null }
        const examsRes = rest[restIdx++] as { data: unknown[] | null }
        const invitesRes = rest[restIdx++] as { data: unknown[] | null }
        const eventsRes = rest[restIdx++] as { data: unknown[] | null }

        for (const r of (resourcesRes.data as unknown as { title: string; created_at: string; profile: ProfileLite | null }[]) ?? []) {
          results.push({
            key: `resource-${r.created_at}-${r.title}`,
            bucket: 'training',
            actorName: r.profile?.full_name ?? null,
            actorAvatarUrl: r.profile?.avatar_url ?? null,
            text: `${r.profile?.full_name ?? 'Someone'} uploaded "${r.title}"`,
            at: r.created_at,
          })
        }
        for (const e of (examsRes.data as unknown as { title: string; status: string; created_at: string; profile: ProfileLite | null }[]) ?? []) {
          results.push({
            key: `exam-${e.created_at}-${e.title}`,
            bucket: 'training',
            actorName: e.profile?.full_name ?? null,
            actorAvatarUrl: e.profile?.avatar_url ?? null,
            text: e.status === 'published' ? `${e.profile?.full_name ?? 'Someone'} published "${e.title}"` : `${e.profile?.full_name ?? 'Someone'} created "${e.title}"`,
            at: e.created_at,
          })
        }
        for (const i of (invitesRes.data as unknown as { email: string | null; created_at: string; profile: ProfileLite | null }[]) ?? []) {
          results.push({
            key: `invite-${i.created_at}-${i.email}`,
            bucket: 'members',
            actorName: i.profile?.full_name ?? null,
            actorAvatarUrl: i.profile?.avatar_url ?? null,
            text: `${i.profile?.full_name ?? 'An admin'} invited ${i.email ?? 'a new member'}`,
            at: i.created_at,
          })
        }
        for (const ev of (eventsRes.data as unknown as { title: string; created_at: string; profile: ProfileLite | null }[]) ?? []) {
          results.push({
            key: `event-${ev.created_at}-${ev.title}`,
            bucket: 'events',
            actorName: ev.profile?.full_name ?? null,
            actorAvatarUrl: ev.profile?.avatar_url ?? null,
            text: `${ev.profile?.full_name ?? 'Someone'} created "${ev.title}"`,
            at: ev.created_at,
          })
        }
      }
      if (access === 'full') {
        const groupsRes = rest[restIdx++] as { data: unknown[] | null }
        for (const g of (groupsRes.data as unknown as { name: string; created_at: string }[]) ?? []) {
          results.push({
            key: `team-created-${g.created_at}-${g.name}`,
            bucket: 'teams',
            actorName: null,
            actorAvatarUrl: null,
            text: `Team "${g.name}" was created`,
            at: g.created_at,
          })
        }
      }

      results.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      if (!cancelled) {
        setItems(results.slice(0, FEED_LIMIT))
        setLoading(false)
      }
    }

    load(orgId, profile.id)
    return () => {
      cancelled = true
    }
  }, [access, orgId, profile])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (filter !== 'all' && item.bucket !== filter) return false
      if (!q) return true
      return item.text.toLowerCase().includes(q) || (item.actorName ?? '').toLowerCase().includes(q)
    })
  }, [items, filter, search])

  if (!orgId) return null

  return (
    <section className="activity-wrap">
      <div className="activity">
        <div className="activity-head">
          <h4>RECENT ACTIVITY</h4>
        </div>
        <div className="activity-toolbar">
          {availableFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`activity-filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            className="activity-search"
            placeholder="Search name or activity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {loading ? (
          <div className="log-line"><span className="log-text">Loading…</span></div>
        ) : visible.length > 0 ? (
          visible.map((item) => (
            <div className="log-line" key={item.key}>
              <Avatar name={item.actorName} url={item.actorAvatarUrl} />
              <div className="log-body">
                <span className="log-text">{item.text}</span>
                <span className="log-module">{item.bucket}</span>
                {item.status && <span className={`badge ${item.status.tone === 'good' ? 'active' : 'rejected'}`}>{item.status.label}</span>}
              </div>
              <span className="log-time">{timeAgo(item.at)}</span>
            </div>
          ))
        ) : (
          <div className="log-line"><span className="log-text">Nothing here yet.</span></div>
        )}
      </div>
    </section>
  )
}
