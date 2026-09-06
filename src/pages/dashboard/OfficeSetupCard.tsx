import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dismissOfficeSetup, loadOfficeSetup, type SetupStep } from '../../lib/officeSetup'

export default function OfficeSetupCard({ orgId }: { orgId: string }) {
  const [steps, setSteps] = useState<SetupStep[] | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    loadOfficeSetup(orgId).then(({ steps, dismissed }) => {
      setSteps(steps)
      if (dismissed) setHidden(true)
    })
  }, [orgId])

  if (hidden || !steps) return null
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null

  return (
    <section className="dash-card os-card">
      <div className="dash-card-head">
        <h2>Welcome to Bizzlivo — set up your office</h2>
        <span className="os-count">{done} of {steps.length} complete</span>
      </div>
      <div className="os-bar"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="os-list">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'done' : ''}>
            <span className="os-check">{s.done ? '✓' : '○'}</span>
            <span className="os-label">{s.label}</span>
            {!s.done && <Link to={s.route} className="os-go">Set up →</Link>}
          </li>
        ))}
      </ul>
      <button type="button" className="os-dismiss" onClick={async () => { setHidden(true); await dismissOfficeSetup(orgId) }}>
        Dismiss — I'll finish later
      </button>
    </section>
  )
}
