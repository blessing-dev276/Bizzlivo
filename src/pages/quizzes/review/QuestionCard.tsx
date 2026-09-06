import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { Question, QuestionOption } from '../../../types/database'

export interface QuestionWithOptions extends Question {
  question_options: QuestionOption[]
}

interface EditableOption {
  id: string | null
  text: string
  is_correct: boolean
}

function toEditable(options: QuestionOption[]): EditableOption[] {
  return [...options]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map((o) => ({ id: o.id, text: o.text, is_correct: o.is_correct }))
}

export default function QuestionCard({
  question,
  onChanged,
}: {
  question: QuestionWithOptions
  onChanged: () => void
}) {
  const { profile } = useAuth()
  const [text, setText] = useState(question.text)
  const [options, setOptions] = useState<EditableOption[]>(toEditable(question.question_options))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateOptionText(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, text: value } : o)))
  }

  function markCorrect(index: number) {
    setOptions((prev) => prev.map((o, i) => ({ ...o, is_correct: i === index })))
  }

  function addOption() {
    setOptions((prev) => [...prev, { id: null, text: '', is_correct: false }])
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  async function saveEdits() {
    setError(null)
    if (!options.some((o) => o.is_correct)) {
      setError('Mark one option as correct before saving.')
      return
    }
    if (options.some((o) => !o.text.trim())) {
      setError('Options cannot be empty.')
      return
    }

    setSaving(true)
    try {
      const { error: qError } = await supabase.from('questions').update({ text }).eq('id', question.id)
      if (qError) throw qError

      const originalIds = new Set(question.question_options.map((o) => o.id))
      const keptIds = new Set(options.filter((o) => o.id).map((o) => o.id as string))
      const removedIds = [...originalIds].filter((id) => !keptIds.has(id))
      if (removedIds.length > 0) {
        const { error: delError } = await supabase.from('question_options').delete().in('id', removedIds)
        if (delError) throw delError
      }

      for (const [index, opt] of options.entries()) {
        if (opt.id) {
          const { error: updError } = await supabase
            .from('question_options')
            .update({ text: opt.text, is_correct: opt.is_correct, order_index: index })
            .eq('id', opt.id)
          if (updError) throw updError
        } else {
          const { error: insError } = await supabase.from('question_options').insert({
            question_id: question.id,
            text: opt.text,
            is_correct: opt.is_correct,
            order_index: index,
          })
          if (insError) throw insError
        }
      }

      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(status: 'approved' | 'rejected') {
    setError(null)
    setSaving(true)
    try {
      // Persist any pending edits first so approve/reject reflects the latest text.
      await saveEdits()
      const { error: statusError } = await supabase
        .from('questions')
        .update({ status, reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
        .eq('id', question.id)
      if (statusError) throw statusError
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="question-card">
      <div className="list-header">
        <span className="badge">{question.type}</span>
        <span className={`badge ${question.status}`}>{question.status.replace('_', ' ')}</span>
      </div>

      <label>
        Question text
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </label>

      {options.map((opt, i) => (
        <div className="option-row" key={opt.id ?? `new-${i}`}>
          <input
            type="radio"
            name={`correct-${question.id}`}
            checked={opt.is_correct}
            onChange={() => markCorrect(i)}
            title="Mark as correct answer"
          />
          <input type="text" value={opt.text} onChange={(e) => updateOptionText(i, e.target.value)} />
          <button type="button" className="secondary" onClick={() => removeOption(i)} disabled={options.length <= 2}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={addOption} style={{ marginBottom: 12 }}>
        + Add option
      </button>

      {error && <p className="form-error">{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="secondary" onClick={saveEdits} disabled={saving}>
          Save edits
        </button>
        <button type="button" onClick={() => setStatus('approved')} disabled={saving}>
          Approve
        </button>
        <button type="button" className="danger" onClick={() => setStatus('rejected')} disabled={saving}>
          Reject
        </button>
      </div>
    </div>
  )
}
