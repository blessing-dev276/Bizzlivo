import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Row {
  id: string
  verb: string
  summary: string
  created_at: string
}

const VERB_ICON: Record<string, string> = {
  member_joined: '👋',
  prospect_added: '🎯',
  goal_submitted: '📝',
  goal_approved: '✅',
  rank_promoted: '🏆',
  freelance_completed: '📦',
  exam_passed: '🎓',
}

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(1, m)}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// Reads the persistent activity_log (0051). `scope='mine'` shows the
// viewer's own activity (RLS: actor_id = auth.uid()); default shows
// whatever the viewer's role can read (admin: org; team leader: team).
export default function OfficeActivityFeed({
  orgId,
  scope = 'office',
  limit = 8,
  title = 'Office activity',
}: {
  orgId: string
  scope?: 'office' | 'mine'
  limit?: number
  title?: string
}) {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let q = supabase
      .from('activity_log')
      .select('id, verb, summary, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    q.then(({ data }) => setRows((data as Row[]) ?? []))
  }, [orgId, scope, limit])

  return (
    <section className="dash-card">
      <div className="dash-card-head"><h2>{title}</h2></div>
      {!rows ? (
        <p className="md-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="md-muted">No activity yet.</p>
      ) : (
        <ul className="oaf-list">
          {rows.map((r) => (
            <li key={r.id} className="oaf-row">
              <span className="oaf-ico" aria-hidden>{VERB_ICON[r.verb] ?? '•'}</span>
              <span className="oaf-text">{r.summary}</span>
              <span className="oaf-time">{ago(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
