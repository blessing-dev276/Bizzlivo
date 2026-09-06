import { useAuth } from '../../lib/AuthContext'
import AdminLearningCenter from './AdminLearningCenter'
import MemberLearningCenter from './MemberLearningCenter'

const STAFF = new Set(['admin', 'trainer', 'team_leader'])

export default function LearningCenter() {
  const { currentMembership } = useAuth()
  const role = currentMembership?.role
  return role && STAFF.has(role) ? <AdminLearningCenter /> : <MemberLearningCenter />
}
