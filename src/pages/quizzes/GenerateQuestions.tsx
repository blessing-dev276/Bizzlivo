import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useOrgUsage } from '../../lib/plans'
import type { Exam } from '../../types/database'

const QUICK_PICKS = [10, 20, 50]
const MAX_PER_BATCH = 100

interface PoolCounts {
  pending_review: number
  approved: number
  rejected: number
}

export default function GenerateQuestions() {
  const { examId } = useParams<{ examId: string }>()
  const { currentMembership } = useAuth()
  const { usage, refresh: refreshUsage } = useOrgUsage(currentMembership?.organization.id)
  const [exam, setExam] = useState<Exam | null>(null)
  const [counts, setCounts] = useState<PoolCounts>({ pending_review: 0, approved: 0, rejected: 0 })
  const [count, setCount] = useState(10)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function load() {
    if (!examId) return
    const [{ data: examData }, { data: questionData }] = await Promise.all([
      supabase.from('exams').select('*').eq('id', examId).single(),
      supabase.from('questions').select('status').eq('exam_id', examId),
    ])
    setExam(examData as Exam | null)
    const next: PoolCounts = { pending_review: 0, approved: 0, rejected: 0 }
    for (const q of (questionData as { status: keyof PoolCounts }[]) ?? []) {
      next[q.status] += 1
    }
    setCounts(next)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  async function handleGenerate() {
    if (!examId || !exam) return
    setError(null)
    setSuccess(null)

    if (!exam.resource_id) {
      setError('This quiz has no source resource. Attach one before generating questions.')
      return
    }
    if (!count || count < 1) {
      setError('Enter how many questions to generate.')
      return
    }

    setGenerating(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-questions', {
        body: { examId, resourceId: exam.resource_id, count },
      })
      if (fnError) {
        if (fnError instanceof FunctionsHttpError) {
          const body = await fnError.context.json().catch(() => null)
          throw new Error(body?.error ?? fnError.message)
        }
        throw fnError
      }
      if (data?.error) throw new Error(data.error)

      setSuccess(`Generated ${data.inserted} more questions — added to the pool below. Review them next.`)
      await Promise.all([load(), refreshUsage()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed. Please retry — no questions were dropped silently.')
    } finally {
      setGenerating(false)
    }
  }

  if (!exam) return <div className="page"><p>Loading…</p></div>

  const totalQuestions = counts.pending_review + counts.approved + counts.rejected

  return (
    <div className="page">
      <h1>Generate questions</h1>
      <p>{exam.title}</p>

      {totalQuestions > 0 && (
        <p style={{ color: 'var(--text-dim)' }}>
          This quiz already has {totalQuestions} question(s) — {counts.approved} approved, {counts.pending_review} pending review,{' '}
          {counts.rejected} rejected. Generating again adds more on top; it doesn't replace what's there.
        </p>
      )}

      <label style={{ maxWidth: 240 }}>
        How many questions?
        <input
          type="number"
          min={1}
          max={MAX_PER_BATCH}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(MAX_PER_BATCH, Number(e.target.value))))}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {QUICK_PICKS.map((n) => (
          <button key={n} type="button" className="secondary" onClick={() => setCount(n)}>
            {n}
          </button>
        ))}
      </div>

      {usage && (() => {
        const generationsLeft = Math.max(0, usage.ai_exam_generations_per_month - usage.ai_exam_generations_used)
        const questionsLeft = Math.max(0, usage.ai_questions_per_month - usage.ai_questions_used)
        const overBudget = generationsLeft === 0 || count > questionsLeft
        return (
          <p className={`limit-note ${overBudget ? 'attn' : ''}`} style={{ marginBottom: 16 }}>
            {generationsLeft} of {usage.ai_exam_generations_per_month} monthly AI generations left · {questionsLeft} of {usage.ai_questions_per_month} monthly AI questions left
            {overBudget && <> · <Link to="/billing">Upgrade for more →</Link></>}
          </p>
        )
      })()}

      {error && <p className="form-error">{error}</p>}
      {success && (
        <p className="form-info">
          {success} <Link to={`/quizzes/${examId}/review`}>Go to review →</Link>
        </p>
      )}

      <button
        onClick={handleGenerate}
        disabled={generating || (!!usage && (usage.ai_exam_generations_used >= usage.ai_exam_generations_per_month || count > usage.ai_questions_per_month - usage.ai_questions_used))}
      >
        {generating ? 'Generating with AI…' : `Generate ${count} question${count === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}
