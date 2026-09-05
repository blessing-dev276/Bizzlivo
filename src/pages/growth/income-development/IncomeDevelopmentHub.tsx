import { useAuth } from '../../../lib/AuthContext'
import IncomeDevelopmentAdmin from './IncomeDevelopmentAdmin'
import IncomeDevelopmentMember from './IncomeDevelopmentMember'

const MANAGE_ROLES = new Set(['admin'])

export default function IncomeDevelopmentHub() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <IncomeDevelopmentAdmin /> : <IncomeDevelopmentMember />
}
