import { useAuth } from '../../../lib/AuthContext'
import NetworkMarketingAdmin from './NetworkMarketingAdmin'
import NetworkMarketingMember from './NetworkMarketingMember'

const MANAGE_ROLES = new Set(['admin'])

export default function NetworkMarketingHub() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <NetworkMarketingAdmin /> : <NetworkMarketingMember />
}
