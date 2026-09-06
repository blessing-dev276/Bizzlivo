import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'

// pdfjs is heavy — only pull it in when a member actually opens a PDF.
const PdfViewer = lazy(() => import('../../../components/PdfViewer'))
import type {
  Attempt,
  Exam,
  OnboardingItemProgress,
  OnboardingModule,
  OnboardingProgress,
  OnboardingSettings,
  OnboardingStepItem,
} from '../../../types/database'

const SIGNED_URL_TTL_SECONDS = 3600

const TYPE_LABEL: Record<OnboardingStepItem['type'], string> = {
  video: 'Video',
  pdf: 'PDF',
  link: 'Link',
  quiz: 'Quiz',
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
  const [modules, setModules] = useState<OnboardingModule[]>([])
  const [items, setItems] = useState<OnboardingStepItem[]>([])
  const [progress, setProgress] = useState<OnboardingProgress | null>(null)
  const [itemProgress, setItemProgress] = useState<OnboardingItemProgress[]>([])
  const [examById, setExamById] = useState<Map<string, Exam>>(new Map())
  const [attempts, setAttempts] = useState<Attempt[]>([])

  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (org: string, userId: string) => {
    setLoading(true)
    const [settingsRes, modsRes, progressRes, itemProgressRes] = await Promise.all([
      supabase.from('onboarding_settings').select('*').eq('org_id', org).maybeSingle(),
      supabase.from('onboarding_modules').select('*').eq('org_id', org).eq('status', 'published').order('order_index', { ascending: true }),
      supabase.from('onboarding_progress').select('*').eq('org_id', org).eq('user_id', userId).maybeSingle(),
      supabase.from('onboarding_item_progress').select('*').eq('org_id', org).eq('user_id', userId),
    ])
    setSettings(settingsRes.data as OnboardingSettings | null)
    const modRows = (modsRes.data as OnboardingModule[]) ?? []
    setModules(modRows)
    setProgress((progressRes.data as OnboardingProgress | null) ?? null)
    setItemProgress((itemProgressRes.data as OnboardingItemProgress[]) ?? [])

    const modIds = modRows.map((m) => m.id)
    const itemRows = modIds.length
      ? (((await supabase.from('onboarding_step_items').select('*').in('module_id', modIds).order('order_index', { ascending: true })).data) as OnboardingStepItem[]) ?? []
      : []
    setItems(itemRows)

    const quizExamIds = itemRows.filter((i) => i.type === 'quiz' && i.exam_id).map((i) => i.exam_id as string)
    if (quizExamIds.length > 0) {
      const [examRes, attemptRes] = await Promise.all([
        supabase.from('exams').select('*').in('id', quizExamIds),
        supabase.from('attempts').select('*').eq('user_id', userId).in('exam_id', quizExamIds),
      ])
      setExamById(new Map(((examRes.data as Exam[]) ?? []).map((e) => [e.id, e])))
      setAttempts((attemptRes.data as Attempt[]) ?? [])
    } else {
      setExamById(new Map())
      setAttempts([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!orgId || !profile) return
    load(orgId, profile.id)
  }, [orgId, profile, load])

  const doneItemIds = useMemo(() => new Set(itemProgress.map((p) => p.item_id)), [itemProgress])

  const isItemComplete = useCallback((item: OnboardingStepItem): boolean => {
    if (item.type === 'quiz') {
      return attempts.some((a) => a.exam_id === item.exam_id && a.status === 'submitted' && a.passed)
    }
    return doneItemIds.has(item.id)
  }, [attempts, doneItemIds])

  // Items flattened into the exact order the admin arranged them: modules by
  // order_index, then items by order_index within each module.
  const orderedItems = useMemo(() => {
    const byMod = new Map<string, OnboardingStepItem[]>()
    for (const it of items) {
      const list = byMod.get(it.module_id ?? '') ?? []
      list.push(it)
      byMod.set(it.module_id ?? '', list)
    }
    return modules.flatMap((m) =>
      (byMod.get(m.id) ?? []).slice().sort((a, b) => a.order_index - b.order_index),
    )
  }, [modules, items])

  // Sequential unlock: an item is available only once every item before it in
  // the arranged order is complete. The first incomplete item is the current one.
  const firstIncompleteIdx = useMemo(() => {
    const i = orderedItems.findIndex((it) => !isItemComplete(it))
    return i === -1 ? orderedItems.length : i
  }, [orderedItems, isItemComplete])

  const itemUnlockedById = useMemo(() => {
    const map = new Map<string, boolean>()
    orderedItems.forEach((it, idx) => map.set(it.id, idx <= firstIncompleteIdx))
    return map
  }, [orderedItems, firstIncompleteIdx])

  const allItemsComplete = orderedItems.length > 0 && firstIncompleteIdx >= orderedItems.length

  async function ensureUrl(item: OnboardingStepItem) {
    if (urls.has(item.id) || !item.file_path) return
    const url = await signedUrlFor(item.file_path)
    if (url) setUrls((prev) => new Map(prev).set(item.id, url))
  }

  async function openItem(item: OnboardingStepItem) {
    if (!itemUnlockedById.get(item.id)) return
    setOpenIds((prev) => new Set(prev).add(item.id))
    await ensureUrl(item)
    // Opening a link is all we can verify for an external page.
    if (item.type === 'link' && !isItemComplete(item)) markItemDone(item)
  }

  function closeItem(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function markItemDone(item: OnboardingStepItem) {
    if (!orgId || !profile || isItemComplete(item)) return
    if (!itemUnlockedById.get(item.id)) return
    setBusy(true)
    setError(null)
    const { data, error: insErr } = await supabase
      .from('onboarding_item_progress')
      .upsert(
        { org_id: orgId, item_id: item.id, user_id: profile.id, completed_at: new Date().toISOString() },
        { onConflict: 'item_id,user_id' },
      )
      .select()
      .single()
    setBusy(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    if (data) setItemProgress((prev) => [...prev.filter((p) => p.item_id !== item.id), data as OnboardingItemProgress])
  }

  async function markRegistration() {
    if (!orgId || !profile) return
    setBusy(true)
    setError(null)
    const { data, error: upErr } = await supabase
      .from('onboarding_progress')
      .upsert({ org_id: orgId, user_id: profile.id, ...progress, registered_at: new Date().toISOString() })
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

  const registeredDone = !!progress?.registered_at
  const registrationAvailable = allItemsComplete

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Work through onboarding in order. Each item opens once you've finished the one before it — watch every
        video to the end, read every PDF, open every link, and pass every quiz.
      </p>
      {error && <p className="form-error">{error}</p>}

      {modules.length === 0 && (
        <p style={{ color: 'var(--text-faint)' }}>Your office admin hasn't published any onboarding content yet.</p>
      )}

      {modules.map((mod, mIdx) => {
        const modItems = orderedItems.filter((i) => i.module_id === mod.id)
        const completedCount = modItems.filter(isItemComplete).length
        const modDone = modItems.length > 0 && completedCount === modItems.length

        return (
          <section key={mod.id} className="growth-pillar" style={{ marginBottom: 16 }}>
            <div className="growth-pillar-head">
              <h2>{mIdx + 1}. {mod.title}</h2>
              {modItems.length === 0 ? null : modDone ? (
                <span className="badge active">Done ✓</span>
              ) : (
                <span className="badge">{completedCount} / {modItems.length}</span>
              )}
            </div>
            {mod.description && <p style={{ color: 'var(--text-dim)', marginTop: -4, marginBottom: 10 }}>{mod.description}</p>}

            {modItems.length === 0 ? (
              <p style={{ color: 'var(--text-faint)' }}>Nothing added here yet.</p>
            ) : (
              modItems.map((item) => {
                const myIdx = orderedItems.indexOf(item)
                const unlocked = myIdx <= firstIncompleteIdx
                const isCurrent = myIdx === firstIncompleteIdx
                const isOpen = openIds.has(item.id)
                const itemDone = isItemComplete(item)
                const url = urls.get(item.id) ?? null
                const exam = item.exam_id ? examById.get(item.exam_id) : null

                return (
                  <div className="ob-item" key={item.id} style={{ opacity: unlocked ? 1 : 0.5 }}>
                    <div className="ob-item-head">
                      <span className="ob-item-title">
                        <span className="badge">{TYPE_LABEL[item.type]}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {itemDone && <span className="badge active">Done ✓</span>}
                        {!unlocked && <span className="badge">🔒 Locked</span>}
                        {unlocked && !itemDone && item.type === 'quiz' ? (
                          !exam ? (
                            <span className="badge">unavailable</span>
                          ) : !exam.public_link_enabled ? (
                            <span className="badge">not open yet</span>
                          ) : (
                            <Link to={`/take/${exam.public_token}`}>
                              <button type="button">Take quiz →</button>
                            </Link>
                          )
                        ) : unlocked && item.type !== 'quiz' ? (
                          isOpen ? (
                            <button type="button" className="secondary" onClick={() => closeItem(item.id)}>Close</button>
                          ) : (
                            <button type="button" onClick={() => openItem(item)}>
                              {item.type === 'video' ? 'Play' : item.type === 'pdf' ? 'Read' : 'Open'}
                            </button>
                          )
                        ) : null}
                      </span>
                    </div>

                    {!unlocked && !isCurrent && (
                      <p style={{ color: 'var(--text-faint)', margin: '4px 0 0', fontSize: 13 }}>
                        Complete the previous item to unlock this.
                      </p>
                    )}

                    {isOpen && unlocked && item.type !== 'quiz' && (
                      <div className="ob-item-body">
                        {item.type === 'video' &&
                          (url ? (
                            <video controls autoPlay src={url} className="content-frame" onEnded={() => markItemDone(item)} />
                          ) : (
                            <p style={{ color: 'var(--text-faint)' }}>Loading video…</p>
                          ))}

                        {item.type === 'pdf' &&
                          (url ? (
                            <Suspense fallback={<p style={{ color: 'var(--text-faint)' }}>Loading PDF…</p>}>
                              <PdfViewer url={url} onReachedEnd={() => markItemDone(item)} />
                            </Suspense>
                          ) : (
                            <p style={{ color: 'var(--text-faint)' }}>Loading PDF…</p>
                          ))}

                        {item.type === 'link' && (
                          <>
                            <iframe
                              src={item.link_url ?? undefined}
                              title={item.title}
                              className="content-frame content-frame-doc"
                              style={{ height: 460 }}
                            />
                            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
                              Some sites block embedding. If it stays blank,{' '}
                              <a href={item.link_url ?? '#'} target="_blank" rel="noreferrer">open it in a new tab</a>.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </section>
        )
      })}

      <section className="growth-pillar" style={{ opacity: registrationAvailable ? 1 : 0.55 }}>
        <div className="growth-pillar-head">
          <h2>{modules.length + 1}. Registration Link</h2>
          {registeredDone ? (
            <span className="badge active">Done {progress?.registered_at ? new Date(progress.registered_at).toLocaleDateString() : ''}</span>
          ) : !registrationAvailable ? (
            <span className="badge">Locked</span>
          ) : null}
        </div>

        {!registrationAvailable ? (
          <p style={{ color: 'var(--text-faint)' }}>Complete every onboarding item to unlock this.</p>
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
              <button type="button" onClick={markRegistration} disabled={busy} style={{ marginTop: 10 }}>
                I've completed registration
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
