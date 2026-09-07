import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { completeOfficeSignup } from './completeSignup'
import type { Membership, Organization, Profile } from '../types/database'

export interface MembershipWithOrg extends Membership {
  organization: Organization
}

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  memberships: MembershipWithOrg[]
  currentMembership: MembershipWithOrg | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  setCurrentOrgId: (orgId: string) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const CURRENT_ORG_KEY = 'bizzlivo.currentOrgId'
// One-time carry-over from the pre-rename key so the picked office persists.
try {
  const legacy = localStorage.getItem('hq360.currentOrgId')
  if (legacy && !localStorage.getItem(CURRENT_ORG_KEY)) localStorage.setItem(CURRENT_ORG_KEY, legacy)
} catch { /* ignore */ }

// Module-level (not component-level) on purpose: React StrictMode's dev-mode
// mount→unmount→remount cycle creates a *second* AuthProvider instance within
// the same page load, each with its own state/refs — a useRef-based guard
// would reset on that remount and fail to dedupe across it. Supabase also
// fires onAuthStateChange multiple times in quick succession right after a
// login (INITIAL_SESSION, SIGNED_IN, ...), on top of the initial refresh()
// call on mount. Without a guard that survives all of that, several
// concurrent loadProfileAndMemberships calls each see "no membership yet"
// and each run completeOfficeSignup, creating multiple duplicate orgs for
// the same user. Keyed by user id so overlapping calls for the same user,
// from any of these sources, share one in-flight attempt instead of racing.
const officeSignupInFlight = new Map<string, Promise<string | null>>()

function runCompleteOfficeSignup(user: User): Promise<string | null> {
  const existing = officeSignupInFlight.get(user.id)
  if (existing) return existing
  const attempt = completeOfficeSignup(user)
    .catch(() => null)
    .finally(() => {
      officeSignupInFlight.delete(user.id)
    })
  officeSignupInFlight.set(user.id, attempt)
  return attempt
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<MembershipWithOrg[]>([])
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(
    () => localStorage.getItem(CURRENT_ORG_KEY)
  )
  const [loading, setLoading] = useState(true)

  async function loadProfileAndMemberships(user: User) {
    let { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    let { data: membershipData } = await supabase
      .from('memberships')
      .select('*, organization:organizations(*)')
      .eq('user_id', user.id)
      .eq('status', 'active')

    // A brand-new office signup carries full_name/office_name in
    // user_metadata (see completeOfficeSignup). If no active membership
    // exists yet, either this is the first authenticated load after
    // confirming email, or an earlier attempt got interrupted partway
    // through (dropped connection, closed tab) — completeOfficeSignup is
    // idempotent and resumes from wherever it left off, so retrying here
    // on every login is safe and is what prevents a user getting
    // permanently stranded with a profile but no org.
    const isOfficeSignup = !!(user.user_metadata?.full_name && user.user_metadata?.office_name)
    if (isOfficeSignup && (!membershipData || membershipData.length === 0)) {
      const orgId = await runCompleteOfficeSignup(user)
      if (orgId) {
        const [{ data: created }, { data: refreshedMemberships }] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
          supabase.from('memberships').select('*, organization:organizations(*)').eq('user_id', user.id).eq('status', 'active'),
        ])
        profileData = created
        membershipData = refreshedMemberships
      }
    }

    setProfile(profileData as Profile | null)
    setMemberships((membershipData as unknown as MembershipWithOrg[]) ?? [])

    // Fire-and-forget: no pg_cron wired up, so a trial or a paid period that
    // lapsed is reconciled lazily here instead — on the next login/visit
    // rather than the instant it expires. Fine for a lapse measured in days.
    for (const m of (membershipData as unknown as MembershipWithOrg[]) ?? []) {
      supabase.rpc('sync_subscription_status', { target_org_id: m.org_id }).then(() => {})
    }

    // Also lazily nudge the transactional-email queue (no scheduler yet).
    // Small batch, best-effort — any queued mail gets a delivery attempt
    // on the next visit by any member.
    if ((membershipData as unknown[] | null)?.length) {
      supabase.functions.invoke('process-email-outbox', { body: { limit: 10 } }).catch(() => {})
    }
  }

  async function refresh() {
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
    if (data.session) {
      await loadProfileAndMemberships(data.session.user)
    } else {
      setProfile(null)
      setMemberships([])
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        await loadProfileAndMemberships(newSession.user)
      } else {
        setProfile(null)
        setMemberships([])
      }
      setLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  function setCurrentOrgId(orgId: string) {
    localStorage.setItem(CURRENT_ORG_KEY, orgId)
    setCurrentOrgIdState(orgId)
  }

  const currentMembership =
    memberships.find((m) => m.org_id === currentOrgId) ?? memberships[0] ?? null

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        memberships,
        currentMembership,
        loading,
        refresh,
        signOut,
        setCurrentOrgId,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
