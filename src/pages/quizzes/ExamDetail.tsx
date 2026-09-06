import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../components/AppSkeleton'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Exam } from '../../types/database'

interface QuestionCounts {
  pending_review: number
  approved: number
  rejected: number
}

export default function ExamDetail() {
  const { examId } = useParams<{ examId: string }>()
  const [exam, setExam] = useState<Exam | null>(null)
  const [counts, setCounts] = useState<QuestionCounts>({ pending_review: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [linkSaving, setLinkSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  async function load() {
    if (!examId) return
    const [{ data: examData }, { data: questionData }] = await Promise.all([
      supabase.from('exams').select('*').eq('id', examId).single(),
      supabase.from('questions').select('status').eq('exam_id', examId),
    ])
    setExam(examData as Exam | null)
    const next: QuestionCounts = { pending_review: 0, approved: 0, rejected: 0 }
    for (const q of (questionData as { status: keyof QuestionCounts }[]) ?? []) {
      next[q.status] += 1
    }
    setCounts(next)
    setLoading(false)
  }

  async function togglePublicLink() {
    if (!exam) return
    setLinkSaving(true)
    const { data } = await supabase
      .from('exams')
      .update({ public_link_enabled: !exam.public_link_enabled })
      .eq('id', exam.id)
      .select()
      .single()
    if (data) setExam(data as Exam)
    setLinkSaving(false)
  }

  async function regenerateLink() {
    if (!exam) return
    if (!confirm('Regenerating invalidates the current link — anyone who has it will no longer be able to use it. Continue?')) return
    setLinkSaving(true)
    const { data } = await supabase
      .from('exams')
      .update({ public_token: crypto.randomUUID() })
      .eq('id', exam.id)
      .select()
      .single()
    if (data) setExam(data as Exam)
    setLinkSaving(false)
  }

  function copyLink() {
    if (!exam) return
    navigator.clipboard.writeText(`${window.location.origin}/take/${exam.public_token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  if (loading) return <PageSkeleton />
  if (!exam) return <div className="page"><p>Quiz not found.</p></div>

  const totalQuestions = counts.pending_review + counts.approved + counts.rejected
  const gateClear = totalQuestions > 0 && counts.pending_review === 0

  return (
    <div className="page">
      <div className="list-header">
        <h1>{exam.title}</h1>
        <span className={`badge ${exam.status}`}>{exam.status}</span>
      </div>
      {exam.description && <p>{exam.description}</p>}

      <div className="card-grid">
        <Link to={`/quizzes/${exam.id}/generate`} className="card">
          <h2>Generate questions</h2>
          <p>Pick a batch size and let AI draft MCQs from the source PDF.</p>
        </Link>
        <Link to={`/quizzes/${exam.id}/review`} className="card">
          <h2>Review questions</h2>
          <p>
            {totalQuestions} total — {counts.pending_review} pending, {counts.approved} approved, {counts.rejected} rejected
          </p>
        </Link>
        <Link to={`/quizzes/${exam.id}/settings`} className="card">
          <h2>Settings & publish</h2>
          <p>{gateClear ? 'Ready to configure and publish.' : 'Approve/reject all questions to unlock publishing.'}</p>
        </Link>
      </div>

      {exam.status === 'published' && (
        <>
          <p style={{ marginTop: 24 }}>
            <Link to="/invites/assign" state={{ examId: exam.id, examTitle: exam.title }}>
              Assign this quiz to members →
            </Link>
            {' · '}
            <Link to={`/quizzes/${exam.id}/roster`}>Assignment roster →</Link>
            {' · '}
            <Link to={`/quizzes/${exam.id}/analytics`}>View analytics →</Link>
          </p>

          <div className="public-link-panel">
            <div className="toggle-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <label style={{ margin: 0 }}>
                <strong style={{ color: 'var(--text-h)' }}>Public quiz link</strong>
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-dim)' }}>
                  Anyone with the link can take this quiz — starting it registers them with your office right away.
                </span>
              </label>
              <input
                type="checkbox"
                checked={exam.public_link_enabled}
                onChange={togglePublicLink}
                disabled={linkSaving}
              />
            </div>

            {exam.public_link_enabled && (
              <div className="public-link-row">
                <code>{window.location.origin}/take/{exam.public_token}</code>
                <button type="button" className="secondary" onClick={copyLink}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button type="button" className="secondary" onClick={regenerateLink} disabled={linkSaving}>
                  Regenerate link
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
