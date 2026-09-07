import { Link } from 'react-router-dom'
import { trialDaysLeft, useOrgUsage } from '../../lib/plans'
import { planLabel as planName } from '../../lib/entitlements'

export default function WorkplaceFooter({ orgId, canManageBilling }: { orgId: string | undefined; canManageBilling: boolean }) {
  const { usage } = useOrgUsage(orgId)
  const daysLeft = usage ? trialDaysLeft(usage) : null
  const isTopTier = usage?.plan === 'business' && usage.status !== 'trialing'
  const planLabel = usage
    ? usage.status === 'trialing' && daysLeft !== null
      ? `Trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
      : planName(usage)
    : '—'

  return (
    <div className="wf-grid">
      <div className="wf-card">
        <p className="wf-quote">
          "Invest in people. Everything else follows."
          <cite>The Bizzlivo way</cite>
        </p>
      </div>

      {canManageBilling && (
        <div className="wf-card">
          <h3>Your plan</h3>
          <p>{planLabel}. {isTopTier ? "You're on the top tier." : 'Unlock more members, quizzes and AI.'}</p>
          {!isTopTier && <Link to="/settings/billing" className="btn-primary-link">Upgrade plan</Link>}
        </div>
      )}

      <div className="wf-card">
        <h3>Need a hand?</h3>
        <p>Manage your office, people and content from Settings, or revisit setup.</p>
        <Link to="/settings" className="md-btn ghost">Open Settings</Link>
      </div>
    </div>
  )
}
