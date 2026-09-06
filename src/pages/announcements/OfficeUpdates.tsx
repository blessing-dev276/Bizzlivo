import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import {
  ackAnnouncement,
  loadMemberAnnouncements,
  markAnnouncementRead,
  type Announcement,
  type AnnouncementRead,
} from '../../lib/officeExtras'

export default function OfficeUpdates() {
  const { profile } = useAuth()
  const [items, setItems] = useState<Announcement[]>([])
  const [reads, setReads] = useState<Map<string, AnnouncementRead>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = () => {
    if (!profile) return
    setLoading(true)
    loadMemberAnnouncements(profile.id).then(({ items, reads }) => {
      setItems(items)
      setReads(reads)
      setLoading(false)
    })
  }
  useEffect(load, [profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // mark everything visible as read once, on open
  useEffect(() => {
    if (!profile || items.length === 0) return
    const unread = items.filter((a) => !reads.get(a.id)?.read_at)
    for (const a of unread) markAnnouncementRead(a.id, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  async function ack(a: Announcement) {
    if (!profile) return
    await ackAnnouncement(a.id, profile.id)
    load()
  }

  if (loading) return <div className="page"><h1>Office Updates</h1><p className="empty-row">Loading…</p></div>

  return (
    <div className="page ou-page">
      <div className="page-head">
        <h1>Office Updates</h1>
        <p>Official announcements from your office.</p>
      </div>

      {items.length === 0 ? (
        <p className="empty-row">No updates right now.</p>
      ) : (
        <div className="ou-list">
          {items.map((a) => {
            const r = reads.get(a.id)
            return (
              <article key={a.id} className={`ou-card ${a.priority} ${a.pinned ? 'pinned' : ''}`}>
                <div className="ou-top">
                  {a.pinned && <span className="ou-pin">📌 Pinned</span>}
                  {a.priority === 'high' && <span className="ou-flag">Important</span>}
                  <span className="ou-when">{new Date(a.publish_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
                <h3>{a.title}</h3>
                <p className="ou-body">{a.body}</p>
                <div className="ou-actions">
                  {a.related_event_id && <Link to={`/events/${a.related_event_id}`} className="gl-btn sm ghost">View Event</Link>}
                  {a.link && !a.related_event_id && <a href={a.link} className="gl-btn sm ghost" target={a.link.startsWith('http') ? '_blank' : undefined} rel="noreferrer">Open link</a>}
                  {a.requires_ack && (
                    r?.acked_at
                      ? <span className="ou-acked">✓ Acknowledged</span>
                      : <button type="button" className="gl-btn sm" onClick={() => ack(a)}>Acknowledge</button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
