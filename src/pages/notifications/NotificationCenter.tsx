import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIF_TABS,
  type NotifRow,
} from '../../lib/officeExtras'

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationCenter() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<NotifRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('all')

  const load = () => {
    if (!profile) return
    setLoading(true)
    loadNotifications(profile.id).then((r) => {
      setRows(r)
      setLoading(false)
    })
  }
  useEffect(load, [profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabDef = NOTIF_TABS.find((t) => t.id === tab)
  const visible = useMemo(
    () => (tab === 'all' ? rows : rows.filter((r) => tabDef?.match?.includes((r.category ?? 'business') as never))),
    [rows, tab, tabDef],
  )
  const unread = rows.filter((r) => !r.read_at)

  async function open(n: NotifRow) {
    if (!n.read_at) {
      setRows((p) => p.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      await markNotificationRead(n.id)
    }
    if (n.payload?.link) navigate(n.payload.link)
  }
  async function markAll() {
    const ids = unread.map((n) => n.id)
    if (!ids.length) return
    setRows((p) => p.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })))
    await markAllNotificationsRead(ids)
  }

  return (
    <div className="page nc-page">
      <div className="page-head nc-head">
        <div>
          <h1>Notifications</h1>
          <p>Everything happening across your office — {unread.length} unread.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unread.length > 0 && <button type="button" className="gl-btn ghost sm" onClick={markAll}>Mark all read</button>}
          <Link to="/settings" className="gl-btn ghost sm">Preferences</Link>
        </div>
      </div>

      <div className="rp-tabs" role="tablist">
        {NOTIF_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="empty-row">Nothing here.</p>
      ) : (
        <div className="nc-list">
          {visible.map((n) => (
            <button key={n.id} type="button" className={`nc-row ${!n.read_at ? 'unread' : ''}`} onClick={() => open(n)}>
              {!n.read_at && <span className="nc-dot" aria-hidden />}
              <span className="nc-text">{n.payload?.text ?? n.type}</span>
              <span className="nc-cat">{n.category ?? ''}</span>
              <span className="nc-time">{timeAgo(n.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
