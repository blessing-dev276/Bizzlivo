import { useAuth } from '../../../lib/AuthContext'
import PersonalDevelopmentAdmin from './PersonalDevelopmentAdmin'
import PersonalDevelopmentMember from './PersonalDevelopmentMember'

const MANAGE_ROLES = new Set(['admin'])

// Owner/Admin curate the daily-required resource list and see who's kept
// up; everyone else gets today's checklist — same split as OnboardingHub.
export default function PersonalDevelopmentHub() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <PersonalDevelopmentAdmin /> : <PersonalDevelopmentMember />
}
