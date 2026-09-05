import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { Notification } from '../types/database'

const POLL_MS = 60000

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

export default function NotificationBell() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  async function load() {
    if (!profile) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setItems((data as Notification[]) ?? [])
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const unreadCount = items.filter((n) => !n.read_at).length

  async function openNotification(n: Notification) {
    if (!n.read_at) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)))
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    }
    setOpen(false)
    if (n.payload?.link) navigate(n.payload.link)
  }

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length === 0) return
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds)
  }

  return (
    <div className="kebab-wrap">
      <button
        type="button"
        className="topbar-icon-btn"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) load()
        }}
        aria-label="Notifications"
        title="Notifications"
      >
        <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {unreadCount > 0 && <span className="notification-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div className="kebab-menu notification-menu-dropdown">
            <div className="notification-dropdown-head">
              <span>Notifications</span>
              {unreadCount > 0 && (
                <button type="button" className="btn-ghost" onClick={markAllRead}>Mark all read</button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="empty-note" style={{ padding: '12px 4px' }}>Nothing here yet.</p>
            ) : (
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={`notification-row ${!n.read_at ? 'unread' : ''}`}
                  onClick={() => openNotification(n)}
                >
                  <span className="notification-text">{n.payload?.text ?? n.type}</span>
                  <span className="notification-time">{timeAgo(n.created_at)}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
