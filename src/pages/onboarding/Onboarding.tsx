import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

interface ChecklistState {
  hasResource: boolean
  hasExam: boolean
  hasInvitedTeam: boolean
}

export default function Onboarding() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [state, setState] = useState<ChecklistState | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false

    async function load() {
      const [resources, exams, invitesOrMembers] = await Promise.all([
        supabase.from('resources').select('id', { count: 'exact', head: true }).eq('org_id', orgId!),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('org_id', orgId!),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', orgId!),
      ])
      if (cancelled) return
      setState({
        hasResource: (resources.count ?? 0) > 0,
        hasExam: (exams.count ?? 0) > 0,
        hasInvitedTeam: (invitesOrMembers.count ?? 0) > 1,
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [orgId])

  return (
    <div className="page">
      <h1>Welcome to {currentMembership?.organization.name}</h1>
      <p>Let's get your office set up. Three steps to your first exam:</p>

      <ol className="checklist">
        <li className={state?.hasResource ? 'done' : ''}>
          <Link to="/exams">1. Upload your first resource</Link>
          {state?.hasResource && <span className="check">✓</span>}
        </li>
        <li className={state?.hasExam ? 'done' : ''}>
          <Link to="/exams">2. Generate your first exam</Link>
          {state?.hasExam && <span className="check">✓</span>}
        </li>
        <li className={state?.hasInvitedTeam ? 'done' : ''}>
          <Link to="/invites">3. Invite your team</Link>
          {state?.hasInvitedTeam && <span className="check">✓</span>}
        </li>
      </ol>

      <Link to="/" className="skip-link">Skip to dashboard →</Link>
    </div>
  )
}
