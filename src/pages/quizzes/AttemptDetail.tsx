import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../components/AppSkeleton'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Exam } from '../../types/database'

interface AttemptDetailRow {
  id: string
  taker_name: string | null
  taker_email: string | null
  taker_whatsapp: string | null
  is_guest: boolean
  score_percent: number | null
  passed: boolean | null
  started_at: string
  submitted_at: string | null
  time_spent_seconds: number | null
  profile: { full_name: string; email: string | null } | null
}

interface AnswerRow {
  id: string
  selected_option_ids: string[]
  is_correct: boolean | null
  question: {
    id: string
    text: string
    order_index: number | null
    question_options: { id: string; text: string; is_correct: boolean }[]
  }
}

export default function AttemptDetail() {
  const { examId, attemptId } = useParams<{ examId: string; attemptId: string }>()
  const [exam, setExam] = useState<Exam | null>(null)
  const [attempt, setAttempt] = useState<AttemptDetailRow | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!examId || !attemptId) return
    let cancelled = false
    async function load() {
      const [{ data: examData }, { data: attemptData }, { data: answerData }] = await Promise.all([
        supabase.from('exams').select('*').eq('id', examId).single(),
        supabase
          .from('attempts')
          .select(
            'id, taker_name, taker_email, taker_whatsapp, is_guest, score_percent, passed, started_at, submitted_at, time_spent_seconds, profile:profiles(full_name, email)'
          )
          .eq('id', attemptId)
          .single(),
        supabase
          .from('attempt_answers')
          .select('id, selected_option_ids, is_correct, question:questions(id, text, order_index, question_options(id, text, is_correct))')
          .eq('attempt_id', attemptId),
      ])
      if (cancelled) return
      setExam(examData as Exam | null)
      setAttempt((attemptData as unknown as AttemptDetailRow) ?? null)
      const sorted = ((answerData as unknown as AnswerRow[]) ?? []).sort(
        (a, b) => (a.question.order_index ?? 0) - (b.question.order_index ?? 0)
      )
      setAnswers(sorted)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [examId, attemptId])

  if (loading) return <PageSkeleton />
  if (!exam || !attempt) return <div className="page"><p>Attempt not found.</p></div>

  const displayName = attempt.is_guest ? attempt.taker_name : attempt.profile?.full_name
  const displayEmail = attempt.is_guest ? attempt.taker_email : attempt.profile?.email
  const correctCount = answers.filter((a) => a.is_correct).length
  const minutes = attempt.time_spent_seconds ? Math.round(attempt.time_spent_seconds / 60) : null

  return (
    <div className="page">
      <div className="list-header">
        <div>
          <Link to={`/quizzes/${examId}/analytics`}>← Back to analytics</Link>
          <h1 style={{ marginTop: 8 }}>{displayName ?? 'Unknown'}</h1>
        </div>
        <span className={`badge ${attempt.passed ? 'passed' : 'failed'}`}>{attempt.passed ? 'Passed' : 'Failed'}</span>
      </div>

      <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 0 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">SCORE</span></div>
          <div className="kpi-value">{attempt.score_percent ?? '—'}%</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">CORRECT</span></div>
          <div className="kpi-value">{correctCount} / {answers.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TYPE</span></div>
          <div className="kpi-value" style={{ fontSize: 18 }}>{attempt.is_guest ? 'Guest' : 'Member'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TIME SPENT</span></div>
          <div className="kpi-value">{minutes !== null ? `${minutes}m` : '—'}</div>
        </div>
      </section>

      <div className="public-link-panel" style={{ marginTop: 20 }}>
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13.5 }}>
          {displayEmail && <>Email: <strong style={{ color: 'var(--text-h)' }}>{displayEmail}</strong> · </>}
          {attempt.is_guest && attempt.taker_whatsapp && <>WhatsApp: <strong style={{ color: 'var(--text-h)' }}>{attempt.taker_whatsapp}</strong> · </>}
          Started {new Date(attempt.started_at).toLocaleString()}
          {attempt.submitted_at && <> · Submitted {new Date(attempt.submitted_at).toLocaleString()}</>}
        </p>
      </div>

      <h2 style={{ marginTop: 28 }}>Answers</h2>
      {answers.map((a, idx) => {
        const selected = new Set(a.selected_option_ids)
        return (
          <div className="question-card" key={a.id}>
            <div className="list-header">
              <h2 style={{ margin: 0 }}>{idx + 1}. {a.question.text}</h2>
              <span className={`badge ${a.is_correct ? 'passed' : 'failed'}`}>{a.is_correct ? 'Correct' : 'Incorrect'}</span>
            </div>
            {a.question.question_options.map((opt) => {
              const wasSelected = selected.has(opt.id)
              const label = opt.is_correct ? ' (correct answer)' : wasSelected ? ' (their answer)' : ''
              return (
                <div
                  key={opt.id}
                  className={`exam-option ${wasSelected ? 'selected' : ''}`}
                  style={opt.is_correct ? { borderColor: 'var(--teal)' } : undefined}
                >
                  <input type="radio" checked={wasSelected} readOnly />
                  {opt.text}
                  {label && <span style={{ marginLeft: 8, fontSize: 12, color: opt.is_correct ? 'var(--teal)' : 'var(--text-faint)' }}>{label}</span>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
