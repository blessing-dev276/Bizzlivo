import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useOrgUsage } from '../../lib/plans'
import type { Exam, ExamSettings as ExamSettingsRow } from '../../types/database'

export default function ExamSettings() {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const { currentMembership } = useAuth()
  const { usage, refresh: refreshUsage } = useOrgUsage(currentMembership?.organization.id)
  const [exam, setExam] = useState<Exam | null>(null)
  const [settings, setSettings] = useState<ExamSettingsRow | null>(null)
  const [approvedCount, setApprovedCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!examId) return
    const [{ data: examData }, { data: settingsData }, { count: approved }, { count: pending }] = await Promise.all([
      supabase.from('exams').select('*').eq('id', examId).single(),
      supabase.from('exam_settings').select('*').eq('exam_id', examId).single(),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('exam_id', examId).eq('status', 'approved'),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('exam_id', examId).eq('status', 'pending_review'),
    ])
    setExam(examData as Exam | null)
    setSettings(settingsData as ExamSettingsRow | null)
    setApprovedCount(approved ?? 0)
    setPendingCount(pending ?? 0)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  const gateClear = pendingCount === 0 && approvedCount > 0

  async function saveSettings(e: FormEvent) {
    e.preventDefault()
    if (!settings || !examId) return
    setSaving(true)
    setError(null)
    const { error: updError } = await supabase
      .from('exam_settings')
      .update({
        num_questions: settings.num_questions,
        time_limit_minutes: settings.time_limit_minutes,
        pass_mark_percent: settings.pass_mark_percent,
        shuffle_questions: settings.shuffle_questions,
        shuffle_options: settings.shuffle_options,
        max_attempts: settings.max_attempts,
      })
      .eq('exam_id', examId)
    setSaving(false)
    if (updError) setError(updError.message)
  }

  async function publish() {
    if (!examId || !gateClear) return
    setSaving(true)
    setError(null)
    // Publishing a quiz automatically turns on its public link — the
    // office can turn it back off from the exam detail page if they'd
    // rather assign-only for this one.
    const { error: pubError } = await supabase
      .from('exams')
      .update({ status: 'published', public_link_enabled: true })
      .eq('id', examId)
    setSaving(false)
    if (pubError) {
      setError(pubError.message)
      return
    }
    await refreshUsage()
    navigate(`/quizzes/${examId}`)
  }

  const publishedLimit = usage?.max_published_exams ?? null
  const atPublishLimit = exam?.status !== 'published' && publishedLimit !== null && (usage?.published_exam_count ?? 0) >= publishedLimit

  if (loading || !settings || !exam) return <div className="page"><p>Loading…</p></div>

  return (
    <div className="page">
      <h1>Settings — {exam.title}</h1>

      {!gateClear && (
        <p className="form-error">
          {pendingCount > 0
            ? `${pendingCount} question(s) still pending review. Approve or reject them all before publishing.`
            : 'Approve at least one question before publishing.'}
        </p>
      )}

      <form onSubmit={saveSettings} style={{ maxWidth: 480 }}>
        <div className="field-row">
          <label>
            Questions per attempt
            <input
              type="number"
              min={1}
              max={approvedCount || 1}
              value={settings.num_questions}
              onChange={(e) => setSettings({ ...settings, num_questions: Number(e.target.value) })}
            />
          </label>
          <label>
            Time limit (minutes)
            <input
              type="number"
              min={1}
              value={settings.time_limit_minutes}
              onChange={(e) => setSettings({ ...settings, time_limit_minutes: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="field-row">
          <label>
            Pass mark (%)
            <input
              type="number"
              min={0}
              max={100}
              value={settings.pass_mark_percent}
              onChange={(e) => setSettings({ ...settings, pass_mark_percent: Number(e.target.value) })}
            />
          </label>
          <label>
            Max attempts (0 = unlimited)
            <input
              type="number"
              min={0}
              value={settings.max_attempts}
              onChange={(e) => setSettings({ ...settings, max_attempts: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="toggle-row">
          <label>Shuffle questions</label>
          <input
            type="checkbox"
            checked={settings.shuffle_questions}
            onChange={(e) => setSettings({ ...settings, shuffle_questions: e.target.checked })}
          />
        </div>
        <div className="toggle-row">
          <label>Shuffle options</label>
          <input
            type="checkbox"
            checked={settings.shuffle_options}
            onChange={(e) => setSettings({ ...settings, shuffle_options: e.target.checked })}
          />
        </div>

        {atPublishLimit && (
          <p className="limit-note attn">
            You've published {usage?.published_exam_count} of {publishedLimit} quizzes allowed on your plan. <Link to="/billing">Upgrade to publish more →</Link>
          </p>
        )}

        {error && <p className="form-error">{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button type="submit" className="secondary" disabled={saving}>Save settings</button>
          <button type="button" onClick={publish} disabled={saving || !gateClear || exam.status === 'published' || atPublishLimit}>
            {exam.status === 'published' ? 'Published' : 'Publish quiz'}
          </button>
        </div>
      </form>
    </div>
  )
}
