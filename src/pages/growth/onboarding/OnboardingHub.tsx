import { useAuth } from '../../../lib/AuthContext'
import OnboardingAdmin from './OnboardingAdmin'
import OnboardingMember from './OnboardingMember'

const MANAGE_ROLES = new Set(['admin'])

// The one pillar in Training that's actually built, not a placeholder —
// Owner/Admin get the content-management + progress-tracking view, everyone
// else gets the step-through flow they're a member going through.
export default function OnboardingHub() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <OnboardingAdmin /> : <OnboardingMember />
}
