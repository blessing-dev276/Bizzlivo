import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { reviewItem } from '../../lib/businessPath'

interface PendingRow {
  itemId: string
  userId: string
  memberName: string
  itemTitle: string
  rankName: string
  note: string | null
  submittedAt: string
}

// Staff review of member-submitted manual Business Path requirements.
export default function ApprovalQueue({ readOnly = false }: { readOnly?: boolean }) {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const [rows, setRows] = useState<PendingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data: progress } = await supabase
      .from('business_path_item_progress')
      .select('item_id, user_id, note, completed_at')
      .eq('org_id', orgId)
      .eq('status', 'awaiting_approval')
      .order('completed_at', { ascending: true })
    const prog = (progress as { item_id: string; user_id: string; note: string | null; completed_at: string }[]) ?? []
    if (prog.length === 0) { setRows([]); setLoading(false); return }

    const itemIds = [...new Set(prog.map((p) => p.item_id))]
    const userIds = [...new Set(prog.map((p) => p.user_id))]
    const [{ data: items }, { data: profiles }] = await Promise.all([
      supabase.from('business_path_items').select('id, title, rank_id').in('id', itemIds),
      supabase.from('profiles').select('id, full_name').in('id', userIds),
    ])
    const itemRows = (items as { id: string; title: string; rank_id: string }[]) ?? []
    const rankIds = [...new Set(itemRows.map((i) => i.rank_id))]
    const { data: ranks } = await supabase.from('business_path_ranks').select('id, name').in('id', rankIds)
    const rankName = new Map(((ranks as { id: string; name: string }[]) ?? []).map((r) => [r.id, r.name]))
    const itemById = new Map(itemRows.map((i) => [i.id, i]))
    const nameById = new Map(((profiles as { id: string; full_name: string }[]) ?? []).map((p) => [p.id, p.full_name]))

    setRows(prog.map((p) => {
      const it = itemById.get(p.item_id)
      return {
        itemId: p.item_id,
        userId: p.user_id,
        memberName: nameById.get(p.user_id) ?? 'Member',
        itemTitle: it?.title ?? 'Requirement',
        rankName: it ? rankName.get(it.rank_id) ?? '' : '',
        note: p.note,
        submittedAt: p.completed_at,
      }
    }))
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  async function decide(row: PendingRow, decision: 'approved' | 'rejected' | 'changes_requested') {
    if (!profile) return
    const note = decision === 'approved' ? undefined : window.prompt(decision === 'rejected' ? 'Reason for rejecting (optional):' : 'What needs to change?') ?? undefined
    setBusyKey(row.itemId + row.userId)
    await reviewItem(row.itemId, row.userId, profile.id, decision, note)
    setBusyKey(null)
    await load()
  }

  if (loading || rows.length === 0) return null

  return (
    <div className="dash-card" style={{ marginBottom: 18, borderColor: 'var(--tint-events)' }}>
      <div className="dash-card-head">
        <h2>Awaiting your approval <span className="nav-badge" style={{ display: 'inline-flex' }}>{rows.length}</span></h2>
      </div>
      <div className="lc-section-list">
        {rows.map((r) => (
          <div className="lc-section-row" key={r.itemId + r.userId}>
            <div className="lc-section-main">
              <h3>{r.itemTitle}</h3>
              <p>{r.memberName}{r.rankName ? ` · ${r.rankName}` : ''}{r.note ? ` — "${r.note}"` : ''}</p>
            </div>
            {!readOnly && (
              <div className="lc-section-actions">
                <button type="button" className="btn-primary-link" disabled={busyKey === r.itemId + r.userId} onClick={() => decide(r, 'approved')}>Approve</button>
                <button type="button" className="btn-ghost" disabled={busyKey === r.itemId + r.userId} onClick={() => decide(r, 'changes_requested')}>Request changes</button>
                <button type="button" className="btn-ghost" disabled={busyKey === r.itemId + r.userId} onClick={() => decide(r, 'rejected')}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
