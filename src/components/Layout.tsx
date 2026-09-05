import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { PLAN_COPY, trialDaysLeft, useOrgUsage } from '../lib/plans'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'
import ProfileMenu from './ProfileMenu'

const ADMIN_ROLES = new Set(['admin', 'trainer'])
const MANAGE_ROLES = new Set(['admin'])
const LEARNING_CENTER_PATHS = ['/exams', '/assignments', '/training']

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

// Placeholder for sidebar sections that are on the roadmap but have no
// functional spec yet — visible (matches the intended nav shape) but inert,
// so nothing half-built gets shipped under a real link.
function SoonItem({ label }: { label: string }) {
  return (
    <span className="sidebar-nav-soon" title="Coming soon">
      {label}
      <span className="badge soon-badge">Soon</span>
    </span>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, currentMembership, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const canManageBilling = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  const isMember = currentMembership?.role === 'member'
  const { usage } = useOrgUsage(currentMembership?.organization.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const isLearningCenterRoute = LEARNING_CENTER_PATHS.some((p) => location.pathname.startsWith(p))
  const [learningCenterOpen, setLearningCenterOpen] = useState(isLearningCenterRoute)

  useEffect(() => {
    if (isLearningCenterRoute) setLearningCenterOpen(true)
  }, [isLearningCenterRoute])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const daysLeft = usage ? trialDaysLeft(usage) : null
  const planBadgeClass = usage ? (usage.status === 'trialing' ? 'trialing' : usage.plan !== 'free' ? 'active' : '') : ''
  const planLabel = usage
    ? usage.status === 'trialing' && daysLeft !== null
      ? `Trial · ${daysLeft}d left`
      : PLAN_COPY[usage.plan].label
    : null
  const isTopTier = usage?.plan === 'business' && usage.status !== 'trialing'

  const navLinks = (
    <>
      <NavLink to="/" end onClick={() => setMenuOpen(false)}>Dashboard</NavLink>

      <NavLink to="/tasks" onClick={() => setMenuOpen(false)}>Tasks</NavLink>

      {isAdmin && (
        <div className="nav-group">
          <button
            type="button"
            className={`nav-group-toggle ${isLearningCenterRoute ? 'active' : ''}`}
            onClick={() => setLearningCenterOpen((o) => !o)}
            aria-expanded={learningCenterOpen}
          >
            Learning Center
            <svg className={`nav-chevron ${learningCenterOpen ? 'open' : ''}`} viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {learningCenterOpen && (
            <div className="nav-subgroup">
              <NavLink to="/exams" onClick={() => setMenuOpen(false)}>Exams</NavLink>
              <NavLink to="/assignments" onClick={() => setMenuOpen(false)}>Assignments</NavLink>
              <NavLink to="/training" onClick={() => setMenuOpen(false)}>Training</NavLink>
            </div>
          )}
        </div>
      )}
      {/* Non-admins have no Learning Center group to nest under, but Training
          (the member growth journey) is for them too — same page, own top-level link. */}
      {!isAdmin && <NavLink to="/training" onClick={() => setMenuOpen(false)}>Training</NavLink>}

      {isAdmin && <NavLink to="/invites" onClick={() => setMenuOpen(false)}>Members</NavLink>}
      {canManageBilling && <NavLink to="/team-performance" onClick={() => setMenuOpen(false)}>Team Performance</NavLink>}
      <NavLink to="/leaderboard" onClick={() => setMenuOpen(false)}>Leaderboard</NavLink>
      <NavLink to="/events" onClick={() => setMenuOpen(false)}>Events</NavLink>
      <NavLink to="/reports" onClick={() => setMenuOpen(false)}>Reports</NavLink>
      {isAdmin && <SoonItem label="Communication" />}
      {canManageBilling && <NavLink to="/settings" onClick={() => setMenuOpen(false)}>Settings</NavLink>}

      {isMember && <NavLink to="/cbt" onClick={() => setMenuOpen(false)}>My Exams</NavLink>}
      {isMember && <NavLink to="/my-assignments" onClick={() => setMenuOpen(false)}>My Assignments</NavLink>}
    </>
  )

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation menu"
        >
          ☰
        </button>
        <Link to="/" className="logo">
          <span className="logo-mark">H</span>
          HQ<span>360</span>
        </Link>
        <div className="avatar" title={profile?.full_name ?? ''}>{initials(profile?.full_name)}</div>
      </div>

      <div className={`sidebar-backdrop ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <Link to="/" className="logo">
            <span className="logo-mark">H</span>
            HQ<span>360</span>
          </Link>
          {currentMembership && (
            <span className="office-pill">
              <span className="dot" />
              {currentMembership.organization.name}
            </span>
          )}
        </div>
        <nav className="sidebar-nav">{navLinks}</nav>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="avatar" title={profile?.full_name ?? ''}>{initials(profile?.full_name)}</div>
            <div className="profile-info">
              <span className="profile-name">{profile?.full_name ?? '…'}</span>
              {profile?.email && <span className="profile-email">{profile.email}</span>}
            </div>
            <button className="icon-signout" onClick={handleSignOut} aria-label="Sign out">
              <svg viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
          {canManageBilling && planLabel && (
            <div className="plan-row">
              <span className={`badge ${planBadgeClass}`}>{planLabel}</span>
              {!isTopTier && (
                <Link to="/billing" className="plan-upgrade-btn">Upgrade</Link>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="app-main">
        <div className="topbar">
          <button type="button" className="topbar-icon-btn" disabled title="Search (coming soon)" aria-label="Search (coming soon)">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </button>
          <NotificationBell />
          <button type="button" className="topbar-icon-btn" disabled title="AI Assistant (coming soon)" aria-label="AI Assistant (coming soon)">
            <svg viewBox="0 0 24 24"><path d="M12 2l1.6 4.6L18 8l-4.4 1.4L12 14l-1.6-4.6L6 8l4.4-1.4z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
          </button>
          <ThemeToggle />
          <button type="button" className="topbar-icon-btn" onClick={() => window.location.reload()} aria-label="Refresh page" title="Refresh page">
            <svg viewBox="0 0 24 24"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          </button>
          <ProfileMenu />
        </div>
        {children}
      </main>
    </div>
  )
}
