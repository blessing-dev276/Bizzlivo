import { useAuth } from '../../lib/AuthContext'
import TasksAdmin from './TasksAdmin'
import TasksMember from './TasksMember'

const MANAGE_ROLES = new Set(['admin', 'trainer', 'team_leader'])

export default function TasksHub() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <TasksAdmin /> : <TasksMember />
}
