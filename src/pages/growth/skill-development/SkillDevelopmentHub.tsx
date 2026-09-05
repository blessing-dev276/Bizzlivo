import { useAuth } from '../../../lib/AuthContext'
import SkillDevelopmentAdmin from './SkillDevelopmentAdmin'
import SkillDevelopmentMember from './SkillDevelopmentMember'

// Unlike Onboarding/Personal Development (admin only), Trainers and Team
// Leaders build curriculum too here — matches how Exams/Resources/
// Coursework already treat 'trainer' as a content manager, and the
// class_* RLS policies (0022_skill_development_classes.sql) grant them
// the same access.
const MANAGE_ROLES = new Set(['admin', 'trainer', 'team_leader'])

export default function SkillDevelopmentHub() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  return canManage ? <SkillDevelopmentAdmin purpose="skill_development" /> : <SkillDevelopmentMember purpose="skill_development" />
}
