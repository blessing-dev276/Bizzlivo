import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import AppSkeleton from './AppSkeleton'

// Copy shown when the active office is no longer usable. A "deleted" office
// looks the same to the member as one that never existed — the platform can
// bring it back silently.
const STATUS_COPY: Record<string, { title: string; body: string }> = {
  suspended: {
    title: 'This office is temporarily unavailable',
    body: 'Access has been paused. Please check back later or contact your office admin.',
  },
  deleted: {
    title: 'This office is no longer available',
    body: 'This office has been closed. If you believe this is a mistake, contact your office admin.',
  },
}

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, currentMembership, memberships, signOut } = useAuth()

  if (loading) return <AppSkeleton />
  if (!session) return <Navigate to="/login" replace />

  const status = currentMembership?.organization?.status
  if (currentMembership && status && status !== 'active') {
    const copy = STATUS_COPY[status] ?? STATUS_COPY.deleted
    const others = memberships.filter((m) => m.organization?.status === 'active')
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <h1 style={{ marginBottom: 8 }}>{copy.title}</h1>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>{copy.body}</p>
          {others.length > 0 ? (
            <p style={{ color: 'var(--muted)' }}>
              You belong to {others.length} other {others.length === 1 ? 'office' : 'offices'} — switch from the office menu.
            </p>
          ) : null}
          <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
