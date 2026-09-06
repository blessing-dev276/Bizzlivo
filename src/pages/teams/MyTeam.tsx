import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  loadNetwork,
  initialsOf,
  type NetworkData,
  type NetworkNode,
} from '../../lib/network'
import type {
  NetworkMarketingActivity,
  NetworkMarketingContact,
  NetworkMarketingContactStage,
} from '../../types/database'
import NetworkTree from './NetworkTree'
import { treeControls } from './treeControls'

// -- prospect stage → member-facing label ----------------------------------
const STAGE_ORDER: NetworkMarketingContactStage[] = [
  'prospect', 'invited', 'presented', 'followed_up', 'won_customer', 'won_distributor', 'lost',
]
const STAGE_LABEL: Record<NetworkMarketingContactStage, string> = {
  prospect: 'New',
  invited: 'Contacted',
  presented: 'Presented',
  followed_up: 'Follow-up',
  won_customer: 'Customer',
  won_distributor: 'Distributor',
  lost: 'Not Interested',
}
const STAGE_TONE: Record<NetworkMarketingContactStage, string> = {
  prospect: 'neutral',
  invited: 'blue',
  presented: 'blue',
  followed_up: 'amber',
  won_customer: 'green',
  won_distributor: 'green',
  lost: 'muted',
}
const TERMINAL: NetworkMarketingContactStage[] = ['won_customer', 'won_distributor', 'lost']

type Tab = 'overview' | 'prospects' | 'followups' | 'network'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'prospects', label: 'Prospects' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'network', label: 'Network' },
]

interface LedTeam {
  id: string
  name: string
  members: { id: string; fullName: string; email: string | null }[]
}
interface RawLedTeam {
  id: string
  name: string
  group_members: { profile: { id: string; full_name: string; email: string | null } | null }[] | null
}

function humanizeActivity(note: string): string {
  const m = note.match(/^Moved to (.+)$/)
  if (m) return `Status changed → ${m[1]}`
  return note
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
const endOfToday = () => {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'

export default function MyTeam() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const orgSlug = currentMembership?.organization.slug
  const orgName = currentMembership?.organization.name

  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'overview'
  })
  const setTabAndUrl = useCallback((t: Tab) => {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url)
  }, [])

  const [net, setNet] = useState<NetworkData | null>(null)
  const [contacts, setContacts] = useState<NetworkMarketingContact[]>([])
  const [activityByContact, setActivityByContact] = useState<Map<string, NetworkMarketingActivity[]>>(new Map())
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [ledTeams, setLedTeams] = useState<LedTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (org: string, userId: string) => {
    setLoading(true)
    const [netData, contactsRes, profRes] = await Promise.all([
      loadNetwork(org, userId),
      supabase
        .from('network_marketing_contacts')
        .select('*')
        .eq('org_id', org)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('referral_code').eq('id', userId).maybeSingle(),
    ])
    setNet(netData)
    const rows = (contactsRes.data as NetworkMarketingContact[]) ?? []
    setContacts(rows)

    let code = (profRes.data as { referral_code: string | null } | null)?.referral_code ?? null
    if (!code) {
      code = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      await supabase.from('profiles').update({ referral_code: code }).eq('id', userId)
    }
    setReferralCode(code)

    const ids = rows.map((r) => r.id)
    const actsRes = ids.length
      ? await supabase
          .from('network_marketing_activities')
          .select('*')
          .in('contact_id', ids)
          .order('created_at', { ascending: false })
      : { data: [] as NetworkMarketingActivity[] }
    const map = new Map<string, NetworkMarketingActivity[]>()
    for (const a of (actsRes.data as NetworkMarketingActivity[]) ?? []) {
      const list = map.get(a.contact_id) ?? []
      list.push(a)
      map.set(a.contact_id, list)
    }
    setActivityByContact(map)

    // Team-leader carry-over: if this member leads any groups, surface their
    // rosters here too (the old /my-team view). Non-leaders get nothing.
    const ledRes = await supabase
      .from('groups')
      .select('id, name, group_members(profile:profiles(id, full_name, email))')
      .eq('org_id', org)
      .eq('leader_id', userId)
      .order('name')
    const led: LedTeam[] = ((ledRes.data as unknown as RawLedTeam[]) ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      members: (g.group_members ?? [])
        .map((m) => m.profile)
        .filter((p): p is { id: string; full_name: string; email: string | null } => !!p)
        .map((p) => ({ id: p.id, fullName: p.full_name, email: p.email })),
    }))
    setLedTeams(led)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!orgId || !profile) return
    load(orgId, profile.id)
  }, [orgId, profile, load])

  const reload = () => {
    if (orgId && profile) load(orgId, profile.id)
  }

  // -- derived --------------------------------------------------------------
  const activeContacts = useMemo(
    () => contacts.filter((c) => !TERMINAL.includes(c.stage)),
    [contacts],
  )
  const dueFollowUps = useMemo(() => {
    const end = endOfToday().getTime()
    return activeContacts.filter(
      (c) => c.next_follow_up_at && new Date(c.next_follow_up_at).getTime() <= end,
    )
  }, [activeContacts])

  const needsAttention = useMemo(() => {
    const items: { contact: NetworkMarketingContact; kind: 'overdue' | 'unscheduled'; detail: string }[] = []
    const today = startOfToday().getTime()
    for (const c of activeContacts) {
      if (c.next_follow_up_at && new Date(c.next_follow_up_at).getTime() < today) {
        const days = Math.floor((today - new Date(c.next_follow_up_at).getTime()) / 86_400_000)
        items.push({ contact: c, kind: 'overdue', detail: `Follow-up overdue by ${days} day${days === 1 ? '' : 's'}` })
      } else if (!c.next_follow_up_at && !c.last_contacted_at) {
        items.push({ contact: c, kind: 'unscheduled', detail: 'New prospect — no follow-up scheduled' })
      }
    }
    return items
      .sort((a, b) => (a.kind === 'overdue' && b.kind !== 'overdue' ? -1 : 1))
      .slice(0, 5)
  }, [activeContacts])

  if (!orgId || !profile) return <div className="page"><p>Loading…</p></div>
  if (loading || !net) return <div className="page"><p>Loading…</p></div>

  const s = net.summary
  const referralUrl = referralCode ? `${window.location.origin}/join/${referralCode}` : ''

  return (
    <div className="page">
      <div className="net-header">
        <div>
          <h1>My Network</h1>
          <p>Build relationships, grow your team, and stay on top of every follow-up.</p>
        </div>
        <p className="net-header-meta">
          {greeting()}, {profile.full_name.split(' ')[0]}. Your network has{' '}
          <strong>{s.total} member{s.total === 1 ? '' : 's'}</strong>
          {s.generations > 0 && <> across <strong>{s.generations} generation{s.generations === 1 ? '' : 's'}</strong></>}.
        </p>
      </div>

      <div className="net-metrics">
        <button className="net-metric" onClick={() => setTabAndUrl('network')}>
          <span className="net-metric-v">{s.direct}</span>
          <span className="net-metric-l">Direct Members</span>
        </button>
        <button className="net-metric" onClick={() => setTabAndUrl('network')}>
          <span className="net-metric-v">{s.total}</span>
          <span className="net-metric-l">Total Network</span>
        </button>
        <button className="net-metric" onClick={() => setTabAndUrl('network')}>
          <span className="net-metric-v">{s.active}</span>
          <span className="net-metric-l">Active</span>
        </button>
        <button className="net-metric" onClick={() => setTabAndUrl('prospects')}>
          <span className="net-metric-v">{activeContacts.length}</span>
          <span className="net-metric-l">Prospects</span>
        </button>
        <button className="net-metric" onClick={() => setTabAndUrl('followups')}>
          <span className={`net-metric-v${dueFollowUps.length ? ' attn' : ''}`}>{dueFollowUps.length}</span>
          <span className="net-metric-l">Follow-ups Due</span>
        </button>
      </div>

      <div className="view-tabs net-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`view-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTabAndUrl(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === 'overview' && (
        <OverviewTab
          net={net}
          referralUrl={referralUrl}
          orgName={orgName ?? 'your office'}
          needsAttention={needsAttention}
          ledTeams={ledTeams}
          onGoProspects={() => setTabAndUrl('prospects')}
          onGoNetwork={() => setTabAndUrl('network')}
        />
      )}

      {tab === 'prospects' && (
        <ProspectsTab
          orgId={orgId}
          userId={profile.id}
          contacts={contacts}
          activityByContact={activityByContact}
          directPeople={net.root.children.map((c) => c.person)}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          reload={reload}
        />
      )}

      {tab === 'followups' && (
        <FollowUpsTab
          orgId={orgId}
          userId={profile.id}
          contacts={activeContacts}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          reload={reload}
        />
      )}

      {tab === 'network' && (
        <NetworkTab net={net} selfId={profile.id} orgSlug={orgSlug} referralUrl={referralUrl} />
      )}
    </div>
  )
}

// =======================================================================
// Overview
// =======================================================================
function OverviewTab({
  net,
  referralUrl,
  orgName,
  needsAttention,
  ledTeams,
  onGoProspects,
  onGoNetwork,
}: {
  net: NetworkData
  referralUrl: string
  orgName: string
  needsAttention: { contact: NetworkMarketingContact; kind: 'overdue' | 'unscheduled'; detail: string }[]
  ledTeams: LedTeam[]
  onGoProspects: () => void
  onGoNetwork: () => void
}) {
  const { profile } = useAuth()
  const direct = net.root.children

  return (
    <>
      <InviteAndGrow referralUrl={referralUrl} referrerName={profile?.full_name ?? ''} orgName={orgName} />

      <section className="net-card">
        <div className="net-card-head">
          <h3>Needs Attention</h3>
          {needsAttention.length > 0 && (
            <button className="net-link" onClick={onGoProspects}>View all</button>
          )}
        </div>
        {needsAttention.length === 0 ? (
          <p className="empty-row">Nothing needs chasing right now. Nice.</p>
        ) : (
          needsAttention.map(({ contact, kind, detail }) => (
            <div className="net-attn-row" key={contact.id}>
              <span className={`net-dot ${kind === 'overdue' ? 'bad' : 'warn'}`} />
              <div className="net-attn-main">
                <strong>{contact.full_name}</strong>
                <span>{detail}</span>
              </div>
              <button className="net-btn sm" onClick={onGoProspects}>Open</button>
            </div>
          ))
        )}
      </section>

      <section className="net-card">
        <div className="net-card-head">
          <h3>My Direct Team</h3>
          <span className="net-count">{direct.length} member{direct.length === 1 ? '' : 's'}</span>
        </div>
        {direct.length === 0 ? (
          <p className="empty-row">No one has joined through you yet. Share your invite link above.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Member</th><th>Rank</th><th>Status</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {direct.map((c) => (
                  <tr key={c.person.id}>
                    <td>{c.person.fullName}</td>
                    <td className="cell-dim">{c.person.rankName ?? '—'}</td>
                    <td>
                      <span className={`badge ${c.person.active ? 'active' : ''}`}>
                        {c.person.active ? 'Active' : 'Removed'}
                      </span>
                    </td>
                    <td className="cell-dim">{fmtDate(c.person.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ledTeams.map((team) => (
        <section className="net-card" key={team.id}>
          <div className="net-card-head">
            <h3>Team You Lead · {team.name}</h3>
            <span className="net-count">{team.members.length} member{team.members.length === 1 ? '' : 's'}</span>
          </div>
          {team.members.length === 0 ? (
            <p className="empty-row">No members in this team yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member</th><th>Email</th></tr></thead>
                <tbody>
                  {team.members.map((m) => (
                    <tr key={m.id}><td>{m.fullName}</td><td className="cell-dim">{m.email ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <section className="net-card">
        <div className="net-card-head">
          <h3>Network Structure</h3>
          <button className="net-link" onClick={onGoNetwork}>Open full diagram</button>
        </div>
        <div className="net-preview">
          <MiniPreview net={net} />
        </div>
      </section>
    </>
  )
}

function MiniPreview({ net }: { net: NetworkData }) {
  const root = net.root.person
  const directs = net.root.children
  const MAX_SHOWN = 6
  const shown = directs.slice(0, MAX_SHOWN)
  const extra = directs.length - shown.length

  return (
    <div className="net-mini">
      <div className="net-mini-node net-mini-you" title={root.fullName}>
        {root.avatarUrl ? <img src={root.avatarUrl} alt="" /> : <span>You</span>}
      </div>

      {directs.length === 0 ? (
        <span className="empty-row" style={{ marginTop: 14 }}>Invite your first member to start building.</span>
      ) : (
        <>
          <span className="net-mini-connector" aria-hidden />
          <div className="net-mini-row">
            {shown.map((c) => (
              <div className="net-mini-node" key={c.person.id} title={c.person.fullName}>
                {c.person.avatarUrl ? (
                  <img src={c.person.avatarUrl} alt="" />
                ) : (
                  <span>{initialsOf(c.person.fullName)}</span>
                )}
              </div>
            ))}
            {extra > 0 && <div className="net-mini-node net-mini-more">+{extra}</div>}
          </div>
        </>
      )}
    </div>
  )
}

// =======================================================================
// Invite & Grow
// =======================================================================
function InviteAndGrow({
  referralUrl,
  referrerName,
  orgName,
}: {
  referralUrl: string
  referrerName: string
  orgName: string
}) {
  const [copied, setCopied] = useState(false)
  const [showQR, setShowQR] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the field is selectable */
    }
  }
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${orgName}`, url: referralUrl })
      } catch {
        /* dismissed */
      }
    } else {
      copy()
    }
  }

  return (
    <section className="net-card net-invite">
      <div className="net-card-head">
        <h3>Invite &amp; Grow</h3>
      </div>
      <p className="net-invite-copy">
        Share your personal invitation link. Members who join through it are automatically connected to
        you as their sponsor.
      </p>
      <div className="net-invite-row">
        <input className="net-invite-link" value={referralUrl} readOnly onFocus={(e) => e.target.select()} />
        <button className="net-btn" onClick={copy}>{copied ? 'Copied' : 'Copy Link'}</button>
        <button className="net-btn ghost" onClick={share}>Share</button>
        <button className="net-btn ghost" onClick={() => setShowQR(true)}>QR Code</button>
      </div>

      {showQR && (
        <div className="modal-backdrop" onClick={() => setShowQR(false)}>
          <div className="modal net-qr-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Your invitation QR</h2>
            <p className="net-qr-meta">{orgName}</p>
            <p className="net-qr-meta dim">Referred by {referrerName}</p>
            <img
              className="net-qr-img"
              alt="Invitation QR code"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(referralUrl)}`}
            />
            <div className="net-qr-actions">
              <button className="net-btn" onClick={() => navigator.clipboard?.writeText(referralUrl)}>Copy link</button>
              <a
                className="net-btn ghost"
                href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=16&data=${encodeURIComponent(referralUrl)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open image
              </a>
              <button className="net-btn ghost" onClick={() => setShowQR(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// =======================================================================
// Prospects
// =======================================================================
function ProspectsTab({
  orgId,
  userId,
  contacts,
  activityByContact,
  directPeople,
  busy,
  setBusy,
  setError,
  reload,
}: {
  orgId: string
  userId: string
  contacts: NetworkMarketingContact[]
  activityByContact: Map<string, NetworkMarketingActivity[]>
  directPeople: { id: string; fullName: string }[]
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  reload: () => void
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | NetworkMarketingContactStage>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of contacts) m.set(c.stage, (m.get(c.stage) ?? 0) + 1)
    return m
  }, [contacts])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return contacts.filter((c) => {
      if (filter !== 'all' && c.stage !== filter) return false
      if (needle && !`${c.full_name} ${c.phone ?? ''} ${c.email ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [contacts, q, filter])

  const open = contacts.find((c) => c.id === openId) ?? null

  return (
    <>
      <div className="net-toolbar">
        <input
          className="net-search"
          placeholder="Search prospects…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="net-btn" onClick={() => setShowAdd(true)}>+ Add Prospect</button>
      </div>

      <div className="chips net-chips">
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All · {contacts.length}
        </button>
        {STAGE_ORDER.map((st) => (
          <button
            key={st}
            className={`chip ${filter === st ? 'active' : ''}`}
            onClick={() => setFilter(st)}
          >
            {STAGE_LABEL[st]} · {counts.get(st) ?? 0}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty-row">No prospects match.</p>
      ) : (
        <div className="net-rows">
          {visible.map((c) => {
            const overdue =
              c.next_follow_up_at && new Date(c.next_follow_up_at).getTime() < startOfToday().getTime()
            return (
              <button className="net-row" key={c.id} onClick={() => setOpenId(c.id)}>
                <span className="net-row-avatar">{initialsOf(c.full_name)}</span>
                <span className="net-row-main">
                  <span className="net-row-name">{c.full_name}</span>
                  <span className="net-row-sub">
                    {c.phone ?? 'No phone'}{c.source ? ` · ${c.source}` : ''}
                  </span>
                </span>
                <span className={`net-tag ${STAGE_TONE[c.stage]}`}>{STAGE_LABEL[c.stage]}</span>
                <span className="net-row-meta">
                  <span>Last: {fmtDate(c.last_contacted_at)}</span>
                  <span className={overdue ? 'bad' : ''}>
                    Follow-up: {c.next_follow_up_at ? (overdue ? 'Overdue' : fmtDate(c.next_follow_up_at)) : '—'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <ProspectDrawer
        contact={open}
        activities={open ? activityByContact.get(open.id) ?? [] : []}
        directPeople={directPeople}
        orgId={orgId}
        userId={userId}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        onClose={() => setOpenId(null)}
        reload={reload}
      />

      {showAdd && (
        <AddProspectModal
          orgId={orgId}
          userId={userId}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onClose={() => setShowAdd(false)}
          reload={reload}
        />
      )}
    </>
  )
}

function AddProspectModal({
  orgId,
  userId,
  busy,
  setBusy,
  setError,
  onClose,
  reload,
}: {
  orgId: string
  userId: string
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onClose: () => void
  reload: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('')
  const [followUp, setFollowUp] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('network_marketing_contacts').insert({
      org_id: orgId,
      user_id: userId,
      full_name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      source: source.trim() || null,
      next_follow_up_at: followUp ? new Date(followUp).toISOString() : null,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onClose()
    reload()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <h2>Add a prospect</h2>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
          <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Friend, Referral, Event…" /></label>
          <label>Next follow-up<input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add prospect'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProspectDrawer({
  contact,
  activities,
  directPeople,
  orgId,
  userId,
  busy,
  setBusy,
  setError,
  onClose,
  reload,
}: {
  contact: NetworkMarketingContact | null
  activities: NetworkMarketingActivity[]
  directPeople: { id: string; fullName: string }[]
  orgId: string
  userId: string
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onClose: () => void
  reload: () => void
}) {
  const [reschedule, setReschedule] = useState('')
  const [showReschedule, setShowReschedule] = useState(false)

  useEffect(() => {
    setShowReschedule(false)
    setReschedule('')
  }, [contact?.id])

  if (!contact) return <div className="drawer-overlay" />

  const c = contact

  async function changeStage(stage: NetworkMarketingContactStage) {
    if (stage === c.stage) return
    setBusy(true)
    const { error } = await supabase
      .from('network_marketing_contacts')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', c.id)
    if (!error) {
      await supabase.from('network_marketing_activities').insert({
        org_id: orgId, contact_id: c.id, user_id: userId, note: `Moved to ${STAGE_LABEL[stage]}`, stage,
      })
    }
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }

  async function logContact() {
    setBusy(true)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('network_marketing_contacts')
      .update({ last_contacted_at: now, updated_at: now })
      .eq('id', c.id)
    if (!error) {
      await supabase.from('network_marketing_activities').insert({
        org_id: orgId, contact_id: c.id, user_id: userId, note: 'Contact logged', stage: c.stage,
      })
    }
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }

  async function saveReschedule() {
    if (!reschedule) return
    setBusy(true)
    const { error } = await supabase
      .from('network_marketing_contacts')
      .update({ next_follow_up_at: new Date(reschedule).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', c.id)
    setBusy(false)
    if (error) setError(error.message)
    else {
      setShowReschedule(false)
      reload()
    }
  }

  async function linkMember(memberId: string) {
    setBusy(true)
    const { error } = await supabase
      .from('network_marketing_contacts')
      .update({ linked_member_id: memberId || null, updated_at: new Date().toISOString() })
      .eq('id', c.id)
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }

  const overdue = c.next_follow_up_at && new Date(c.next_follow_up_at).getTime() < startOfToday().getTime()
  const waLink = c.phone ? `https://wa.me/${c.phone.replace(/[^\d]/g, '')}` : null

  return (
    <>
      <div className="drawer-overlay open" onClick={onClose} />
      <div className="drawer open">
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        <div className="drawer-head">
          <div className="drawer-avatar">{initialsOf(c.full_name)}</div>
          <div>
            <h3>{c.full_name}</h3>
            <p>{[c.phone, c.source].filter(Boolean).join(' · ') || 'No details'}</p>
          </div>
        </div>

        <div className="net-drawer-sec">
          <h4>Status</h4>
          <select value={c.stage} onChange={(e) => changeStage(e.target.value as NetworkMarketingContactStage)} disabled={busy}>
            {STAGE_ORDER.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
          </select>
        </div>

        <div className="net-drawer-sec">
          <h4>Follow-up</h4>
          <p className={overdue ? 'bad' : ''}>
            {c.next_follow_up_at
              ? `${new Date(c.next_follow_up_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}${overdue ? ' · Overdue' : ''}`
              : 'None scheduled'}
          </p>
          {showReschedule ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="datetime-local" value={reschedule} onChange={(e) => setReschedule(e.target.value)} />
              <button className="net-btn sm" onClick={saveReschedule} disabled={busy || !reschedule}>Save</button>
            </div>
          ) : (
            <button className="net-btn sm ghost" onClick={() => setShowReschedule(true)}>Reschedule</button>
          )}
        </div>

        <div className="net-drawer-sec">
          <h4>Link to member</h4>
          <select value={c.linked_member_id ?? ''} onChange={(e) => linkMember(e.target.value)} disabled={busy}>
            <option value="">Select sponsored member…</option>
            {directPeople.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        </div>

        <div className="net-drawer-sec">
          <h4>Quick actions</h4>
          <div className="net-drawer-actions">
            {c.phone && <a className="net-btn sm" href={`tel:${c.phone}`}>Call</a>}
            {waLink && <a className="net-btn sm ghost" href={waLink} target="_blank" rel="noreferrer">Message</a>}
            <button className="net-btn sm ghost" onClick={logContact} disabled={busy}>Log Contact</button>
          </div>
        </div>

        <div className="net-drawer-sec">
          <h4>Activity</h4>
          {activities.length === 0 ? (
            <p className="empty-row">Nothing logged yet.</p>
          ) : (
            activities.map((a) => (
              <div className="history-row" key={a.id}>
                <span className="hr-name">{humanizeActivity(a.note)}</span>
                <span className="hr-date">{fmtDate(a.created_at)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

// =======================================================================
// Follow-ups
// =======================================================================
function FollowUpsTab({
  orgId,
  userId,
  contacts,
  busy,
  setBusy,
  setError,
  reload,
}: {
  orgId: string
  userId: string
  contacts: NetworkMarketingContact[]
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  reload: () => void
}) {
  const [filter, setFilter] = useState<'overdue' | 'today' | 'upcoming' | 'completed'>('today')

  const groups = useMemo(() => {
    const t0 = startOfToday().getTime()
    const t1 = endOfToday().getTime()
    const overdue: NetworkMarketingContact[] = []
    const today: NetworkMarketingContact[] = []
    const upcoming: NetworkMarketingContact[] = []
    const completed: NetworkMarketingContact[] = []
    for (const c of contacts) {
      if (c.next_follow_up_at) {
        const t = new Date(c.next_follow_up_at).getTime()
        if (t < t0) overdue.push(c)
        else if (t <= t1) today.push(c)
        else upcoming.push(c)
      } else if (c.last_contacted_at) {
        completed.push(c)
      }
    }
    return { overdue, today, upcoming, completed }
  }, [contacts])

  async function markContacted(c: NetworkMarketingContact) {
    setBusy(true)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('network_marketing_contacts')
      .update({ last_contacted_at: now, next_follow_up_at: null, updated_at: now })
      .eq('id', c.id)
    if (!error) {
      await supabase.from('network_marketing_activities').insert({
        org_id: orgId, contact_id: c.id, user_id: userId, note: 'Marked contacted', stage: c.stage,
      })
    }
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }

  async function snooze(c: NetworkMarketingContact, days: number) {
    setBusy(true)
    const d = new Date()
    d.setDate(d.getDate() + days)
    const { error } = await supabase
      .from('network_marketing_contacts')
      .update({ next_follow_up_at: d.toISOString(), updated_at: new Date().toISOString() })
      .eq('id', c.id)
    setBusy(false)
    if (error) setError(error.message)
    else reload()
  }

  const list = groups[filter]

  const row = (c: NetworkMarketingContact) => {
    const wa = c.phone ? `https://wa.me/${c.phone.replace(/[^\d]/g, '')}` : null
    return (
      <div className="net-attn-row" key={c.id}>
        <span className="net-row-avatar sm">{initialsOf(c.full_name)}</span>
        <div className="net-attn-main">
          <strong>{c.full_name}</strong>
          <span>
            {filter === 'completed'
              ? `Last contacted ${fmtDate(c.last_contacted_at)}`
              : c.next_follow_up_at
                ? new Date(c.next_follow_up_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : '—'}
          </span>
        </div>
        <div className="net-drawer-actions">
          {c.phone && <a className="net-btn sm" href={`tel:${c.phone}`}>Call</a>}
          {wa && <a className="net-btn sm ghost" href={wa} target="_blank" rel="noreferrer">Message</a>}
          {filter !== 'completed' && (
            <>
              <button className="net-btn sm ghost" onClick={() => markContacted(c)} disabled={busy}>Mark Contacted</button>
              <button className="net-btn sm ghost" onClick={() => snooze(c, 3)} disabled={busy}>+3d</button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="chips net-chips">
        {(['overdue', 'today', 'upcoming', 'completed'] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)} · {groups[f].length}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="empty-row">Nothing here.</p>
      ) : (
        <div className="net-card">{list.map(row)}</div>
      )}
    </>
  )
}

// =======================================================================
// Network diagram
// =======================================================================
function NetworkTab({
  net,
  selfId,
  orgSlug,
  referralUrl,
}: {
  net: NetworkData
  selfId: string
  orgSlug: string | undefined
  referralUrl: string
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<NetworkNode | null>(null)
  const [search, setSearch] = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const expandAll = () => setCollapsed(new Set())
  const collapseAll = () => setCollapsed(new Set(net.flat.filter((n) => n.children.length).map((n) => n.person.id)))

  const runSearch = (e: FormEvent) => {
    e.preventDefault()
    const needle = search.trim().toLowerCase()
    if (!needle) return
    const hit = net.flat.find((n) => n.person.fullName.toLowerCase().includes(needle))
    if (hit) {
      // make sure the path to the hit is expanded
      setCollapsed((prev) => {
        const next = new Set(prev)
        for (const id of next) {
          // if this collapsed node is an ancestor of hit, expand it
          if (isAncestor(net, id, hit.person.id)) next.delete(id)
        }
        return next
      })
      setFocusId(hit.person.id)
      setTimeout(() => treeControls()?.centreOn(hit.person.id), 0)
    }
  }

  if (net.summary.total === 0) {
    return (
      <div className="net-empty">
        <div className="net-empty-viz">
          <span className="net-node self static">You</span>
          <span className="net-empty-line" />
          <span className="net-empty-invite">+ Invite</span>
        </div>
        <h3>Your network starts here</h3>
        <p>Invite your first member and begin building your organization.</p>
        <div className="net-drawer-actions" style={{ justifyContent: 'center' }}>
          <button className="net-btn" onClick={() => navigator.clipboard?.writeText(referralUrl)}>Copy Invitation Link</button>
          {orgSlug && (
            <a className="net-btn ghost" href={referralUrl} target="_blank" rel="noreferrer">Open link</a>
          )}
        </div>
      </div>
    )
  }

  const s = net.summary

  return (
    <>
      <div className="net-summary">
        <span><strong>{s.total}</strong> total</span>
        <span><strong>{s.direct}</strong> direct</span>
        <span><strong>{s.generations}</strong> generations</span>
        <span><strong>{s.active}</strong> active</span>
        {s.removed > 0 && <span className="dim"><strong>{s.removed}</strong> removed</span>}
      </div>

      <div className="net-tree-controls">
        <form onSubmit={runSearch}>
          <input
            className="net-search sm"
            placeholder="Search member…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <div className="net-zoom">
          <button className="net-btn sm ghost" onClick={() => treeControls()?.zoomBy(0.85)} aria-label="Zoom out">−</button>
          <span ref={zoomLabel}>Zoom</span>
          <button className="net-btn sm ghost" onClick={() => treeControls()?.zoomBy(1.15)} aria-label="Zoom in">+</button>
        </div>
        <button className="net-btn sm ghost" onClick={() => treeControls()?.fit()}>Fit View</button>
        <button className="net-btn sm ghost" onClick={expandAll}>Expand All</button>
        <button className="net-btn sm ghost" onClick={collapseAll}>Collapse All</button>
      </div>

      <NetworkTree
        root={net.root}
        collapsed={collapsed}
        onToggleCollapse={toggle}
        onSelect={setSelected}
        focusId={focusId}
        selfId={selfId}
      />

      {net.summary.perGeneration.length > 0 && (
        <div className="net-gen-legend">
          {net.summary.perGeneration.map((c, i) => (
            <span key={i}>Generation {i + 1}<strong>{c}</strong></span>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="drawer-overlay open" onClick={() => setSelected(null)} />
          <div className="drawer open">
            <button type="button" className="drawer-close" onClick={() => setSelected(null)}>✕</button>
            <div className="drawer-head">
              <div className="drawer-avatar">
                {selected.person.avatarUrl
                  ? <img src={selected.person.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  : initialsOf(selected.person.fullName)}
              </div>
              <div>
                <h3>{selected.person.id === selfId ? 'You' : selected.person.fullName}</h3>
                <p>{selected.person.active ? 'Active member' : 'Removed member'}</p>
              </div>
            </div>
            <div className="drawer-kpis">
              <div className="drawer-kpi"><div className="v">{selected.directCount}</div><div className="l">DIRECT</div></div>
              <div className="drawer-kpi"><div className="v">{selected.totalCount}</div><div className="l">DOWNLINE</div></div>
              <div className="drawer-kpi"><div className="v">Gen {selected.generation}</div><div className="l">DEPTH</div></div>
            </div>
            <div className="net-drawer-sec">
              <h4>Rank</h4>
              <p>{selected.person.rankName ?? 'Not started'}</p>
            </div>
            <div className="net-drawer-sec">
              <h4>Joined</h4>
              <p>{selected.person.joinedAt
                ? new Date(selected.person.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                : '—'}</p>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function isAncestor(net: NetworkData, ancestorId: string, descendantId: string): boolean {
  const node = net.byId.get(ancestorId)
  if (!node) return false
  const stack = [...node.children]
  while (stack.length) {
    const n = stack.pop()!
    if (n.person.id === descendantId) return true
    stack.push(...n.children)
  }
  return false
}
