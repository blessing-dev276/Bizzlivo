import { Link, useNavigate } from 'react-router-dom'
import type { OfficeSnapshot } from './useOfficeSnapshot'
import { untilLabel } from './dashboardShared'
import { IcSpark } from './icons'

interface Signal {
  key: string
  text: string
  tint: string
  action?: { label: string; to: string }
}

function buildSignals(d: OfficeSnapshot): Signal[] {
  const out: Signal[] = []

  // exam-activity trend
  if (d.attemptsThisWeek > 0 || d.attemptsLastWeek > 0) {
    let text: string
    if (d.attemptsLastWeek === 0) {
      text = `Exam activity picked up this week — ${d.attemptsThisWeek} completed.`
    } else {
      const pct = Math.round(((d.attemptsThisWeek - d.attemptsLastWeek) / d.attemptsLastWeek) * 100)
      text =
        d.attemptsThisWeek === d.attemptsLastWeek
          ? `Exam activity held steady this week (${d.attemptsThisWeek}).`
          : pct > 0
            ? `Exam activity is up ${pct}% this week.`
            : `Exam activity is down ${Math.abs(pct)}% this week.`
    }
    out.push({ key: 'trend', text, tint: 'var(--tint-primary)' })
  }

  // inactive members
  const inactive = Math.max(0, d.totalMembers - d.activeThisWeek)
  if (d.totalMembers >= 4 && inactive > 0) {
    out.push({
      key: 'inactive',
      text: `${inactive} member${inactive === 1 ? '' : 's'} haven't been active in the last 7 days.`,
      tint: 'var(--tint-attn)',
      action: { label: 'View members', to: '/invites' },
    })
  }

  // review queue
  if (d.courseworkPending > 0) {
    out.push({
      key: 'review',
      text: `${d.courseworkPending} coursework submission${d.courseworkPending === 1 ? '' : 's'} waiting for review.`,
      tint: 'var(--tint-primary)',
      action: { label: 'Review submissions', to: '/assignments' },
    })
  }

  // next event
  const next = d.upcomingEvents[0]
  if (next) {
    out.push({
      key: 'event',
      text: `Your next event, "${next.title}", is ${untilLabel(next.start_at).toLowerCase()}.`,
      tint: 'var(--tint-events)',
      action: { label: 'View event', to: `/events/${next.id}` },
    })
  }

  // new members / orientation
  if (d.newThisWeek > 0) {
    out.push({
      key: 'onboard',
      text: d.hasUpcomingOrientation
        ? `${d.newThisWeek} new member${d.newThisWeek === 1 ? '' : 's'} joined this week — an orientation is already scheduled.`
        : `${d.newThisWeek} new member${d.newThisWeek === 1 ? '' : 's'} joined this week — consider scheduling an orientation.`,
      tint: 'var(--tint-people)',
      action: d.hasUpcomingOrientation ? undefined : { label: 'Create event', to: '/events/new' },
    })
  }

  return out.slice(0, 4)
}

export function officeHasInsights(data: OfficeSnapshot | null, role: string | undefined): boolean {
  return role === 'admin' && !!data && buildSignals(data).length > 0
}

export default function OfficeInsights({ data, role }: { data: OfficeSnapshot | null; role: string | undefined }) {
  const navigate = useNavigate()
  if (role !== 'admin') return null
  if (!data) return null

  const signals = buildSignals(data)
  if (signals.length === 0) return null

  const actions = signals
    .filter((s): s is Signal & { action: NonNullable<Signal['action']> } => !!s.action)
    .filter((s, i, arr) => arr.findIndex((x) => x.action.label === s.action.label) === i)

  return (
    <section className="dash-card col-5">
      <div className="dash-card-head">
        <h2><IcSpark className="dash-h-ico" /> Bizzlivo Intelligence</h2>
      </div>
      <div className="intel-list">
        {signals.map((s) => (
          <div className="intel-row" key={s.key}>
            <span className="intel-dot" style={{ ['--_t' as string]: s.tint }} />
            <span className="intel-text">
              {s.text}
              {s.action && (
                <>
                  {' '}
                  <Link to={s.action.to}>{s.action.label} →</Link>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      {actions.length > 0 && (
        <div className="intel-actions">
          {actions.map((s) => (
            <button type="button" className="intel-btn" key={s.action.label} onClick={() => navigate(s.action.to)}>
              {s.action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
