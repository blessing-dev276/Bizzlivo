import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { shuffle } from '../../lib/shuffle'
import { getEffectiveStatus, healUserAttempts, type EffectiveStatus } from '../../lib/examLifecycle'
import type { Attempt, ExamAssignment, ExamSettings, Question, QuestionOption } from '../../types/database'

interface AnswerRow {
  id: string
  question: Question & { question_options: QuestionOption[] }
  selected_option_ids: string[]
}

export default function TakeExam() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<{ status: EffectiveStatus; when: string | null } | null>(null)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [settings, setSettings] = useState<ExamSettings | null>(null)
  const [examTitle, setExamTitle] = useState('')
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const submit = useCallback(async () => {
    if (submittingRef.current || !attempt) return
    submittingRef.current = true
    setSubmitting(true)

    let correctCount = 0
    for (const answer of answers) {
      const correctOptionIds = new Set(answer.question.question_options.filter((o) => o.is_correct).map((o) => o.id))
      const isCorrect =
        answer.selected_option_ids.length > 0 &&
        answer.selected_option_ids.every((id) => correctOptionIds.has(id)) &&
        answer.selected_option_ids.length === correctOptionIds.size
      if (isCorrect) correctCount += 1
      await supabase.from('attempt_answers').update({ is_correct: isCorrect }).eq('id', answer.id)
    }

    const scorePercent = answers.length > 0 ? Math.round((correctCount / answers.length) * 10000) / 100 : 0
    const passed = scorePercent >= (settings?.pass_mark_percent ?? 70)
    const timeSpent = Math.round((Date.now() - new Date(attempt.started_at).getTime()) / 1000)

    await supabase
      .from('attempts')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        score_percent: scorePercent,
        passed,
        time_spent_seconds: timeSpent,
      })
      .eq('id', attempt.id)

    navigate(`/my-quizzes/attempts/${attempt.id}/result`)
  }, [answers, attempt, settings, navigate])

  useEffect(() => {
    if (!assignmentId || !profile) return
    let cancelled = false

    async function init() {
      const { data: assignment, error: assignmentError } = await supabase
        .from('exam_assignments')
        .select('*, exam:exams(*)')
        .eq('id', assignmentId)
        .single()
      if (assignmentError || !assignment) {
        setError('Assignment not found.')
        setLoading(false)
        return
      }
      const typedAssignment = assignment as unknown as ExamAssignment & { exam: { id: string; title: string } }
      const examId = typedAssignment.exam.id

      const { data: settingsData } = await supabase.from('exam_settings').select('*').eq('exam_id', examId).single()
      if (!settingsData) {
        setError('This quiz has no settings configured yet.')
        setLoading(false)
        return
      }

      // Reconcile any stale in-progress/missed state before reading — this
      // is what makes an abandoned attempt or a closed scheduling window
      // show up as failed instead of silently stuck.
      await healUserAttempts(typedAssignment.org_id, profile!.id)

      const { data: allAttempts } = await supabase
        .from('attempts')
        .select('*')
        .eq('exam_id', examId)
        .eq('user_id', profile!.id)
      const attemptsForExam = (allAttempts as Attempt[]) ?? []

      const effective = getEffectiveStatus(
        { starts_at: typedAssignment.starts_at, ends_at: typedAssignment.ends_at },
        attemptsForExam
      )
      if (effective.status === 'too_early') {
        setBlocked({ status: 'too_early', when: typedAssignment.starts_at })
        setLoading(false)
        return
      }
      if (effective.status === 'missed') {
        setBlocked({ status: 'missed', when: typedAssignment.ends_at })
        setLoading(false)
        return
      }

      let currentAttempt = attemptsForExam.find((a) => a.status === 'in_progress') ?? null

      if (!currentAttempt) {
        const pastAttempts = attemptsForExam.length

        if (settingsData.max_attempts !== 0 && pastAttempts >= settingsData.max_attempts) {
          setError("You've used all your attempts for this quiz.")
          setLoading(false)
          return
        }

        const { data: pool } = await supabase
          .from('questions')
          .select('*, question_options(*)')
          .eq('exam_id', examId)
          .eq('status', 'approved')

        let selected = (pool as (Question & { question_options: QuestionOption[] })[]) ?? []
        if (selected.length === 0) {
          setError('This quiz has no approved questions yet.')
          setLoading(false)
          return
        }
        if (settingsData.shuffle_questions) selected = shuffle(selected)
        selected = selected.slice(0, settingsData.num_questions)

        const { data: newAttempt, error: attemptError } = await supabase
          .from('attempts')
          .insert({
            org_id: typedAssignment.org_id,
            exam_id: examId,
            user_id: profile!.id,
            attempt_number: pastAttempts + 1,
            status: 'in_progress',
          })
          .select()
          .single()

        if (attemptError) {
          // 23505 = unique_violation on (exam_id, user_id, attempt_number) —
          // a concurrent duplicate call already created it; resume that one.
          if (attemptError.code === '23505') {
            const { data: retried } = await supabase
              .from('attempts')
              .select('*')
              .eq('exam_id', examId)
              .eq('user_id', profile!.id)
              .eq('status', 'in_progress')
              .maybeSingle()
            if (!retried) {
              setError('Could not start attempt.')
              setLoading(false)
              return
            }
            currentAttempt = retried as Attempt
          } else {
            setError('Could not start attempt.')
            setLoading(false)
            return
          }
        } else {
          currentAttempt = newAttempt as Attempt

          const answerRows = selected.map((q) => ({ attempt_id: currentAttempt!.id, question_id: q.id, selected_option_ids: [] }))
          await supabase.from('attempt_answers').insert(answerRows)
        }
      }

      const { data: answerData } = await supabase
        .from('attempt_answers')
        .select('id, selected_option_ids, question:questions(*, question_options(*))')
        .eq('attempt_id', currentAttempt.id)
        .order('id', { ascending: true })

      if (cancelled) return

      const loadedAnswers = (answerData as unknown as AnswerRow[]) ?? []
      const withShuffledOptions = loadedAnswers.map((a) => ({
        ...a,
        question: {
          ...a.question,
          question_options: settingsData.shuffle_options ? shuffle(a.question.question_options) : a.question.question_options,
        },
      }))

      setAnswers(withShuffledOptions)
      setAttempt(currentAttempt)
      setSettings(settingsData as ExamSettings)
      setExamTitle(typedAssignment.exam.title)

      const personalDeadline = new Date(currentAttempt.started_at).getTime() + settingsData.time_limit_minutes * 60 * 1000
      const windowDeadline = typedAssignment.ends_at ? new Date(typedAssignment.ends_at).getTime() : Infinity
      const deadline = Math.min(personalDeadline, windowDeadline)
      setRemainingSeconds(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
      setLoading(false)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [assignmentId, profile])

  useEffect(() => {
    if (!attempt || loading) return
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          submit()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [attempt, loading, submit])

  async function selectOption(answerId: string, optionId: string) {
    // Phase 1 only surfaces mcq/true_false (single-select); multi_select is schema-only.
    const nextIds = [optionId]
    setAnswers((prev) => prev.map((a) => (a.id === answerId ? { ...a, selected_option_ids: nextIds } : a)))
    await supabase.from('attempt_answers').update({ selected_option_ids: nextIds }).eq('id', answerId)
  }

  if (loading) return <div className="page"><p>Loading quiz…</p></div>
  if (error) return <div className="page"><p className="form-error">{error}</p></div>
  if (blocked) {
    return (
      <div className="page">
        <p className="form-error">
          {blocked.status === 'too_early'
            ? `This quiz opens at ${blocked.when ? new Date(blocked.when).toLocaleString() : 'a later time'}.`
            : `This quiz's window closed at ${blocked.when ? new Date(blocked.when).toLocaleString() : 'the scheduled time'} — it has been marked as missed.`}
        </p>
        <p><Link to="/my-quizzes">Back to my quizzes</Link></p>
      </div>
    )
  }

  const answeredCount = answers.filter((a) => a.selected_option_ids.length > 0).length
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  return (
    <div className="page">
      <div className="list-header">
        <h1>{examTitle}</h1>
        <span className={`timer ${remainingSeconds < 60 ? 'low' : ''}`}>
          {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
      </div>
      <p>{answeredCount} of {answers.length} answered</p>

      {answers.map((answer, idx) => (
        <div className="exam-question" key={answer.id}>
          <h2>{idx + 1}. {answer.question.text}</h2>
          {answer.question.question_options.map((opt) => (
            <div
              key={opt.id}
              className={`exam-option ${answer.selected_option_ids.includes(opt.id) ? 'selected' : ''}`}
              onClick={() => selectOption(answer.id, opt.id)}
            >
              <input type="radio" checked={answer.selected_option_ids.includes(opt.id)} readOnly />
              {opt.text}
            </div>
          ))}
        </div>
      ))}

      <button onClick={submit} disabled={submitting}>
        {submitting ? 'Submitting…' : answeredCount < answers.length ? `Submit (${answers.length - answeredCount} unanswered)` : 'Submit'}
      </button>
    </div>
  )
}
