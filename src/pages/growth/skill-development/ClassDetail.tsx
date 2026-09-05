import { useAuth } from '../../../lib/AuthContext'
import ClassEditor from './ClassEditor'
import ClassPlayer from './ClassPlayer'

const MANAGE_ROLES = new Set(['admin', 'trainer', 'team_leader'])

// Same class, same URL — role decides whether you get the module/item
// builder or the read-and-work-through view. Mirrors SkillDevelopmentHub.
export default function ClassDetail() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <ClassEditor /> : <ClassPlayer />
}
