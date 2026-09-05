import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { slugCandidates } from './slug'

const UNIQUE_VIOLATION = '23505'

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

  // Org id is generated client-side (not read back via `.select()` after
  // insert): the organizations SELECT policy requires org membership, which
  // doesn't exist yet at the instant of insert. See slugCandidates() for why
  // a pre-insert "does this slug exist" check can't substitute for this.
  const orgId = crypto.randomUUID()
  let created = false
  let lastMessage = 'Could not find an available office slug.'

  for (const slug of slugCandidates(officeName)) {
    const { error: orgError } = await supabase.from('organizations').insert({ id: orgId, name: officeName, slug })
    if (!orgError) {
      created = true
      break
    }
    if (orgError.code !== UNIQUE_VIOLATION) throw orgError
    lastMessage = orgError.message
  }
  if (!created) throw new Error(lastMessage)

  const { error: membershipError } = await supabase.from('memberships').insert({
    org_id: orgId,
    user_id: user.id,
    role: 'admin',
    status: 'active',
  })
  if (membershipError) throw membershipError

  // Best-effort: a brand-new office gets a 14-day Growth-tier trial with no
  // card required. start_trial() is idempotent (a no-op if a subscription
  // row already exists), matching this function's own resumability — safe
  // to call every time completeOfficeSignup runs. Not fatal if it fails;
  // the org just starts on Free instead of trialing, which the RPC can
  // reasonably be retried on a later login.
  try {
    await supabase.rpc('start_trial', { target_org_id: orgId })
  } catch {
    // ignored — see comment above
  }

  return orgId
}
