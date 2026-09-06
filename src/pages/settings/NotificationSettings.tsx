import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { DEFAULT_PREFS, loadPrefs, savePrefs, type NotificationPrefs } from '../../lib/officeExtras'

const ROWS: { key: keyof NotificationPrefs; label: string; help: string }[] = [
  { key: 'goal_reminders', label: 'Goal reminders', help: 'Month-start reminders, review outcomes, deadlines.' },
  { key: 'learning', label: 'Learning notifications', help: 'New training published, exam and assignment updates.' },
  { key: 'finance', label: 'Finance notifications', help: 'Withdrawal approvals, settlements, payouts.' },
  { key: 'events', label: 'Event reminders', help: 'Upcoming events you’ve joined or are expected at.' },
  { key: 'announcements', label: 'Office announcements', help: 'Official updates from your office admins.' },
]

export default function NotificationSettings() {
  const { profile } = useAuth()
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!profile) return
    loadPrefs(profile.id).then((p) => {
      setPrefs(p)
      setLoading(false)
    })
  }, [profile])

  async function toggle(key: keyof NotificationPrefs) {
    if (!profile) return
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    await savePrefs(profile.id, next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (loading) return <p className="empty-row">Loading…</p>

  return (
    <div>
      <div className="page-head">
        <h1>Notifications</h1>
        <p>Choose which in-app notifications you want to receive. Action items always show on your dashboard.</p>
      </div>
      <div className="ns-list">
        {ROWS.map((r) => (
          <label className="ns-row" key={r.key}>
            <span>
              <strong>{r.label}</strong>
              <span className="ns-help">{r.help}</span>
            </span>
            <input type="checkbox" checked={prefs[r.key]} onChange={() => toggle(r.key)} />
          </label>
        ))}
      </div>
      {saved && <p className="form-info" style={{ marginTop: 12 }}>Saved.</p>}
    </div>
  )
}
