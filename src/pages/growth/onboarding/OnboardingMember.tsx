import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { OnboardingProgress, OnboardingSettings, OnboardingStep, OnboardingStepItem } from '../../../types/database'

const SIGNED_URL_TTL_SECONDS = 3600

const STEP_ORDER: OnboardingStep[] = ['business_explanation', 'network_varsity', 'office_policy']
const STEP_LABEL: Record<OnboardingStep, string> = {
  business_explanation: 'Business Explanation',
  network_varsity: 'Network Varsity',
  office_policy: 'Office Policy',
}
const PROGRESS_FIELD: Record<OnboardingStep, keyof Omit<OnboardingProgress, 'org_id' | 'user_id'>> = {
  business_explanation: 'business_explanation_viewed_at',
  network_varsity: 'network_varsity_completed_at',
  office_policy: 'policy_acknowledged_at',
}

async function signedUrlFor(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from('onboarding').createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  return data?.signedUrl ?? null
}

export default function OnboardingMember() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [settings, setSettings] = useState<OnboardingSettings | null>(null)
  const [items, setItems] = useState<OnboardingStepItem[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [progress, setProgress] = useState<OnboardingProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(org: string, userId: string) {
    setLoading(true)
    const [settingsRes, itemsRes, progressRes] = await Promise.all([
      supabase.from('onboarding_settings').select('*').eq('org_id', org).maybeSingle(),
      supabase.from('onboarding_step_items').select('*').eq('org_id', org).order('order_index', { ascending: true }),
      supabase.from('onboarding_progress').select('*').eq('org_id', org).eq('user_id', userId).maybeSingle(),
    ])
    setSettings(settingsRes.data as OnboardingSettings | null)
    const itemRows = (itemsRes.data as OnboardingStepItem[]) ?? []
    setItems(itemRows)
    setProgress((progressRes.data as OnboardingProgress | null) ?? null)

    const fileItems = itemRows.filter((i) => i.file_path)
    const signedEntries = await Promise.all(fileItems.map(async (i) => [i.id, await signedUrlFor(i.file_path)] as const))
    setUrls(new Map(signedEntries.filter(([, url]) => url) as [string, string][]))
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId || !profile) return
    load(orgId, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, profile])

  async function markStep(field: keyof Omit<OnboardingProgress, 'org_id' | 'user_id'>) {
    if (!orgId || !profile) return
    setError(null)
    setBusy(true)
    const { data, error: upErr } = await supabase
      .from('onboarding_progress')
      .upsert({ org_id: orgId, user_id: profile.id, ...progress, [field]: new Date().toISOString() })
      .select()
      .single()
    setBusy(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setProgress(data as OnboardingProgress)
  }

  if (loading) return <p>Loading…</p>

  const businessDone = !!progress?.business_explanation_viewed_at
  const varsityDone = !!progress?.network_varsity_completed_at
  const policyDone = !!progress?.policy_acknowledged_at
  const registeredDone = !!progress?.registered_at

  const stepDone: Record<OnboardingStep, boolean> = {
    business_explanation: businessDone,
    network_varsity: varsityDone,
    office_policy: policyDone,
  }
  const stepAvailable: Record<OnboardingStep, boolean> = {
    business_explanation: true,
    network_varsity: businessDone,
    office_policy: varsityDone,
  }
  const registrationAvailable = policyDone

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Work through each step in order — the next one unlocks once you've completed the current one.
      </p>
      {error && <p className="form-error">{error}</p>}

      {STEP_ORDER.map((step, idx) => {
        const available = stepAvailable[step]
        const done = stepDone[step]
        const stepItems = items.filter((i) => i.step === step)
        const doneAt = progress?.[PROGRESS_FIELD[step]] ?? null

        return (
          <section key={step} className="growth-pillar" style={{ marginBottom: 16, opacity: available ? 1 : 0.55 }}>
            <div className="growth-pillar-head">
              <h2>{idx + 1}. {STEP_LABEL[step]}</h2>
              {done ? (
                <span className="badge active">Done {doneAt ? new Date(doneAt).toLocaleDateString() : ''}</span>
              ) : !available ? (
                <span className="badge">Locked</span>
              ) : null}
            </div>

            {!available ? (
              <p style={{ color: 'var(--text-faint)' }}>Complete the previous step to unlock this.</p>
            ) : stepItems.length === 0 ? (
              <p style={{ color: 'var(--text-faint)' }}>Your office admin hasn't added anything here yet.</p>
            ) : (
              <>
                {stepItems.map((item) =>
                  item.type === 'video' && urls.get(item.id) ? (
                    <div key={item.id} style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-faint)', marginBottom: 6 }}>{item.title}</p>
                      <video controls src={urls.get(item.id)} style={{ width: '100%', borderRadius: 10 }} />
                    </div>
                  ) : item.type === 'link' ? (
                    <p key={item.id}><a href={item.link_url!} target="_blank" rel="noreferrer">{item.title} →</a></p>
                  ) : urls.get(item.id) ? (
                    <p key={item.id}><a href={urls.get(item.id)} target="_blank" rel="noreferrer">{item.title} (PDF) →</a></p>
                  ) : null
                )}
                {!done && (
                  <button type="button" onClick={() => markStep(PROGRESS_FIELD[step])} disabled={busy} style={{ marginTop: 6 }}>
                    I've completed this step
                  </button>
                )}
              </>
            )}
          </section>
        )
      })}

      <section className="growth-pillar" style={{ opacity: registrationAvailable ? 1 : 0.55 }}>
        <div className="growth-pillar-head">
          <h2>4. Registration Link</h2>
          {registeredDone ? (
            <span className="badge active">Done {progress?.registered_at ? new Date(progress.registered_at).toLocaleDateString() : ''}</span>
          ) : !registrationAvailable ? (
            <span className="badge">Locked</span>
          ) : null}
        </div>

        {!registrationAvailable ? (
          <p style={{ color: 'var(--text-faint)' }}>Complete the previous step to unlock this.</p>
        ) : !settings?.registration_link ? (
          <p style={{ color: 'var(--text-faint)' }}>Your office admin hasn't added a registration link yet.</p>
        ) : (
          <>
            <p>
              <a href={settings.registration_link} target="_blank" rel="noreferrer" className="btn-primary-link">
                Go to registration →
              </a>
            </p>
            {!registeredDone && (
              <button type="button" onClick={() => markStep('registered_at')} disabled={busy} style={{ marginTop: 10 }}>
                I've completed registration
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
