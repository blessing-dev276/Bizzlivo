import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  CATEGORY_LABEL,
  CATEGORY_TABS,
  INCLUDE_TOGGLES,
  PERIODS,
  adjustPoints,
  getLeaderboard,
  getMemberPoints,
  getPointBreakdown,
  getTeamLeaderboard,
  loadAdjustments,
  loadRules,
  loadSettings,
  recalculate,
  resetRules,
  saveRule,
  saveSettings,
  type AdjustmentRow,
  type LbCategory,
  type LbPeriod,
  type LeaderboardRow,
  type LeaderboardSettings,
  type MemberPoints,
  type PointBreakdown,
  type PointRule,
  type TeamRow,
} from '../../lib/leaderboard'

function initials(name: string | null | undefined) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

function Avatar({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return <img className="avatar" style={{ width: size, height: size }} src={url} alt="" onError={() => setFailed(true)} />
  }
  return <div className="avatar" style={{ width: size, height: size }} title={name}>{initials(name)}</div>
}

const CATEGORY_KEYS = ['learning', 'business_path', 'network', 'goals'] as const

// ============================================================
// Member-facing board
// ============================================================

function Board({ orgId, userId, settings }: { orgId: string; userId: string; settings: LeaderboardSettings }) {
  const [period, setPeriod] = useState<LbPeriod>(settings.default_period ?? 'month')
  const [category, setCategory] = useState<LbCategory>('overall')
  const [scope, setScope] = useState<'individuals' | 'teams'>('individuals')

  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [teams, setTeams] = useState<TeamRow[] | null>(null)
  const [me, setMe] = useState<MemberPoints | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [openMember, setOpenMember] = useState<LeaderboardRow | null>(null)
  const [breakdown, setBreakdown] = useState<PointBreakdown | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [rules, setRules] = useState<PointRule[] | null>(null)

  const load = useCallback(() => {
    setError(null)
    setRows(null)
    getLeaderboard(orgId, period, category)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
    getMemberPoints(orgId, userId, period).then(setMe).catch(() => setMe(null))
    if (settings.team_board_enabled) {
      getTeamLeaderboard(orgId, period).then(setTeams).catch(() => setTeams([]))
    }
  }, [orgId, userId, period, category, settings.team_board_enabled])

  useEffect(load, [load])

  useEffect(() => {
    if (!showRules || rules) return
    loadRules(orgId).then(setRules).catch(() => setRules([]))
  }, [showRules, rules, orgId])

  const openOwnBreakdown = () => {
    const mine = rows?.find((r) => r.user_id === userId) ?? null
    setOpenMember(mine ?? { user_id: userId, full_name: 'You' } as LeaderboardRow)
    setBreakdown(null)
    getPointBreakdown(orgId, userId, period).then(setBreakdown).catch(() => setBreakdown(null))
  }

  const openRow = (row: LeaderboardRow) => {
    setOpenMember(row)
    setBreakdown(null)
    if (row.user_id === userId) {
      getPointBreakdown(orgId, userId, period).then(setBreakdown).catch(() => setBreakdown(null))
    }
  }

  const podium = (rows ?? []).slice(0, 3)
  const hasAny = (rows ?? []).some((r) => r.total !== 0)

  return (
    <div className="lb">
      <div className="lb-controls">
        <div className="chips">
          {PERIODS.map((p) => (
            <button key={p.id} className={`chip ${period === p.id ? 'active' : ''}`} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {settings.team_board_enabled && (
          <div className="chips">
            <button className={`chip ${scope === 'individuals' ? 'active' : ''}`} onClick={() => setScope('individuals')}>Individuals</button>
            <button className={`chip ${scope === 'teams' ? 'active' : ''}`} onClick={() => setScope('teams')}>Teams</button>
          </div>
        )}
      </div>

      {scope === 'individuals' && (
        <div className="chips lb-cats">
          {CATEGORY_TABS.map((c) => (
            <button key={c.id} className={`chip ${category === c.id ? 'active' : ''}`} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {me && scope === 'individuals' && (
        <button className="lb-you" onClick={openOwnBreakdown}>
          <div>
            <span className="lb-you-label">Your Position</span>
            <span className="lb-you-pos">{me.position ? `#${me.position}` : '—'}</span>
            <span className="lb-you-of">of {me.member_count} members</span>
          </div>
          <div className="lb-you-right">
            <span className="lb-you-pts">{me.total} Points</span>
            {me.movement != null && me.movement !== 0 && (
              <span className={`lb-move ${me.movement > 0 ? 'up' : 'down'}`}>
                {me.movement > 0 ? '↑' : '↓'} {Math.abs(me.movement)} {Math.abs(me.movement) === 1 ? 'position' : 'positions'} this {period === 'week' ? 'week' : 'month'}
              </span>
            )}
            <span className="lb-you-hint">View breakdown</span>
          </div>
        </button>
      )}

      {error && <p className="empty-note">Couldn't load the leaderboard: {error}</p>}

      {scope === 'teams' ? (
        <TeamBoard teams={teams} />
      ) : !rows ? (
        <p className="empty-note">Loading rankings…</p>
      ) : !hasAny ? (
        <div className="empty-office-card">
          <h3>No rankings yet</h3>
          <p>Complete eligible activities to start earning Performance Points.</p>
          <div className="empty-office-actions">
            <button className="btn-primary-link" onClick={() => setShowRules(true)}>See How Points Work</button>
          </div>
        </div>
      ) : (
        <>
          <div className="lb-podium">
            {podium.map((r, i) => (
              <button key={r.user_id} className={`lb-pod lb-pod-${i + 1}`} onClick={() => openRow(r)}>
                <span className="lb-pod-rank">{i + 1}</span>
                <Avatar url={r.avatar_url} name={r.full_name} size={i === 0 ? 64 : 52} />
                <span className="lb-pod-name">{r.full_name}</span>
                <span className="lb-pod-sub">{r.business_rank}</span>
                <span className="lb-pod-pts">{category === 'overall' ? r.total : r.total} pts</span>
              </button>
            ))}
          </div>

          <div className="table-card">
            <div className="table-wrap">
              <table className="data-table lb-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Member</th>
                    <th className="lb-hide-sm">Business Rank</th>
                    <th className="lb-hide-sm">Team</th>
                    <th className="lb-hide-md">Learning</th>
                    <th className="lb-hide-md">Business Path</th>
                    <th className="lb-hide-md">Network</th>
                    <th className="lb-hide-md">Goals</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.user_id}
                      className={r.user_id === userId ? 'lb-me' : ''}
                      onClick={() => openRow(r)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{i + 1}</td>
                      <td>
                        <span className="lb-cell-member">
                          <Avatar url={r.avatar_url} name={r.full_name} size={26} />
                          {r.full_name}
                        </span>
                      </td>
                      <td className="lb-hide-sm">{r.business_rank}</td>
                      <td className="lb-hide-sm">{r.team ?? '—'}</td>
                      <td className="lb-hide-md">{r.learning}</td>
                      <td className="lb-hide-md">{r.business_path}</td>
                      <td className="lb-hide-md">{r.network}</td>
                      <td className="lb-hide-md">{r.goals}</td>
                      <td><strong>{r.total}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button className="lb-link" onClick={() => setShowRules((v) => !v)}>
            {showRules ? 'Hide' : 'How points work'}
          </button>
          {showRules && <HowPointsWork rules={rules} />}
        </>
      )}

      {openMember && (
        <MemberPanel
          row={openMember}
          isSelf={openMember.user_id === userId}
          breakdown={breakdown}
          onClose={() => setOpenMember(null)}
        />
      )}
    </div>
  )
}

function TeamBoard({ teams }: { teams: TeamRow[] | null }) {
  if (!teams) return <p className="empty-note">Loading teams…</p>
  if (teams.length === 0) return <p className="empty-note">No teams have earned points in this period yet.</p>
  return (
    <div className="table-card">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Team</th><th>Members</th><th>Points</th></tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr key={t.group_id}>
                <td>{i + 1}</td>
                <td>{t.name}</td>
                <td>{t.member_count}</td>
                <td><strong>{t.total}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HowPointsWork({ rules }: { rules: PointRule[] | null }) {
  if (!rules) return <p className="empty-note">Loading rules…</p>
  const active = rules.filter((r) => r.active && r.points > 0)
  return (
    <div className="card lb-rules-card">
      <h4 className="overview-heading">How Points Work</h4>
      <p style={{ color: 'var(--text-dim)', margin: '0 0 12px', fontSize: 13 }}>
        Points come from verified activity recorded across Bizzlivo. The same qualifying
        event is only ever counted once.
      </p>
      <ul className="lb-rules-list">
        {active.map((r) => (
          <li key={r.id}>
            <span>{r.label}</span>
            <span className="lb-rule-pts">+{r.points}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MemberPanel({
  row,
  isSelf,
  breakdown,
  onClose,
}: {
  row: LeaderboardRow
  isSelf: boolean
  breakdown: PointBreakdown | null
  onClose: () => void
}) {
  return (
    <div className="lb-overlay" onClick={onClose}>
      <div className="lb-panel" onClick={(e) => e.stopPropagation()}>
        <button className="lb-panel-close" onClick={onClose} aria-label="Close">×</button>
        <div className="lb-panel-head">
          <Avatar url={row.avatar_url} name={row.full_name} size={48} />
          <div>
            <strong>{row.full_name}</strong>
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {row.business_rank ?? 'Prospect'}{row.team ? ` · ${row.team}` : ''}
            </div>
          </div>
        </div>

        <h4 className="overview-heading">{isSelf ? 'How you earned your points' : 'Points by category'}</h4>
        <ul className="lb-breakdown">
          {CATEGORY_KEYS.map((k) => (
            <li key={k}>
              <span>{CATEGORY_LABEL[k]}</span>
              <span>+{(row[k] as number) ?? 0}</span>
            </li>
          ))}
          {(row.adjustment ?? 0) !== 0 && (
            <li><span>Adjustments</span><span>{row.adjustment > 0 ? '+' : ''}{row.adjustment}</span></li>
          )}
          <li className="lb-breakdown-total"><span>Total</span><span>{row.total ?? 0}</span></li>
        </ul>

        {isSelf && breakdown && breakdown.recent.length > 0 && (
          <>
            <h4 className="overview-heading">Recent points</h4>
            <ul className="lb-recent">
              {breakdown.recent.map((e, idx) => (
                <li key={idx}>
                  <span className={`lb-recent-pts ${e.points < 0 ? 'neg' : ''}`}>
                    {e.points > 0 ? '+' : ''}{e.points}
                  </span>
                  <span>{e.reason || e.label}</span>
                  <span className="lb-recent-date">{new Date(e.occurred_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Admin — settings & point rules
// ============================================================

function AdminSettings({ orgId }: { orgId: string }) {
  const [settings, setSettings] = useState<LeaderboardSettings | null>(null)
  const [rules, setRules] = useState<PointRule[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    loadSettings(orgId).then(setSettings)
    loadRules(orgId).then(setRules)
  }, [orgId])
  useEffect(load, [load])

  const patch = async (p: Partial<LeaderboardSettings>) => {
    if (!settings) return
    setSettings({ ...settings, ...p })
    try {
      await saveSettings(orgId, p)
    } catch (e) {
      setMsg((e as Error).message)
      load()
    }
  }

  const changeRulePoints = async (rule: PointRule, points: number) => {
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, points } : r)))
    try {
      await saveRule(rule.id, { points })
    } catch (e) {
      setMsg((e as Error).message)
      load()
    }
  }

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg(ok)
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <p className="empty-note">Loading settings…</p>

  const byCategory = new Map<string, PointRule[]>()
  for (const r of rules) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, [])
    byCategory.get(r.category)!.push(r)
  }

  return (
    <div className="lb-admin">
      {msg && <p className="empty-note">{msg}</p>}

      <div className="card">
        <h4 className="overview-heading">Leaderboard Settings</h4>
        <div className="toggle-row">
          <label><input type="checkbox" checked={settings.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> Enable Leaderboard</label>
        </div>
        <div className="toggle-row">
          <label><input type="checkbox" checked={settings.team_board_enabled} onChange={(e) => patch({ team_board_enabled: e.target.checked })} /> Show team leaderboard</label>
        </div>
        <div style={{ margin: '10px 0' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)', marginRight: 8 }}>Default period</span>
          {PERIODS.map((p) => (
            <button key={p.id} className={`chip ${settings.default_period === p.id ? 'active' : ''}`} onClick={() => patch({ default_period: p.id })}>
              {p.label}
            </button>
          ))}
        </div>

        <h4 className="overview-heading" style={{ marginTop: 16 }}>Included Categories</h4>
        {INCLUDE_TOGGLES.map(([key, label]) => (
          <div className="toggle-row" key={key}>
            <label>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => patch({ [key]: e.target.checked } as Partial<LeaderboardSettings>)}
              />{' '}
              {label}
              {key === 'include_events' && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> — enable once confirmed attendance is recorded</span>}
            </label>
          </div>
        ))}
      </div>

      <div className="card">
        <h4 className="overview-heading">Point Rules</h4>
        <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: '0 0 12px' }}>
          Changes apply to activity <strong>from now on</strong>. Past points keep the value
          they were earned at. Use <em>Recalculate</em> to also restate an existing period.
        </p>
        {[...byCategory.entries()].map(([cat, catRules]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div className="lb-rule-cat">{CATEGORY_LABEL[cat] ?? cat}</div>
            {catRules.map((r) => (
              <div className="lb-rule-row" key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={async (e) => {
                      setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: e.target.checked } : x)))
                      try {
                        await saveRule(r.id, { active: e.target.checked })
                      } catch (err) {
                        setMsg((err as Error).message)
                      }
                    }}
                  />
                  {r.label}
                </label>
                <input
                  type="number"
                  min={0}
                  value={r.points}
                  onChange={(e) => changeRulePoints(r, Math.max(0, Number(e.target.value) || 0))}
                  className="lb-rule-input"
                />
              </div>
            ))}
          </div>
        ))}
        <div className="empty-office-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="secondary" disabled={busy} onClick={() => run(() => resetRules(orgId), 'Default rules restored.')}>
            Reset to defaults
          </button>
          <button className="secondary" disabled={busy} onClick={() => run(() => recalculate(orgId, 'month'), 'Recalculated this month.')}>
            Recalculate this month
          </button>
          <button className="secondary" disabled={busy} onClick={() => run(() => recalculate(orgId, 'all'), 'Recalculated all-time.')}>
            Recalculate all-time
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Admin — manual adjustments
// ============================================================

interface OrgMember {
  user_id: string
  full_name: string
}

function AdminAdjustments({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [rows, setRows] = useState<AdjustmentRow[]>([])
  const [userId, setUserId] = useState('')
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(full_name)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(({ data }) => {
        const list = ((data ?? []) as { user_id: string; profile: { full_name: string } | { full_name: string }[] | null }[]).map((m) => {
          const p = Array.isArray(m.profile) ? m.profile[0] : m.profile
          return { user_id: m.user_id, full_name: p?.full_name ?? 'Member' }
        })
        list.sort((a, b) => a.full_name.localeCompare(b.full_name))
        setMembers(list)
      })
    loadAdjustments(orgId).then(setRows)
  }, [orgId])
  useEffect(load, [load])

  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.full_name ?? '—'

  const submit = async () => {
    const n = Number(points)
    if (!userId || !n || !reason.trim()) {
      setMsg('Pick a member, a non-zero point value, and a reason.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await adjustPoints(orgId, userId, n, reason.trim())
      setPoints('')
      setReason('')
      setUserId('')
      setMsg('Adjustment recorded.')
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lb-admin">
      <div className="card">
        <h4 className="overview-heading">Manual Adjustment</h4>
        <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: '0 0 12px' }}>
          Use only for genuine corrections. Every adjustment is written to the audit log with
          your name, the amount, and the reason.
        </p>
        <div className="lb-adjust-form">
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Points (e.g. 10 or -10)"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
          <input
            type="text"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn-primary-link" disabled={busy} onClick={submit}>Apply</button>
        </div>
        {msg && <p className="empty-note">{msg}</p>}
      </div>

      <div className="table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>When</th><th>Member</th><th>Points</th><th>Reason</th><th>By</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="empty-row">No adjustments yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{nameOf(r.entity_id)}</td>
                  <td><strong>{(r.metadata?.points ?? 0) > 0 ? '+' : ''}{r.metadata?.points ?? 0}</strong></td>
                  <td style={{ whiteSpace: 'normal' }}>{r.metadata?.reason ?? '—'}</td>
                  <td>{nameOf(r.actor_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Page shell
// ============================================================

type AdminTab = 'board' | 'settings' | 'adjustments'

export default function Leaderboard() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const userId = profile?.id
  const isAdmin = currentMembership?.role === 'admin'

  const [settings, setSettings] = useState<LeaderboardSettings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<AdminTab>('board')

  useEffect(() => {
    if (!orgId) return
    loadSettings(orgId)
      .then(setSettings)
      .finally(() => setLoaded(true))
  }, [orgId])

  const header = useMemo(
    () => (
      <>
        <h1>Leaderboard</h1>
        <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
          See who's making consistent progress across the office — learning, building their
          business, completing goals and moving through Bizzlivo.
        </p>
      </>
    ),
    [],
  )

  if (!orgId || !userId) return <div className="page">{header}</div>

  if (loaded && settings && !settings.enabled && !isAdmin) {
    return (
      <div className="page">
        {header}
        <p className="empty-note">The leaderboard is turned off for this office.</p>
      </div>
    )
  }

  return (
    <div className="page">
      {header}

      {isAdmin && (
        <div className="chips" style={{ marginBottom: 18 }}>
          <button className={`chip ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>View Rankings</button>
          <button className={`chip ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings &amp; Point Rules</button>
          <button className={`chip ${tab === 'adjustments' ? 'active' : ''}`} onClick={() => setTab('adjustments')}>Adjustments</button>
        </div>
      )}

      {tab === 'settings' && isAdmin && <AdminSettings orgId={orgId} />}
      {tab === 'adjustments' && isAdmin && <AdminAdjustments orgId={orgId} />}
      {tab === 'board' && (
        !loaded || !settings ? (
          <p className="empty-note">Loading…</p>
        ) : (
          <Board orgId={orgId} userId={userId} settings={settings} />
        )
      )}
    </div>
  )
}
