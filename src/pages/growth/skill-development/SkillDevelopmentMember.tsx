import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { ClassPurpose, SkillClass } from '../../../types/database'

interface Props {
  purpose: ClassPurpose
}

// Shared by Skill Development and Income Development's Skill Catalog —
// see SkillDevelopmentAdmin.tsx for why.
export default function SkillDevelopmentMember({ purpose }: Props) {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [classes, setClasses] = useState<SkillClass[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('classes')
      .select('*')
      .eq('org_id', orgId)
      .eq('purpose', purpose)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setClasses((data as SkillClass[]) ?? [])
        setLoading(false)
      })
  }, [orgId, purpose])

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
        Work through these at your own pace — videos, PDFs, articles, tests, quizzes, and assignments your office has put together.
      </p>

      {classes.length === 0 ? (
        <p className="empty-row">No classes published yet.</p>
      ) : (
        <div className="exam-list">
          {classes.map((c) => (
            <div className="exam-card" key={c.id}>
              <div className="exam-top">
                <div className="exam-title-block">
                  <h3><Link to={`/training/classes/${c.id}`}>{c.title}</Link></h3>
                  {c.description && <div className="exam-sub">{c.description}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
