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

// Email mirrors — a subset. Important account & security emails are
// always sent and are not shown here.
const EMAIL_ROWS: { key: keyof NotificationPrefs; label: string; help: string }[] = [
  { key: 'email_goals', label: 'Goals & accountability', help: 'Goal reminders and review outcomes by email.' },
  { key: 'email_finance', label: 'Finance updates', help: 'Withdrawal status changes by email.' },
  { key: 'email_events', label: 'Event reminders', help: 'Upcoming event reminders by email.' },
  { key: 'email_announcements', label: 'Office announcements', help: 'Announcements your admin chooses to email.' },
  { key: 'email_learning', label: 'Learning updates', help: 'Occasional learning summaries by email.' },
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

      <div className="page-head" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Email me about</h2>
        <p>We only email things that are important or time-sensitive — never routine activity.</p>
      </div>
      <div className="ns-list">
        <label className="ns-row" style={{ opacity: 0.7 }}>
          <span>
            <strong>Important account &amp; security emails</strong>
            <span className="ns-help">Invites, security alerts, billing and support. Always on.</span>
          </span>
          <input type="checkbox" checked readOnly disabled />
        </label>
        {EMAIL_ROWS.map((r) => (
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
