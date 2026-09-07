import { useEffect, useMemo, useState } from 'react'
import { PageSkeleton } from '../../../components/AppSkeleton'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import { KIND_ICON } from '../../../lib/resourceKind'
import { notifyUsers } from '../../../lib/notifications'
import { moduleLock, startClass, unlockLabel } from '../../../lib/learningCenter'
import type {
  Attempt,
  ClassItemProgress,
  ClassModule,
  ClassModuleItem,
  ClassModuleItemType,
  ClassTrainer,
  CourseworkSubmission,
  Exam,
  Resource,
  SkillClass,
} from '../../../types/database'

interface TrainerProfile {
  id: string
  full_name: string
  avatar_url: string | null
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0]?.toUpperCase() || '?'
}

const TYPE_LABEL: Record<ClassModuleItemType, string> = {
  video: 'Video',
  pdf: 'PDF',
  podcast: 'Podcast',
  link: 'Link',
  article: 'Article',
  test: 'Quiz',
  quiz: 'Quiz',
  assignment: 'Assignment',
}

const SIGNED_URL_TTL_SECONDS = 3600

export default function ClassPlayer() {
  const { classId } = useParams<{ classId: string }>()
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [classInfo, setClassInfo] = useState<SkillClass | null>(null)
  const [modules, setModules] = useState<ClassModule[]>([])
  const [items, setItems] = useState<ClassModuleItem[]>([])
  const [examById, setExamById] = useState<Map<string, Exam>>(new Map())
  const [progress, setProgress] = useState<ClassItemProgress[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [submissions, setSubmissions] = useState<CourseworkSubmission[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [openBody, setOpenBody] = useState<string | null>(null)
  const [startedOn, setStartedOn] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [trainers, setTrainers] = useState<(ClassTrainer & { profile: TrainerProfile | null })[]>([])
  const [askingTrainerId, setAskingTrainerId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [sendingQuestion, setSendingQuestion] = useState(false)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())

  async function load() {
    if (!classId || !profile) return
    setLoading(true)

    const { data: classData } = await supabase.from('classes').select('*').eq('id', classId).single()
    if (!classData) {
      setClassInfo(null)
      setLoading(false)
      return
    }
    setClassInfo(classData as SkillClass)

    const { data: moduleData } = await supabase.from('class_modules').select('*').eq('class_id', classId).order('order_index', { ascending: true })
    const moduleRows = (moduleData as ClassModule[]) ?? []
    setModules(moduleRows)

    // Opening a drip-fed section is what starts the member's "Day 1".
    if ((classData as SkillClass).drip_enabled) {
      setStartedOn(await startClass(classId))
    }

    const { data: trainerData } = await supabase
      .from('class_trainers')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .eq('class_id', classId)
    setTrainers((trainerData as unknown as (ClassTrainer & { profile: TrainerProfile | null })[]) ?? [])

    const moduleIds = moduleRows.map((m) => m.id)
    const { data: itemData } =
      moduleIds.length > 0
        ? await supabase.from('class_module_items').select('*').in('module_id', moduleIds).order('order_index', { ascending: true })
        : { data: [] as ClassModuleItem[] }
    const itemRows = (itemData as ClassModuleItem[]) ?? []
    setItems(itemRows)

    const resourceIds = itemRows.filter((i) => i.resource_id).map((i) => i.resource_id!)
    const examIds = itemRows.filter((i) => i.exam_id).map((i) => i.exam_id!)
    const assignmentIds = itemRows.filter((i) => i.coursework_assignment_id).map((i) => i.coursework_assignment_id!)
    const itemIds = itemRows.map((i) => i.id)

    const [resourcesRes, examsRes, progressRes, attemptsRes, submissionsRes] = await Promise.all([
      resourceIds.length > 0 ? supabase.from('resources').select('*').in('id', resourceIds) : Promise.resolve({ data: [] as Resource[] }),
      examIds.length > 0 ? supabase.from('exams').select('*').in('id', examIds) : Promise.resolve({ data: [] as Exam[] }),
      itemIds.length > 0
        ? supabase.from('class_item_progress').select('*').in('item_id', itemIds).eq('user_id', profile.id)
        : Promise.resolve({ data: [] as ClassItemProgress[] }),
      examIds.length > 0
        ? supabase.from('attempts').select('*').in('exam_id', examIds).eq('user_id', profile.id)
        : Promise.resolve({ data: [] as Attempt[] }),
      assignmentIds.length > 0
        ? supabase.from('coursework_submissions').select('*').in('assignment_id', assignmentIds).eq('user_id', profile.id)
        : Promise.resolve({ data: [] as CourseworkSubmission[] }),
    ])

    setExamById(new Map(((examsRes.data as Exam[] | null) ?? []).map((e) => [e.id, e])))
    setProgress((progressRes.data as ClassItemProgress[]) ?? [])
    setAttempts((attemptsRes.data as Attempt[]) ?? [])
    setSubmissions((submissionsRes.data as CourseworkSubmission[]) ?? [])

    const pdfResources = ((resourcesRes.data as Resource[] | null) ?? []).filter((r) => r.file_type === 'pdf')
    const signedEntries = await Promise.all(
      pdfResources.map(async (r) => {
        const { data } = await supabase.storage.from('resources').createSignedUrl(r.file_url, SIGNED_URL_TTL_SECONDS)
        return [r.id, data?.signedUrl ?? null] as const
      })
    )
    const urlMap = new Map<string, string>()
    for (const r of (resourcesRes.data as Resource[] | null) ?? []) {
      if (r.file_type !== 'pdf') urlMap.set(r.id, r.file_url)
    }
    for (const [id, url] of signedEntries) if (url) urlMap.set(id, url)
    setUrls(urlMap)

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, profile?.id])

  const itemsByModule = useMemo(() => {
    const map = new Map<string, ClassModuleItem[]>()
    for (const item of items) {
      if (!map.has(item.module_id)) map.set(item.module_id, [])
      map.get(item.module_id)!.push(item)
    }
    return map
  }, [items])

  const doneItemIds = useMemo(() => new Set(progress.map((p) => p.item_id)), [progress])

  function isItemComplete(item: ClassModuleItem): boolean {
    if (item.type === 'video' || item.type === 'pdf' || item.type === 'article' || item.type === 'podcast' || item.type === 'link') {
      return doneItemIds.has(item.id)
    }
    if (item.type === 'test' || item.type === 'quiz') {
      return attempts.some((a) => a.exam_id === item.exam_id && a.status === 'submitted' && a.passed)
    }
    return submissions.some((s) => s.assignment_id === item.coursework_assignment_id && s.status === 'approved')
  }

  const totalDone = items.filter(isItemComplete).length

  async function markDone(item: ClassModuleItem) {
    if (!orgId || !profile) return
    setBusyId(item.id)
    setError(null)
    const { data, error: insertError } = await supabase
      .from('class_item_progress')
      .insert({ item_id: item.id, org_id: orgId, user_id: profile.id, status: 'completed', completed_at: new Date().toISOString() })
      .select()
      .single()
    setBusyId(null)
    if (insertError) setError(insertError.message)
    else setProgress((prev) => [...prev, data as ClassItemProgress])
  }

  async function undo(item: ClassModuleItem) {
    if (!profile) return
    setBusyId(item.id)
    setError(null)
    const { error: deleteError } = await supabase.from('class_item_progress').delete().eq('item_id', item.id).eq('user_id', profile.id)
    setBusyId(null)
    if (deleteError) setError(deleteError.message)
    else setProgress((prev) => prev.filter((p) => p.item_id !== item.id))
  }

  async function sendQuestion(trainerUserId: string) {
    if (!orgId || !profile || !classInfo || !question.trim()) return
    setSendingQuestion(true)
    setError(null)
    try {
      await notifyUsers(orgId, [trainerUserId], 'trainer_question', {
        text: `${profile.full_name} asked about "${classInfo.title}": ${question.trim()}`,
        link: `/training/classes/${classInfo.id}`,
      })
      setSentTo((prev) => new Set(prev).add(trainerUserId))
      setAskingTrainerId(null)
      setQuestion('')
    } catch {
      setError('Could not send your question. Try again.')
    } finally {
      setSendingQuestion(false)
    }
  }

  if (loading) return <PageSkeleton />
  if (!classInfo) return <div className="page"><p>Class not found.</p></div>

  return (
    <div className="page">
      <h1>{classInfo.title}</h1>
      {classInfo.description && <p style={{ color: 'var(--text-dim)' }}>{classInfo.description}</p>}
      {items.length > 0 && (
        <span className="badge active" style={{ marginTop: 8, display: 'inline-block' }}>{totalDone} of {items.length} complete</span>
      )}

      {error && <p className="form-error">{error}</p>}

      {trainers.length > 0 && (
        <div className="res-card" style={{ marginTop: 16 }}>
          <div className="res-title-block"><h3>Meet your trainer{trainers.length > 1 ? 's' : ''}</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 }}>
            {trainers.map((t) => (
              <div key={t.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t.profile?.avatar_url ? (
                    <img className="avatar" src={t.profile.avatar_url} alt="" style={{ width: 36, height: 36 }} />
                  ) : (
                    <div className="avatar" style={{ width: 36, height: 36 }}>{initials(t.profile?.full_name ?? '?')}</div>
                  )}
                  <span style={{ fontWeight: 600 }}>{t.profile?.full_name ?? 'Unknown'}</span>
                  {sentTo.has(t.user_id) ? (
                    <span className="badge active">Question sent ✓</span>
                  ) : askingTrainerId === t.id ? null : (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setAskingTrainerId(t.id)
                        setQuestion('')
                        setError(null)
                      }}
                    >
                      Ask a question
                    </button>
                  )}
                </div>
                {askingTrainerId === t.id && (
                  <div style={{ marginTop: 8, marginLeft: 46, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder={`Ask ${t.profile?.full_name ?? 'your trainer'} something about this class…`}
                      style={{ flex: 1 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button type="button" onClick={() => sendQuestion(t.user_id)} disabled={sendingQuestion || !question.trim()}>
                        {sendingQuestion ? 'Sending…' : 'Send'}
                      </button>
                      <button type="button" className="secondary" onClick={() => setAskingTrainerId(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {modules.length === 0 ? (
          <p className="empty-row">This class doesn't have any modules yet.</p>
        ) : (
          modules.map((mod) => {
            const lock = moduleLock(!!classInfo.drip_enabled, mod.drip_day, startedOn)
            return (
            <div className={`res-card ${lock.locked ? 'is-locked' : ''}`} key={mod.id} style={{ marginBottom: 14 }}>
              <div className="res-title-block" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3>{mod.title}</h3>
                {lock.locked && <span className="badge">🔒 {unlockLabel(lock)}</span>}
              </div>

              {lock.locked ? (
                <p className="empty-row" style={{ marginTop: 10 }}>
                  {lock.unlocksOn
                    ? `This module opens on ${new Date(lock.unlocksOn + 'T00:00:00Z').toLocaleDateString()}. Keep going with what's already unlocked.`
                    : 'This module unlocks on a later day of the path.'}
                </p>
              ) : (
              <div style={{ marginTop: 10 }}>
                {(itemsByModule.get(mod.id) ?? []).length === 0 ? (
                  <p className="empty-row">Nothing in this module yet.</p>
                ) : (
                  (itemsByModule.get(mod.id) ?? []).map((item) => {
                    const done = isItemComplete(item)
                    return (
                      <div className="res-card" key={item.id} style={{ marginBottom: 8 }}>
                        <div className="res-top">
                          <div className="res-left">
                            <div className="res-icon">
                              {item.type === 'video' || item.type === 'pdf' ? KIND_ICON[item.type] : null}
                            </div>
                            <div className="res-title-block">
                              <h3>{item.title}</h3>
                              <span className="badge">{TYPE_LABEL[item.type]}</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {(item.type === 'video' || item.type === 'pdf' || item.type === 'podcast' || item.type === 'link') && (
                              <>
                                {(item.type === 'link' ? item.link_url : urls.get(item.resource_id ?? '')) && (
                                  <a href={item.type === 'link' ? item.link_url! : urls.get(item.resource_id!)} target="_blank" rel="noreferrer">Open →</a>
                                )}
                                {done ? (
                                  <>
                                    <span className="badge active">Done ✓</span>
                                    <button type="button" className="secondary" onClick={() => undo(item)} disabled={busyId === item.id}>Undo</button>
                                  </>
                                ) : (
                                  <button type="button" onClick={() => markDone(item)} disabled={busyId === item.id}>Mark done</button>
                                )}
                              </>
                            )}

                            {item.type === 'article' && (
                              <>
                                <button type="button" className="secondary" onClick={() => setOpenBody(openBody === item.id ? null : item.id)}>
                                  {openBody === item.id ? 'Hide' : 'Read'}
                                </button>
                                {done ? (
                                  <>
                                    <span className="badge active">Done ✓</span>
                                    <button type="button" className="secondary" onClick={() => undo(item)} disabled={busyId === item.id}>Undo</button>
                                  </>
                                ) : (
                                  <button type="button" onClick={() => markDone(item)} disabled={busyId === item.id}>Mark done</button>
                                )}
                              </>
                            )}

                            {(item.type === 'test' || item.type === 'quiz') && (() => {
                              const exam = item.exam_id ? examById.get(item.exam_id) : null
                              if (!exam) return <span className="badge">unavailable</span>
                              if (done) return <span className="badge active">Passed ✓</span>
                              if (!exam.public_link_enabled) return <span className="badge">not open yet</span>
                              return <Link to={`/take/${exam.public_token}`}><button type="button">Take {TYPE_LABEL[item.type].toLowerCase()} →</button></Link>
                            })()}

                            {item.type === 'assignment' && (() => {
                              const submission = submissions.find((s) => s.assignment_id === item.coursework_assignment_id)
                              return (
                                <>
                                  {submission && <span className={`badge ${submission.status}`}>{submission.status.replace('_', ' ')}</span>}
                                  <Link to={`/my-assignments/${item.coursework_assignment_id}`}>
                                    <button type="button" className="secondary">{submission ? 'View →' : 'Submit →'}</button>
                                  </Link>
                                </>
                              )
                            })()}
                          </div>
                        </div>

                        {item.type === 'article' && openBody === item.id && (
                          <p style={{ whiteSpace: 'pre-wrap', marginTop: 12, background: 'var(--line-soft)', padding: 12, borderRadius: 8 }}>
                            {item.body}
                          </p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
              )}
            </div>
            )
          })
        )}
      </div>
    </div>
  )
}
