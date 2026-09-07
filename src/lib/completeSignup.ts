import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { seedDefaultRanks } from './businessPath'

const UNIQUE_VIOLATION = '23505'

export interface RequestOfficeSignupInput {
  fullName: string
  officeName: string
  email: string
  password: string
}

export type RequestOfficeSignupResult =
  | { ok: true }
  | { ok: false; error: string; code?: 'already_confirmed' | 'email_failed' }

/**
 * Kicks off an office signup via the `office-signup` edge function, which
 * creates the account unconfirmed and sends a Bizzlivo-branded confirmation
 * email (not Supabase's default one). The org itself is still created on the
 * first login after confirming — see `completeOfficeSignup`.
 */
export async function requestOfficeSignup(
  input: RequestOfficeSignupInput,
): Promise<RequestOfficeSignupResult> {
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : undefined
  const { data, error } = await supabase.functions.invoke('office-signup', {
    body: { ...input, siteUrl },
  })

  if (error) {
    let message = 'We could not start your signup. Please try again.'
    // Non-2xx responses land here; the JSON body carries the real reason.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json()
        if (body?.error) message = String(body.error)
      } catch {
        /* keep the generic message */
      }
    }
    return { ok: false, error: message }
  }

  if (data?.ok) return { ok: true }
  return {
    ok: false,
    error: data?.error ?? 'Something went wrong. Please try again.',
    code: data?.code,
  }
}

/**
 * Creates the profile/organization/membership rows for a brand-new signup.
 *
 * Split out of the signup form's submit handler because it can't always run
 * there: when Supabase's "confirm email" setting is on (the project default),
 * `auth.signUp()` returns no session, so there's no authenticated client to
 * write with yet. `full_name`/`office_name` are stashed in the auth user's
 * metadata at signUp time and this runs later — on whatever first
 * authenticated load has no active membership yet. See AuthContext's
 * loadProfileAndMemberships.
 *
 * Idempotent/resumable by design: a dropped connection, closed tab, or
 * transient failure can interrupt this partway through (e.g. after the
 * profile insert but before the org or membership insert). AuthContext
 * retries this on every login until an active membership exists, so each
 * step here checks for already-completed work instead of assuming a clean
 * slate — otherwise a user could get permanently stranded with a profile
 * but no org.
 */
export async function completeOfficeSignup(user: User): Promise<string | null> {
  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim()
  const officeName = (user.user_metadata?.office_name as string | undefined)?.trim()
  if (!fullName || !officeName) return null

  const { data: existingMembership } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
  if (existingMembership && existingMembership.length > 0) return existingMembership[0].org_id

  const { error: profileError } = await supabase.from('profiles').insert({
    id: user.id,
    full_name: fullName,
    email: user.email,
  })
  if (profileError && profileError.code !== UNIQUE_VIOLATION) throw profileError

  // Org + admin membership are created by a single SECURITY DEFINER RPC
  // (0062) that holds a per-user advisory lock for the length of the
  // transaction. Doing it client-side — loop slug candidates, INSERT each
  // until one doesn't 23505 — let two concurrent runs for the same user
  // (re-opened confirmation link, two tabs, StrictMode double-invoke,
  // INITIAL_SESSION + SIGNED_IN back to back) each pass the "no membership
  // yet" check and each create an office, one as `acme` and the other as
  // `acme-2`. The RPC serializes them and returns the existing org id on
  // the second call. It's idempotent, so retrying on a later login is safe.
  const { data: orgId, error: orgError } = await supabase.rpc('create_office_for_signup', {
    p_office_name: officeName,
    p_full_name: fullName,
  })
  if (orgError) throw orgError
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Could not create your office. Please try signing in again.')
  }

  // Best-effort: attach this office's branded subdomain
  // (<slug>.bizzlivo.com) to the Vercel project so it gets its own cert
  // and routes to the app. Idempotent server-side, and a no-op when the
  // Vercel secrets aren't configured. Not fatal if it fails — the office
  // still works on the path-form login (/o/<slug>/login) and the
  // subdomain can be registered later.
  try {
    await supabase.functions.invoke('register-office-domain', { body: { orgId } })
  } catch {
    // ignored — see comment above
  }

  // Best-effort: a brand-new office gets a 30-day Growth-tier trial with no
  // card required. start_trial() is idempotent (a no-op if a subscription
  // row already exists), matching this function's own resumability — safe
  // to call every time completeOfficeSignup runs. Not fatal if it fails;
  // the org just starts unlocked-but-untracked until the RPC is retried on
  // a later login, after which the trial clock and the eventual lock apply.
  try {
    await supabase.rpc('start_trial', { target_org_id: orgId })
  } catch {
    // ignored — see comment above
  }

  // Best-effort: seed the standard Business Path ladder so the new office
  // has a journey from day one (existing offices were seeded by
  // 0035_business_path.sql). Idempotent — skipped if ranks already exist.
  try {
    await seedDefaultRanks(orgId)
  } catch {
    // ignored — an admin can build the journey manually from /business-path
  }

  return orgId
}
