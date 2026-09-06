import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

interface Hit {
  kind: string
  id: string
  label: string
  sublabel: string
  route: string
}

const KIND_ICON: Record<string, string> = {
  member: '👤', class: '📘', event: '📅', rank: '🏆', goal: '🎯',
  network_prospect: '🕸', freelance_prospect: '💼', freelance_client: '🤝', freelance_project: '📦',
}

interface QuickAction { label: string; route: string; roles: string[] }
const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Add network prospect', route: '/my-team?tab=prospects', roles: ['member', 'team_leader', 'trainer', 'admin'] },
  { label: 'Add freelance prospect', route: '/freelance?view=prospects', roles: ['member', 'team_leader', 'trainer', 'admin'] },
  { label: 'Create a goal', route: '/goals', roles: ['member', 'team_leader', 'trainer', 'admin'] },
  { label: 'Create an event', route: '/events/new', roles: ['admin', 'trainer'] },
  { label: 'Record a finance order', route: '/finance', roles: ['admin'] },
  { label: 'Invite a member', route: '/invites', roles: ['admin'] },
  { label: 'New announcement', route: '/office/announcements', roles: ['admin'] },
]

export default function CommandK({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const role = currentMembership?.role ?? 'member'
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (open) {
      setQ('')
      setHits([])
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const run = useCallback(
    (value: string) => {
      window.clearTimeout(timer.current)
      if (!orgId || value.trim().length < 2) {
        setHits([])
        return
      }
      timer.current = window.setTimeout(async () => {
        setBusy(true)
        const { data } = await supabase.rpc('search_office', { p_org: orgId, q: value.trim(), p_limit: 6 })
        setBusy(false)
        setHits(Array.isArray(data) ? (data as Hit[]) : [])
      }, 220)
    },
    [orgId],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const actions = QUICK_ACTIONS.filter((a) => a.roles.includes(role))
  const go = (route: string) => {
    onClose()
    navigate(route)
  }

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search members, training, events, prospects…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            run(e.target.value)
          }}
        />
        <div className="cmdk-body">
          {q.trim().length >= 2 && (
            <>
              <div className="cmdk-sec">Results{busy ? ' …' : ''}</div>
              {hits.length === 0 && !busy && <div className="cmdk-empty">Nothing found.</div>}
              {hits.map((h) => (
                <button key={`${h.kind}-${h.id}`} type="button" className="cmdk-row" onClick={() => go(h.route)}>
                  <span className="cmdk-ico">{KIND_ICON[h.kind] ?? '•'}</span>
                  <span className="cmdk-label">{h.label}</span>
                  <span className="cmdk-sub">{h.sublabel}</span>
                </button>
              ))}
            </>
          )}
          <div className="cmdk-sec">Quick actions</div>
          {actions.map((a) => (
            <button key={a.route + a.label} type="button" className="cmdk-row" onClick={() => go(a.route)}>
              <span className="cmdk-ico">＋</span>
              <span className="cmdk-label">{a.label}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-foot"><kbd>Esc</kbd> to close</div>
      </div>
    </div>
  )
}
