import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Attempt, Exam, ExamSettings } from '../../types/database'

export default function Result() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [exam, setExam] = useState<Exam | null>(null)
  const [settings, setSettings] = useState<ExamSettings | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!attemptId) return
    async function load() {
      const { data: attemptData } = await supabase.from('attempts').select('*').eq('id', attemptId).single()
      if (!attemptData) {
        setLoading(false)
        return
      }
      const [{ data: examData }, { data: settingsData }, { data: answers }] = await Promise.all([
        supabase.from('exams').select('*').eq('id', attemptData.exam_id).single(),
        supabase.from('exam_settings').select('*').eq('exam_id', attemptData.exam_id).single(),
        supabase.from('attempt_answers').select('is_correct').eq('attempt_id', attemptId!),
      ])
      setAttempt(attemptData as Attempt)
      setExam(examData as Exam | null)
      setSettings(settingsData as ExamSettings | null)
      setTotal(answers?.length ?? 0)
      setCorrectCount((answers ?? []).filter((a) => a.is_correct).length)
      setLoading(false)
    }
    load()
  }, [attemptId])

  if (loading) return <div className="page"><p>Loading…</p></div>
  if (!attempt) return <div className="page"><p>Attempt not found.</p></div>

  const maxAttempts = settings?.max_attempts ?? 1
  const canRetake = attempt.attempt_number != null && (maxAttempts === 0 || attempt.attempt_number < maxAttempts)

  return (
    <div className="page">
      <div className="result-hero">
        <p>{exam?.title}</p>
        <div className={`result-score ${attempt.passed ? 'result-pass' : 'result-fail'}`}>
          {attempt.score_percent}%
        </div>
        <h2 className={attempt.passed ? 'result-pass' : 'result-fail'}>
          {attempt.passed ? 'Passed' : 'Failed'}
        </h2>
        <p>{correctCount} of {total} correct</p>
      </div>

      {!attempt.passed && canRetake && exam && (
        <p>
          <Link to="/cbt">Retake this exam →</Link>
        </p>
      )}

      <p><Link to="/cbt">Back to my exams</Link> · <Link to="/">Go to your dashboard</Link></p>
    </div>
  )
}
