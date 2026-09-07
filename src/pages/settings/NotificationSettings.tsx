import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { DEFAULT_PREFS, loadPrefs, savePrefs, type NotificationPrefs } from '../../lib/officeExtras'

// One row per notification category. Each category has an in-app channel and
// an email channel, mapped to the columns that already exist on
// notification_prefs (0050 in-app + 0053 email mirror).
interface CategoryRow {
  label: string
  help: string
  inApp: keyof NotificationPrefs
  email: keyof NotificationPrefs
}

const CATEGORIES: CategoryRow[] = [
  { label: 'Goals & accountability', help: 'Month-start reminders, review outcomes, deadlines.', inApp: 'goal_reminders', email: 'email_goals' },
  { label: 'Learning', help: 'New training published, quiz and assignment updates.', inApp: 'learning', email: 'email_learning' },
  { label: 'Finance', help: 'Withdrawal approvals, settlements and payouts.', inApp: 'finance', email: 'email_finance' },
  { label: 'Events', help: 'Reminders for events you’ve joined or are expected at.', inApp: 'events', email: 'email_events' },
  { label: 'Announcements', help: 'Official updates from your office admins.', inApp: 'announcements', email: 'email_announcements' },
]

// Every editable key across both channels — used by the bulk actions.
const EDITABLE_KEYS = CATEGORIES.flatMap((c) => [c.inApp, c.email])

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange?: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <label className={`nmx-sw ${disabled ? 'is-disabled' : ''}`} title={label}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
      <span className="nmx-sw-track" aria-hidden />
    </label>
  )
}

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

  async function persist(next: NotificationPrefs) {
    setPrefs(next)
    if (!profile) return
    await savePrefs(profile.id, next)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  const toggle = (key: keyof NotificationPrefs) => persist({ ...prefs, [key]: !prefs[key] })
  const setAll = (value: boolean) => {
    const next = { ...prefs }
    for (const k of EDITABLE_KEYS) next[k] = value
    persist(next)
  }

  const { onCount, total } = useMemo(() => {
    const on = EDITABLE_KEYS.filter((k) => prefs[k]).length
    return { onCount: on, total: EDITABLE_KEYS.length }
  }, [prefs])

  if (loading) return <p className="empty-row">Loading…</p>

  const allOn = onCount === total
  const allOff = onCount === 0

  return (
    <div>
      <div className="page-head">
        <h1>Notifications</h1>
        <p>
          Choose how each kind of update reaches you. Urgent action items always appear on your dashboard and in the{' '}
          <Link to="/notifications">Notification Center</Link>.
        </p>
      </div>

      <div className="nmx-bar">
        <span className="nmx-count">{onCount} of {total} channels on</span>
        <div className="nmx-bar-actions">
          <button type="button" className="btn-ghost" onClick={() => setAll(true)} disabled={allOn}>Enable all</button>
          <button type="button" className="btn-ghost" onClick={() => setAll(false)} disabled={allOff}>Mute all</button>
        </div>
      </div>

      <div className="nmx">
        <div className="nmx-head">
          <span>Category</span>
          <span className="nmx-col">In-app</span>
          <span className="nmx-col">Email</span>
        </div>

        {CATEGORIES.map((c) => (
          <div className="nmx-row" key={c.inApp}>
            <span className="nmx-cat">
              <strong>{c.label}</strong>
              <span className="nmx-help">{c.help}</span>
            </span>
            <span className="nmx-col">
              <Switch checked={!!prefs[c.inApp]} onChange={() => toggle(c.inApp)} label={`${c.label} — in-app`} />
            </span>
            <span className="nmx-col">
              <Switch checked={!!prefs[c.email]} onChange={() => toggle(c.email)} label={`${c.label} — email`} />
            </span>
          </div>
        ))}

        <div className="nmx-row is-locked">
          <span className="nmx-cat">
            <strong>Account &amp; security</strong>
            <span className="nmx-help">Invites, sign-in alerts, billing and support. Always sent by email.</span>
          </span>
          <span className="nmx-col nmx-na">—</span>
          <span className="nmx-col">
            <Switch checked disabled label="Account & security — email (always on)" />
          </span>
        </div>
      </div>

      <p className="nmx-note">
        We only email things that are important or time-sensitive — never routine activity. In-app notifications are
        grouped and can be cleared in the Notification Center.
      </p>

      {saved && <p className="form-info" style={{ marginTop: 12 }}>Saved.</p>}
    </div>
  )
}
