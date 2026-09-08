import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { trialDaysLeft, useOrgUsage } from '../lib/plans'
import { PLAN_META, needsPlanSelection } from '../lib/entitlements'
import type { PlanTier } from '../types/database'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'
import ProfileMenu from './ProfileMenu'
import CommandK from './CommandK'

const ADMIN_ROLES = new Set(['admin', 'trainer'])
const MANAGE_ROLES = new Set(['admin'])
const SIDEBAR_COLLAPSED_KEY = 'bizzlivo.sidebarCollapsed'

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

function NavItem({
  to,
  icon,
  label,
  onNavigate,
  badge,
  end,
}: {
  to: string
  icon: ReactNode
  label: string
  onNavigate: () => void
  badge?: number
  end?: boolean
}) {
  return (
    <NavLink to={to} end={end ?? to === '/'} onClick={onNavigate}>
      {icon}
      <span className="nav-label">{label}</span>
      {badge != null && badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  )
}

// A collapsible sidebar section that nests NavItems under one labelled row.
// Open/closed is controlled by the parent so only one group is open at a
// time (accordion); it still lights up when the current route is inside.
function NavGroup({
  icon,
  label,
  paths,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode
  label: string
  paths: string[]
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const isInside = paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <div className="nav-group">
      <button
        type="button"
        className={`nav-group-toggle ${isInside ? 'active' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="nav-group-lead">
          {icon}
          <span className="nav-label">{label}</span>
        </span>
        <svg className={`nav-chevron ${open ? 'open' : ''}`} viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && <div className="nav-subgroup">{children}</div>}
    </div>
  )
}

const I = {
  dashboard: <svg className="nav-ico" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
  onboarding: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>,
  tasks: <svg className="nav-ico" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>,
  path: <svg className="nav-ico" viewBox="0 0 24 24"><circle cx="5" cy="19" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><path d="M6.4 17.6 10.6 13.4M13.4 10.6 17.6 6.4" /></svg>,
  goals: <svg className="nav-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>,
  reports: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>,
  network: <svg className="nav-ico" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M12 7.5v4M12 11.5 6.5 17M12 11.5 17.5 17" /></svg>,
  rank: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M12 2 15 8l6 .9-4.5 4.4L17.7 20 12 16.9 6.3 20l1.2-6.7L3 8.9 9 8z" /></svg>,
  leaderboard: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 22V17.8a4 4 0 0 1-2.83-2.83L6 4h12l-1.17 10.99A4 4 0 0 1 14 17.8V22" /></svg>,
  wallet: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></svg>,
  learning: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  members: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  profile: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  megaphone: <svg className="nav-ico" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>,
  help: <svg className="nav-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12" y2="17" /></svg>,
  teamPerf: <svg className="nav-ico" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  myTeam: <svg className="nav-ico" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.6" /><circle cx="5" cy="19" r="2.6" /><circle cx="19" cy="19" r="2.6" /><path d="M12 7.6v4M12 11.6 6.6 17M12 11.6 17.4 17" /></svg>,
  exams: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M9 15l2 2 4-4" /></svg>,
  assignments: <svg className="nav-ico" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>,
  events: <svg className="nav-ico" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  settings: <svg className="nav-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.22.65.22 1 0 .35-.08.69-.22 1z" /></svg>,
  activities: <svg className="nav-ico" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M13 7l-5 6h4l-1 5 5-6h-4z" /></svg>,
  finance: <svg className="nav-ico" viewBox="0 0 24 24"><line x1="3" y1="21" x2="21" y2="21" /><path d="M4 10h16M5 6l7-3 7 3M6 10v8M12 10v8M18 10v8" /></svg>,
}

// ---------------------------------------------------------------------------
// One declarative, capability-driven navigation config. Sections + items are
// filtered against the current user's capabilities (NavCtx) so Admin, Trainer,
// Team Leader and Member all read from the same source — no parallel arrays to
// drift. `roles`/permission checks stay here, never in the rendered markup.
// ---------------------------------------------------------------------------
interface NavCtx {
  isMember: boolean
  isStaff: boolean
  isAdmin: boolean // admin or trainer — office content managers
  isManager: boolean // admin only — people / billing / office settings
  canReviewGoals: boolean // admin or team_leader (permission-driven)
}
type BadgeKey = 'pendingMembers' | 'submissions'
interface NavLeaf {
  to: string
  icon: ReactNode
  label: string
  end?: boolean
  badge?: BadgeKey
  show?: (c: NavCtx) => boolean
}
interface NavGroupDef {
  group: true
  icon: ReactNode
  label: string
  paths: string[]
  show?: (c: NavCtx) => boolean
  children: NavLeaf[]
}
type NavEntry = NavLeaf | NavGroupDef
interface NavSection {
  label: string
  show?: (c: NavCtx) => boolean
  items: NavEntry[]
}

const isGroup = (e: NavEntry): e is NavGroupDef => 'group' in e

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', icon: I.dashboard, label: 'Dashboard', end: true },
      { to: '/training', icon: I.learning, label: 'Learning Center' },
    ],
  },
  {
    label: 'Business',
    items: [
      {
        group: true,
        icon: I.network,
        label: 'My Network',
        paths: ['/my-team', '/team', '/invites'],
        show: (c) => c.isAdmin || c.isManager,
        children: [
          { to: '/my-team', icon: I.network, label: 'Overview', end: true },
          { to: '/team', icon: I.teamPerf, label: 'Team', show: (c) => c.isManager },
          { to: '/invites', icon: I.members, label: 'Members', badge: 'pendingMembers', show: (c) => c.isAdmin },
        ],
      },
      { to: '/my-team', icon: I.network, label: 'My Network', show: (c) => !(c.isAdmin || c.isManager) },
      { to: '/business-path', icon: I.path, label: 'Business Path' },
      // Team leaders keep the personal + review group. Admins have no
      // personal goals — they review member goals from a member's profile
      // and get the review queue as a standalone item below.
      {
        group: true,
        icon: I.goals,
        label: 'My Goals',
        paths: ['/goals'],
        show: (c) => c.canReviewGoals && !c.isManager,
        children: [
          { to: '/goals', icon: I.goals, label: 'Overview', end: true },
          { to: '/goals/review', icon: I.reports, label: 'Goal Reviews' },
        ],
      },
      { to: '/goals/review', icon: I.reports, label: 'Goal Reviews', show: (c) => c.isManager },
      { to: '/goals', icon: I.goals, label: 'My Goals', show: (c) => !c.canReviewGoals },
      // Admins have no wallet of their own — they manage member earnings in Finance.
      { to: '/wallet', icon: I.wallet, label: 'My Wallet', show: (c) => !c.isManager },
    ],
  },
  {
    label: 'Management',
    show: (c) => c.isStaff,
    items: [
      {
        group: true,
        icon: I.activities,
        label: 'Activities',
        paths: ['/quizzes', '/assignments', '/events', '/office/announcements'],
        children: [
          { to: '/quizzes', icon: I.exams, label: 'Quizzes', show: (c) => c.isAdmin },
          { to: '/assignments', icon: I.assignments, label: 'Assignments', badge: 'submissions', show: (c) => c.isAdmin },
          { to: '/events', icon: I.events, label: 'Events' },
          { to: '/office/announcements', icon: I.megaphone, label: 'Announcements', show: (c) => c.isAdmin },
        ],
      },
      { to: '/finance', icon: I.finance, label: 'Finance', show: (c) => c.isAdmin },
    ],
  },
  {
    label: 'Insights',
    show: (c) => c.isStaff,
    items: [
      { to: '/reports', icon: I.reports, label: 'Reports & Insights' },
      { to: '/leaderboard', icon: I.leaderboard, label: 'Leaderboard' },
    ],
  },
  {
    label: 'Community',
    show: (c) => c.isMember,
    items: [
      { to: '/leaderboard', icon: I.leaderboard, label: 'Leaderboard' },
      { to: '/updates', icon: I.megaphone, label: 'Office Updates' },
    ],
  },
  {
    label: 'System',
    items: [
      {
        group: true,
        icon: I.settings,
        label: 'Settings',
        paths: ['/settings'],
        children: [
          { to: '/settings/profile', icon: I.profile, label: 'Profile' },
          { to: '/settings/notifications', icon: I.megaphone, label: 'Notifications' },
          { to: '/settings/security', icon: I.settings, label: 'Account & Security' },
          // Office / Finance / Integrations / Billing share one tabbed page.
          { to: '/settings/office', icon: I.myTeam, label: 'Office settings', show: (c) => c.isAdmin },
        ],
      },
      { to: '/help', icon: I.help, label: 'Help & Support' },
    ],
  },
]

interface ResolvedSection {
  label: string
  items: NavEntry[]
}

function resolveNav(ctx: NavCtx): ResolvedSection[] {
  const out: ResolvedSection[] = []
  for (const section of NAV_SECTIONS) {
    if (section.show && !section.show(ctx)) continue
    const items: NavEntry[] = []
    for (const entry of section.items) {
      if (isGroup(entry)) {
        if (entry.show && !entry.show(ctx)) continue
        const children = entry.children.filter((k) => !k.show || k.show(ctx))
        if (children.length === 0) continue
        // A group that collapses to a single child reads cleaner as a flat item.
        if (children.length === 1) items.push(children[0])
        else items.push({ ...entry, children })
      } else if (!entry.show || entry.show(ctx)) {
        items.push(entry)
      }
    }
    if (items.length > 0) out.push({ label: section.label, items })
  }
  return out
}

// Two cheap head-counts for the staff nav badges. Only runs for admins.
function useStaffBadges(orgId: string | undefined, enabled: boolean) {
  const [counts, setCounts] = useState({ pendingMembers: 0, submissions: 0 })
  useEffect(() => {
    if (!orgId || !enabled) return
    let cancelled = false
    Promise.all([
      supabase.from('pending_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
      supabase.from('coursework_submissions').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'submitted'),
    ]).then(([p, s]) => {
      if (!cancelled) setCounts({ pendingMembers: p.count ?? 0, submissions: s.count ?? 0 })
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId, enabled])
  return counts
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, currentMembership, memberships, setCurrentOrgId, signOut, refresh } = useAuth()
  const navigate = useNavigate()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const canManageBilling = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  const isMember = currentMembership?.role === 'member'
  const canReviewGoals = currentMembership?.role === 'admin' || currentMembership?.role === 'team_leader'
  const orgId = currentMembership?.organization.id
  const { usage } = useOrgUsage(orgId)
  const badges = useStaffBadges(orgId, isAdmin)
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [topMenuOpen, setTopMenuOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [routeKey, setRouteKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  const switchRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!switchOpen) return
    function onDoc(e: MouseEvent) {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) setSwitchOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [switchOpen])

  // Custom brand colour (Business `custom_branding` entitlement). Applied as
  // the accent override for the whole shell; cleared when switching to an
  // office without one.
  const brandColor = currentMembership?.organization.brand_color
  useEffect(() => {
    const el = document.documentElement
    if (brandColor && /^#[0-9a-f]{6}$/i.test(brandColor)) {
      el.style.setProperty('--accent', brandColor)
      el.style.setProperty('--gold', brandColor)
    } else {
      el.style.removeProperty('--accent')
      el.style.removeProperty('--gold')
    }
    return () => {
      el.style.removeProperty('--accent')
      el.style.removeProperty('--gold')
    }
  }, [brandColor])

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // Soft refresh — re-pull session/profile/memberships and remount the current
  // route's subtree (so its data re-fetches) without a full-page reload.
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
      setRouteKey((k) => k + 1)
    }
  }

  const closeMenu = () => setMenuOpen(false)

  const daysLeft = usage ? trialDaysLeft(usage) : null
  const needsPlan = needsPlanSelection(usage)
  const planBadgeClass = usage
    ? needsPlan
      ? 'expired'
      : usage.status === 'trialing'
        ? 'trialing'
        : 'active'
    : ''
  const planLabel = !usage
    ? null
    : needsPlan
      ? 'Trial ended'
      : usage.status === 'trialing' && daysLeft !== null
        ? `Trial · ${daysLeft}d left`
        : PLAN_META[usage.plan as PlanTier]?.label ?? '—'
  const isTopTier = usage?.plan === 'business' && usage.status !== 'trialing'
  const org = currentMembership?.organization
  const canSwitchOffice = memberships.length > 1

  // The office is the brand — its logo + name sit where the Bizzlivo wordmark
  // used to. When the user belongs to more than one office it doubles as the
  // office switcher (there's no longer an office tag in the topbar).
  const brandInner = (
    <>
      {org?.logo_url ? (
        <img className="office-logo-img" src={org.logo_url} alt="" />
      ) : (
        <span className="logo-mark">{initials(org?.name ?? 'BZ')}</span>
      )}
      <span className="office-logo-name">{org?.name ?? 'Bizzlivo'}</span>
    </>
  )

  const brand = canSwitchOffice ? (
    <div className="brand-switch kebab-wrap" ref={switchRef}>
      <button
        type="button"
        className="logo office-logo brand-switch-btn"
        onClick={() => setSwitchOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={switchOpen}
      >
        {brandInner}
        <svg className="office-card-chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {switchOpen && (
        <div className="office-switch">
          {memberships.map((m) => (
            <button
              type="button"
              key={m.org_id}
              className={m.org_id === currentMembership?.org_id ? 'current' : ''}
              onClick={() => {
                setCurrentOrgId(m.org_id)
                setSwitchOpen(false)
                closeMenu()
                navigate('/')
              }}
            >
              <span className="office-card-logo" style={{ width: 22, height: 22, fontSize: 10 }}>
                {initials(m.organization.name)}
              </span>
              {m.organization.name}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : (
    <Link to="/" className="logo office-logo" onClick={closeMenu}>
      {brandInner}
    </Link>
  )

  const navCtx: NavCtx = {
    isMember,
    isStaff: !!currentMembership && !isMember,
    isAdmin,
    isManager: canManageBilling,
    canReviewGoals,
  }
  const navSections = resolveNav(navCtx)

  // Accordion: only one nav group open at a time. Opening one closes the
  // rest; navigating into a group's route opens it and closes the others.
  const { pathname: navPathname } = useLocation()
  const activeGroupLabel = (() => {
    for (const section of navSections) {
      for (const entry of section.items) {
        if (isGroup(entry) && entry.paths.some((p) => navPathname === p || navPathname.startsWith(`${p}/`))) {
          return entry.label
        }
      }
    }
    return null
  })()
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupLabel)
  useEffect(() => {
    if (activeGroupLabel) setOpenGroup(activeGroupLabel)
  }, [activeGroupLabel])

  const sidebarNav = navSections.map((section) => (
    <div className="sidebar-sec" key={section.label}>
      <span className="sidebar-sec-label">{section.label}</span>
      {section.items.map((entry) =>
        isGroup(entry) ? (
          <NavGroup
            key={entry.label}
            icon={entry.icon}
            label={entry.label}
            paths={entry.paths}
            open={openGroup === entry.label}
            onToggle={() => setOpenGroup((cur) => (cur === entry.label ? null : entry.label))}
          >
            {entry.children.map((child) => (
              <NavItem
                key={child.to}
                to={child.to}
                icon={child.icon}
                label={child.label}
                end={child.end}
                badge={child.badge ? badges[child.badge] : undefined}
                onNavigate={closeMenu}
              />
            ))}
          </NavGroup>
        ) : (
          <NavItem
            key={`${section.label}:${entry.to}`}
            to={entry.to}
            icon={entry.icon}
            label={entry.label}
            end={entry.end}
            badge={entry.badge ? badges[entry.badge] : undefined}
            onNavigate={closeMenu}
          />
        ),
      )}
    </div>
  ))

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button type="button" className="mobile-nav-toggle" onClick={() => setMenuOpen(true)} aria-label="Open navigation menu">☰</button>
        {brand}
        <div className="avatar" title={profile?.full_name ?? ''}>{initials(profile?.full_name)}</div>
      </div>

      <div className={`sidebar-backdrop ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />

      <aside className={`sidebar ${menuOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-top">
          {brand}
        </div>

        <nav className="sidebar-nav">{sidebarNav}</nav>

        <div className="sidebar-bottom">
          <button
            type="button"
            className="sidebar-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
          </button>

          {!isMember && (
            <div className="profile-row">
              <div className="avatar" title={profile?.full_name ?? ''}>{initials(profile?.full_name)}</div>
              <div className="profile-info">
                <span className="profile-name">{profile?.full_name ?? '…'}</span>
                {profile?.email && <span className="profile-email">{profile.email}</span>}
              </div>
            </div>
          )}

          {canManageBilling && planLabel && (
            <div className="plan-row">
              <span className={`badge ${planBadgeClass}`}>{planLabel}</span>
              {!isTopTier && <Link to="/settings/billing" className="plan-upgrade-btn">Upgrade</Link>}
            </div>
          )}

          <button className="sidebar-logout" onClick={handleSignOut}>
            <svg viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="topbar">
          <button type="button" className="cmdbar" onClick={() => setCmdkOpen(true)}>
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <span>Search members, training, events, prospects…</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="topbar-controls">
            <button
              type="button"
              className={`topbar-icon-btn ${refreshing ? 'is-spinning' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
            >
              <svg viewBox="0 0 24 24"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            </button>
            <NotificationBell />
            <ThemeToggle />
            <ProfileMenu />
            <button type="button" className="topbar-logout" onClick={handleSignOut} aria-label="Log out" title="Log out">
              <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              <span>Log out</span>
            </button>
          </div>

          <div className="topbar-more">
            <button
              type="button"
              className="topbar-icon-btn"
              onClick={() => setTopMenuOpen((v) => !v)}
              aria-label="More"
              aria-expanded={topMenuOpen}
            >
              <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
            </button>
            {topMenuOpen && (
              <>
                <div className="topbar-more-back" onClick={() => setTopMenuOpen(false)} />
                <div className="topbar-more-menu">
                  <button type="button" onClick={() => { setTopMenuOpen(false); setCmdkOpen(true) }}>Search</button>
                  <button type="button" onClick={() => { setTopMenuOpen(false); navigate('/notifications') }}>Notifications</button>
                  <button type="button" onClick={() => { setTopMenuOpen(false); handleRefresh() }} disabled={refreshing}>Refresh</button>
                  <div className="topbar-more-theme"><span>Theme</span><ThemeToggle /></div>
                  <button type="button" onClick={() => { setTopMenuOpen(false); navigate('/settings') }}>Profile &amp; settings</button>
                  <button type="button" className="danger" onClick={handleSignOut}>Log out</button>
                </div>
              </>
            )}
          </div>
        </div>
        <Fragment key={routeKey}>{children}</Fragment>
      </main>
      <CommandK open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </div>
  )
}
