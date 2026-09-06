import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../../components/AppSkeleton'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { Exam, QuestionStatus } from '../../../types/database'
import QuestionCard, { type QuestionWithOptions } from './QuestionCard'

type Filter = QuestionStatus | 'all'

export default function ReviewQuestions() {
  const { examId } = useParams<{ examId: string }>()
  const { profile } = useAuth()
  const [exam, setExam] = useState<Exam | null>(null)
  const [questions, setQuestions] = useState<QuestionWithOptions[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('pending_review')
  const [approvingAll, setApprovingAll] = useState(false)

  async function load() {
    if (!examId) return
    const [{ data: examData }, { data: questionData }] = await Promise.all([
      supabase.from('exams').select('*').eq('id', examId).single(),
      supabase
        .from('questions')
        .select('*, question_options(*)')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true }),
    ])
    setExam(examData as Exam | null)
    setQuestions((questionData as unknown as QuestionWithOptions[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  const counts = {
    pending_review: questions.filter((q) => q.status === 'pending_review').length,
    approved: questions.filter((q) => q.status === 'approved').length,
    rejected: questions.filter((q) => q.status === 'rejected').length,
  }
  const visible = filter === 'all' ? questions : questions.filter((q) => q.status === filter)

  async function approveAllPending() {
    if (!examId || counts.pending_review === 0) return
    if (!confirm(`Approve all ${counts.pending_review} pending question(s) as-is? You can still reject individual ones afterward.`)) return
    setApprovingAll(true)
    await supabase
      .from('questions')
      .update({ status: 'approved', reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
      .eq('exam_id', examId)
      .eq('status', 'pending_review')
    await load()
    setApprovingAll(false)
  }

  if (loading) return <PageSkeleton />
  if (!exam) return <div className="page"><p>Quiz not found.</p></div>

  return (
    <div className="page">
      <div className="list-header">
        <h1>Review — {exam.title}</h1>
        <Link to={`/quizzes/${examId}/settings`}>Settings & publish →</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['pending_review', 'approved', 'rejected', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            className={filter === f ? '' : 'secondary'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? `All (${questions.length})` : `${f.replace('_', ' ')} (${counts[f as QuestionStatus]})`}
          </button>
        ))}
        {counts.pending_review > 0 && (
          <button type="button" onClick={approveAllPending} disabled={approvingAll} style={{ marginLeft: 'auto' }}>
            {approvingAll ? 'Approving…' : `Approve all pending (${counts.pending_review})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p>No questions in this view.</p>
      ) : (
        visible.map((q) => (
          <QuestionCard key={q.id} question={q} onChanged={load} />
        ))
      )}
    </div>
  )
}
