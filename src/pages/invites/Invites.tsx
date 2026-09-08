import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useOrgUsage } from '../../lib/plans'
import { planLabel as planName, seatState } from '../../lib/entitlements'
import type { Invite, MembershipRole, PendingMember, Profile } from '../../types/database'

const INVITE_EXPIRY_DAYS = 7
const ROLE_LABEL: Record<MembershipRole, string> = { admin: 'Admin', trainer: 'Trainer', team_leader: 'Team Leader', member: 'Member' }
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, var(--line), var(--line-soft))',
  'linear-gradient(135deg, var(--gold), var(--line))',
  'linear-gradient(135deg, var(--teal), var(--line))',
  'linear-gradient(135deg, var(--coral), var(--line))',
]

interface MemberRow {
  id: string
  role: MembershipRole
  status: string
  profile: Profile
}

interface AttemptRow {
  id: string
  user_id: string | null
  exam_id: string
  score_percent: number | null
  passed: boolean | null
  submitted_at: string | null
  exam: { title: string } | null
}

interface PendingMemberRow extends PendingMember {
  source_exam: { title: string } | null
  source_attempt: { score_percent: number | null; passed: boolean | null } | null
}

interface MemberStats {
  completedCount: number
  avgScore: number | null
  passRate: number | null
  lastActive: string | null
  history: AttemptRow[]
}

interface MemberRankStats {
  rank: string | null
  progress: number | null
}

interface MemberTeam {
  teamName: string
  leaderName: string | null
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0]?.toUpperCase() || '?'
}

function avatarGradient(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]
}

function relativeDate(iso: string | null) {
  if (!iso) return 'Never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

export default function Invites() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const { usage } = useOrgUsage(orgId)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [publishedExamCount, setPublishedExamCount] = useState(0)
  const [attemptsByUser, setAttemptsByUser] = useState<Map<string, AttemptRow[]>>(new Map())
  const [rankStatsByUser, setRankStatsByUser] = useState<Map<string, MemberRankStats>>(new Map())
  const [teamsByUser, setTeamsByUser] = useState<Map<string, MemberTeam[]>>(new Map())
  const [invites, setInvites] = useState<Invite[]>([])
  const [pendingMembers, setPendingMembers] = useState<PendingMemberRow[]>([])
  const [loading, setLoading] = useState(true)

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>('member')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveNotice, setApproveNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [drawerMember, setDrawerMember] = useState<MemberRow | null>(null)
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)
  const canEditRoles = currentMembership?.role === 'admin'

  const [sponsorMode, setSponsorMode] = useState<'member' | 'other'>('member')
  const [sponsorMemberId, setSponsorMemberId] = useState('')
  const [sponsorName, setSponsorName] = useState('')
  const [sponsorSaving, setSponsorSaving] = useState(false)
  const [sponsorMsg, setSponsorMsg] = useState<{ type: 'error' | 'ok'; text: string } | null>(null)

  async function load() {
    if (!orgId) return
    const [memberRes, examRes, attemptRes, inviteRes, pendingRes, groupRes, rankRes, rankProgressRes] = await Promise.all([
      supabase.from('memberships').select('id, role, status, profile:profiles(*)').eq('org_id', orgId).eq('status', 'active'),
      supabase.from('exams').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'published'),
      supabase
        .from('attempts')
        .select('id, user_id, exam_id, score_percent, passed, submitted_at, exam:exams(title)')
        .eq('org_id', orgId)
        .eq('status', 'submitted')
        .not('user_id', 'is', null)
        .order('submitted_at', { ascending: false }),
      supabase.from('invites').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase
        .from('pending_members')
        .select('*, source_exam:exams(title), source_attempt:attempts(score_percent, passed)')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('groups').select('id, name, leader:profiles!leader_id(full_name)').eq('org_id', orgId),
      supabase.from('business_path_ranks').select('id, name').eq('org_id', orgId),
      supabase.rpc('report_bp_progress', { p_org: orgId }),
    ])

    setMembers((memberRes.data as unknown as MemberRow[]) ?? [])
    setPublishedExamCount(examRes.count ?? 0)

    const byUser = new Map<string, AttemptRow[]>()
    const attemptData = attemptRes.data
    const inviteData = inviteRes.data
    const pendingData = pendingRes.data
    for (const a of (attemptData as unknown as AttemptRow[]) ?? []) {
      if (!a.user_id) continue
      const list = byUser.get(a.user_id) ?? []
      list.push(a)
      byUser.set(a.user_id, list)
    }
    setAttemptsByUser(byUser)

    const rankNames = new Map(
      ((rankRes.data as { id: string; name: string }[] | null) ?? []).map((rank) => [rank.id, rank.name]),
    )
    const rankStats = new Map<string, MemberRankStats>()
    for (const row of (rankProgressRes.data as { user_id: string; rank_id: string; required_total: number; required_done: number }[] | null) ?? []) {
      rankStats.set(row.user_id, {
        rank: rankNames.get(row.rank_id) ?? null,
        progress: row.required_total > 0 ? Math.round((row.required_done / row.required_total) * 100) : 0,
      })
    }
    setRankStatsByUser(rankStats)

    setInvites((inviteData as Invite[]) ?? [])
    setPendingMembers((pendingData as unknown as PendingMemberRow[]) ?? [])

    const groups = (groupRes.data as unknown as { id: string; name: string; leader: { full_name: string } | null }[]) ?? []
    const groupIds = groups.map((g) => g.id)
    const groupMembersRes = groupIds.length > 0
      ? await supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
      : { data: [] as { group_id: string; user_id: string }[] }
    const groupById = new Map(groups.map((g) => [g.id, g]))
    const teams = new Map<string, MemberTeam[]>()
    for (const row of groupMembersRes.data ?? []) {
      const group = groupById.get(row.group_id)
      if (!group) continue
      const list = teams.get(row.user_id) ?? []
      list.push({ teamName: group.name, leaderName: group.leader?.full_name ?? null })
      teams.set(row.user_id, list)
    }
    setTeamsByUser(teams)

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const statsByMember = useMemo(() => {
    const map = new Map<string, MemberStats>()
    for (const m of members) {
      const history = attemptsByUser.get(m.profile.id) ?? []
      const completedExamIds = new Set(history.map((a) => a.exam_id))
      const scored = history.filter((a) => a.score_percent !== null)
      const avgScore = scored.length > 0 ? Math.round(scored.reduce((sum, a) => sum + (a.score_percent ?? 0), 0) / scored.length) : null
      const passRate = history.length > 0 ? Math.round((history.filter((a) => a.passed).length / history.length) * 100) : null
      const lastActive = history.length > 0 ? history[0].submitted_at : null
      map.set(m.profile.id, { completedCount: completedExamIds.size, avgScore, passRate, lastActive, history })
    }
    return map
  }, [members, attemptsByUser])

  const teamStats = useMemo(() => {
    if (members.length === 0) return { completionPercent: null as number | null, avgScore: null as number | null, notStarted: 0 }
    const withData = members.map((m) => statsByMember.get(m.profile.id)).filter((s): s is MemberStats => !!s)
    const totalPossible = members.length * publishedExamCount
    const completionPercent =
      totalPossible > 0 ? Math.round((withData.reduce((sum, s) => sum + s.completedCount, 0) / totalPossible) * 100) : null
    const started = withData.filter((s) => s.completedCount > 0)
    const avgScore =
      started.length > 0 ? Math.round(started.reduce((sum, s) => sum + (s.avgScore ?? 0), 0) / started.length) : null
    const notStarted = withData.filter((s) => s.completedCount === 0).length
    return { completionPercent, avgScore, notStarted }
  }, [members, statsByMember, publishedExamCount])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile) return
    setError(null)
    setSubmitting(true)

    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: inserted, error: insertError } = await supabase
      .from('invites')
      .insert({
        org_id: orgId,
        email,
        role,
        token: crypto.randomUUID(),
        invited_by: profile.id,
        expires_at: expiresAt,
      })
      .select('id')
      .single()

    if (insertError) {
      setSubmitting(false)
      setError(insertError.message)
      return
    }

    // Send the invite email (best-effort — the invite row already exists,
    // so a delivery failure just surfaces a "copy the link" hint).
    let emailFailed = false
    try {
      const { data: sendRes } = await supabase.functions.invoke('send-email', {
        body: { action: 'invite_resend', inviteId: inserted.id, siteUrl: window.location.origin },
      })
      emailFailed = !sendRes?.sent
    } catch {
      emailFailed = true
    }

    setSubmitting(false)
    setEmail('')
    setShowInviteModal(false)
    if (emailFailed) {
      setApproveNotice({
        type: 'error',
        text: `Invite created for ${email}, but the email could not be sent. Copy their invite link from Pending invites below and send it yourself.`,
      })
    }
    await load()
  }

  function inviteLink(token: string) {
    return `${window.location.origin}/invite/${token}`
  }

  async function copyLink(id: string, token: string) {
    await navigator.clipboard.writeText(inviteLink(token))
    setCopiedId(id)
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500)
  }

  async function resendInvite(invite: Invite) {
    setResendingId(invite.id)
    setApproveNotice(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-email', {
        body: { action: 'invite_resend', inviteId: invite.id, siteUrl: window.location.origin },
      })
      if (fnError || !data?.sent) {
        setApproveNotice({
          type: 'error',
          text: data?.error ?? 'The invite email could not be sent. Copy the link and send it manually.',
        })
      } else {
        setApproveNotice({ type: 'success', text: `Invite email re-sent to ${invite.email}.` })
      }
    } catch {
      setApproveNotice({ type: 'error', text: 'The invite email could not be sent.' })
    }
    setResendingId(null)
  }

  async function approvePendingMember(pm: PendingMemberRow) {
    if (!orgId || !profile) return
    setApprovingId(pm.id)
    setApproveNotice(null)

    const { data, error: fnError } = await supabase.functions.invoke('approve-pending-member', {
      body: { pendingMemberId: pm.id, siteUrl: window.location.origin },
    })

    if (fnError || data?.error) {
      const message = data?.error ?? (fnError instanceof Error ? fnError.message : 'Could not approve this request.')
      if (data?.approved) {
        setApproveNotice({ type: 'error', text: `${pm.full_name} was approved, but the email didn't send: ${message}. Copy their invite link from Pending invites below and send it yourself.` })
      } else {
        setApproveNotice({ type: 'error', text: message })
      }
    } else {
      setApproveNotice({ type: 'success', text: `${pm.full_name} was approved — an invite email was sent to ${pm.email}.` })
    }

    setApprovingId(null)
    await load()
  }

  async function rejectPendingMember(pm: PendingMemberRow) {
    if (!profile) return
    setApprovingId(pm.id)
    await supabase
      .from('pending_members')
      .update({ status: 'rejected', reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
      .eq('id', pm.id)
    setApprovingId(null)
    await load()
  }

  // Sync the sponsor form to whichever member's drawer is open.
  useEffect(() => {
    if (!drawerMember) return
    const p = drawerMember.profile
    if (p.sponsor_member_id) {
      setSponsorMode('member')
      setSponsorMemberId(p.sponsor_member_id)
      setSponsorName('')
    } else {
      setSponsorMode(p.sponsor_name ? 'other' : 'member')
      setSponsorMemberId('')
      setSponsorName(p.sponsor_name ?? '')
    }
    setSponsorMsg(null)
  }, [drawerMember])

  async function saveSponsor() {
    if (!drawerMember) return
    const target = drawerMember
    const memberId = sponsorMode === 'member' ? sponsorMemberId || null : null
    const name = sponsorMode === 'other' ? sponsorName.trim() || null : null
    if (sponsorMode === 'member' && !memberId) return setSponsorMsg({ type: 'error', text: 'Pick a member.' })
    if (sponsorMode === 'other' && !name) return setSponsorMsg({ type: 'error', text: "Enter the sponsor's name." })

    setSponsorSaving(true)
    setSponsorMsg(null)
    const { error: rpcErr } = await supabase.rpc('admin_set_sponsor', {
      target_user_id: target.profile.id,
      new_sponsor_member_id: memberId,
      new_sponsor_name: name,
    })
    setSponsorSaving(false)
    if (rpcErr) return setSponsorMsg({ type: 'error', text: rpcErr.message })

    const patch = { sponsor_member_id: memberId, sponsor_name: name }
    setMembers((prev) => prev.map((m) => (m.id === target.id ? { ...m, profile: { ...m.profile, ...patch } } : m)))
    setDrawerMember((prev) => (prev && prev.id === target.id ? { ...prev, profile: { ...prev.profile, ...patch } } : prev))
    setSponsorMsg({ type: 'ok', text: 'Sponsor updated.' })
  }

  async function handleRoleChange(member: MemberRow, newRole: MembershipRole) {
    setRoleSaving(true)
    setRoleError(null)
    const { error: updateError } = await supabase.from('memberships').update({ role: newRole }).eq('id', member.id)
    setRoleSaving(false)
    if (updateError) {
      setRoleError(updateError.message)
      return
    }
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)))
    setDrawerMember((prev) => (prev && prev.id === member.id ? { ...prev, role: newRole } : prev))
  }

  const pendingInvites = invites.filter((i) => i.status === 'pending')
  const drawerStats = drawerMember ? statsByMember.get(drawerMember.profile.id) : null

  const seats = seatState(usage?.member_count ?? members.length, usage?.max_members ?? null)
  const planLabel = usage ? planName(usage) : ''

  return (
    <div className="page">
      <div className="page-head list-header">
        <h1>Members</h1>
        <button type="button" onClick={() => setShowInviteModal(true)} disabled={seats.atLimit}>
          + Invite a member
        </button>
      </div>

      {seats.near && seats.max != null && (
        <div className={`billing-banner ${seats.atLimit ? 'warn' : ''}`} style={{ marginTop: 4 }}>
          <p>
            {seats.atLimit ? (
              <><strong>Member limit reached.</strong> Your {planLabel} plan supports up to {seats.max} members.</>
            ) : (
              <>You're using <strong>{seats.used} of {seats.max}</strong> member seats.</>
            )}
          </p>
          <Link to="/settings/billing" className="btn-primary-link">Upgrade</Link>
        </div>
      )}

      <section className="kpi-strip" style={{ marginTop: 0, marginBottom: 32 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">MEMBERS</span></div>
          <div className="kpi-value">{members.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TEAM COMPLETION</span></div>
          <div className="kpi-value">{teamStats.completionPercent === null ? '—' : `${teamStats.completionPercent}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TEAM AVG SCORE</span></div>
          <div className="kpi-value">{teamStats.avgScore === null ? '—' : `${teamStats.avgScore}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">NOT STARTED</span></div>
          <div className={`kpi-value ${teamStats.notStarted > 0 ? 'attn' : ''}`}>{teamStats.notStarted}</div>
        </div>
      </section>

      <section>
        <h2>Join requests {pendingMembers.length > 0 && `(${pendingMembers.length})`}</h2>
        {approveNotice && (
          <p className={approveNotice.type === 'success' ? 'form-info' : 'form-error'}>{approveNotice.text}</p>
        )}
        {pendingMembers.length === 0 ? (
          <p className="empty-note">No one is waiting for approval. People who take a public exam link or request to join show up here.</p>
        ) : (
          <>
            {pendingMembers.map((pm) => (
              <div className="jr-card" key={pm.id}>
                <div className="jr-left">
                  <div className="avatar" style={{ background: avatarGradient(pm.id) }}>{initials(pm.full_name)}</div>
                  <div className="jr-info">
                    <div className="jr-name">{pm.full_name}</div>
                    <div className="jr-meta">
                      {pm.source_exam
                        ? `Took "${pm.source_exam.title}" via public link · ${new Date(pm.created_at).toLocaleDateString()}`
                        : `Requested to join directly · ${new Date(pm.created_at).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>
                {pm.source_attempt && (
                  <div className="jr-left">
                    <div className={`jr-score ${pm.source_attempt.passed ? 'pass' : 'fail'}`}>
                      {pm.source_attempt.score_percent}% · {pm.source_attempt.passed ? 'PASSED' : 'FAILED'}
                    </div>
                  </div>
                )}
                <div className="jr-actions">
                  <button type="button" className="btn-approve" onClick={() => approvePendingMember(pm)} disabled={approvingId === pm.id}>
                    Approve
                  </button>
                  <button type="button" className="btn-decline" onClick={() => rejectPendingMember(pm)} disabled={approvingId === pm.id}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
            <p className="section-note">Approving links their exam attempt to a real member profile — their score carries over, it doesn't reset.</p>
          </>
        )}
      </section>

      <section>
        <h2>Members ({members.length})</h2>
        {loading ? (
          <p>Loading…</p>
        ) : members.length === 0 ? (
          <p className="empty-note">No members yet.</p>
        ) : (
          <div className="table-card">
            <div className="t-row t-head">
              <div>NAME</div><div>EMAIL</div><div>ROLE</div><div>RANK</div><div>RANK PROGRESS</div><div>LAST ACTIVE</div>
            </div>
            {members.map((m) => {
              const stats = statsByMember.get(m.profile.id)
              const rankStats = rankStatsByUser.get(m.profile.id)
              return (
                <button type="button" className="t-row t-body" key={m.id} onClick={() => setDrawerMember(m)}>
                  <div className="member-cell">
                    <div className="avatar" style={{ background: avatarGradient(m.profile.id) }}>{initials(m.profile.full_name)}</div>
                    <span>{m.profile.full_name}</span>
                  </div>
                  <div className="cell-dim">{m.profile.email}</div>
                  <div className={`role-pill ${m.role === 'member' ? 'member-role' : ''}`}>{ROLE_LABEL[m.role]}</div>
                  <div className="cell-dim">{rankStats?.rank ?? 'Unranked'}</div>
                  {rankStats?.progress !== null && rankStats?.progress !== undefined ? (
                    <div className="score-bar-wrap">
                      <div className="score-bar"><div className="score-bar-fill" style={{ width: `${rankStats.progress}%` }} /></div>
                      <span className="cell-dim">{rankStats.progress}%</span>
                    </div>
                  ) : (
                    <div className="cell-dim">—</div>
                  )}
                  <div className="cell-dim">{relativeDate(stats?.lastActive ?? null)}</div>
                </button>
              )
            })}
          </div>
        )}
        <p className="section-note">Click a row to see full exam history for that member.</p>
      </section>

      <section>
        <h2>Pending invites {pendingInvites.length > 0 && `(${pendingInvites.length})`}</h2>
        {pendingInvites.length === 0 ? (
          <p className="empty-note">No pending invites.</p>
        ) : (
          <div className="table-card">
            <div className="invite-row t-head">
              <div>EMAIL</div><div>ROLE</div><div>EXPIRES</div><div></div>
            </div>
            {pendingInvites.map((invite) => (
              <div className="invite-row" key={invite.id}>
                <div className="cell-dim">{invite.email}</div>
                <div className="cell-dim">{ROLE_LABEL[invite.role]}</div>
                <div className="cell-dim">{new Date(invite.expires_at).toLocaleDateString()}</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={resendingId === invite.id}
                    onClick={() => resendInvite(invite)}
                  >
                    {resendingId === invite.id ? 'Sending…' : 'Resend email'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => copyLink(invite.id, invite.token)}>
                    {copiedId === invite.id ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showInviteModal && (
        <div className="modal-backdrop" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleInvite}>
              <h2>Invite a member</h2>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </label>
              <label>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
                  <option value="member">Member</option>
                  <option value="trainer">Trainer</option>
                  <option value="team_leader">Team Leader</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {error && <p className="form-error">{error}</p>}
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                Email delivery isn't wired up yet for direct invites — copy the invite link after creating it and send it yourself.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="secondary" onClick={() => setShowInviteModal(false)}>Cancel</button>
                <button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Create invite'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={`drawer-overlay ${drawerMember ? 'open' : ''}`} onClick={() => setDrawerMember(null)} />
      <aside className={`drawer mdrawer ${drawerMember ? 'open' : ''}`} aria-hidden={!drawerMember}>
        {drawerMember && (() => {
          const p = drawerMember.profile
          const teams = teamsByUser.get(p.id) ?? []
          const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)
          return (
            <>
              <button type="button" className="drawer-close" onClick={() => setDrawerMember(null)} aria-label="Close">✕</button>

              <div className="mdrawer-id">
                <div className="drawer-avatar mdrawer-av" style={{ background: avatarGradient(p.id) }}>
                  {initials(p.full_name)}
                </div>
                <div className="mdrawer-idtext">
                  <h3>{p.full_name}</h3>
                  <p>{p.email}</p>
                  <div className="mdrawer-idmeta">
                    <span className="role-pill">{ROLE_LABEL[drawerMember.role]}</span>
                    <Link to={`/members/${p.id}`} className="mdrawer-openlink">Full profile →</Link>
                  </div>
                </div>
              </div>

              <div className="mdrawer-kpis">
                <div className="mdrawer-kpi"><span className="v">{drawerStats?.completedCount ?? 0}</span><span className="l">Exams done</span></div>
                <div className="mdrawer-kpi"><span className="v">{pct(drawerStats?.avgScore)}</span><span className="l">Avg score</span></div>
                <div className="mdrawer-kpi"><span className="v">{pct(drawerStats?.passRate)}</span><span className="l">Pass rate</span></div>
              </div>

              {canEditRoles && (
                <section className="mdrawer-card">
                  <h4>Manage</h4>

                  <div className="mdrawer-field">
                    <label htmlFor="drw-role">Role</label>
                    <select
                      id="drw-role"
                      value={drawerMember.role}
                      onChange={(e) => handleRoleChange(drawerMember, e.target.value as MembershipRole)}
                      disabled={roleSaving}
                    >
                      <option value="member">Member</option>
                      <option value="trainer">Trainer</option>
                      <option value="team_leader">Team Leader</option>
                      <option value="admin">Admin</option>
                    </select>
                    {roleError && <p className="form-error sm">{roleError}</p>}
                  </div>

                  <div className="mdrawer-field">
                    <label>Sponsor</label>
                    <div className="mdrawer-seg">
                      <button type="button" className={sponsorMode === 'member' ? 'on' : ''} onClick={() => setSponsorMode('member')}>Office member</button>
                      <button type="button" className={sponsorMode === 'other' ? 'on' : ''} onClick={() => setSponsorMode('other')}>Outside office</button>
                    </div>
                    {sponsorMode === 'member' ? (
                      <select value={sponsorMemberId} onChange={(e) => setSponsorMemberId(e.target.value)}>
                        <option value="">Select a member…</option>
                        {members.filter((m) => m.profile.id !== p.id).map((m) => (
                          <option key={m.profile.id} value={m.profile.id}>{m.profile.full_name}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} placeholder="Sponsor's name" />
                    )}
                    <button type="button" className="mdrawer-save" onClick={saveSponsor} disabled={sponsorSaving}>
                      {sponsorSaving ? 'Saving…' : 'Save sponsor'}
                    </button>
                    {sponsorMsg && (
                      <p className={`${sponsorMsg.type === 'error' ? 'form-error' : 'form-info'} sm`}>{sponsorMsg.text}</p>
                    )}
                  </div>
                </section>
              )}

              <section className="mdrawer-card">
                <h4>Team</h4>
                {teams.length === 0 ? (
                  <p className="mdrawer-muted">Not on a team yet.</p>
                ) : (
                  teams.map((t, i) => (
                    <p key={i} className="mdrawer-teamrow">
                      {t.teamName}<span> · led by {t.leaderName ?? 'Unassigned'}</span>
                    </p>
                  ))
                )}
              </section>

              <section className="mdrawer-card">
                <div className="mdrawer-cardhead">
                  <h4>Exam history</h4>
                  {drawerStats && drawerStats.history.length > 0 && (
                    <span className="mdrawer-count">{drawerStats.history.length}</span>
                  )}
                </div>
                {drawerStats && drawerStats.history.length > 0 ? (
                  <div className="mdrawer-hist">
                    {drawerStats.history.map((a) => (
                      <div className="mdrawer-histrow" key={a.id}>
                        <div className="hr-main">
                          <span className="hr-name">{a.exam?.title ?? 'Untitled exam'}</span>
                          <span className="hr-date">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : ''}</span>
                        </div>
                        <div className="hr-right">
                          <span className="hr-score">{a.score_percent}%</span>
                          <span className={`badge ${a.passed ? 'passed' : 'failed'}`}>{a.passed ? 'Pass' : 'Fail'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mdrawer-muted">No exams taken yet.</p>
                )}
              </section>
            </>
          )
        })()}
      </aside>
    </div>
  )
}
