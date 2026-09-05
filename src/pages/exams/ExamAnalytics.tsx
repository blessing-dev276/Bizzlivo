import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Exam } from '../../types/database'

interface AttemptRow {
  id: string
  taker_name: string | null
  taker_email: string | null
  is_guest: boolean
  score_percent: number | null
  passed: boolean | null
  submitted_at: string | null
  profile: { full_name: string; email: string | null } | null
}

type TypeFilter = 'all' | 'member' | 'guest'
type ResultFilter = 'all' | 'passed' | 'failed'

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export default function ExamAnalytics() {
  const { examId } = useParams<{ examId: string }>()
  const [exam, setExam] = useState<Exam | null>(null)
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [loading, setLoading] = useState(true)

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    if (!examId) return
    let cancelled = false

    async function load() {
      const [{ data: examData }, { data: attemptData }] = await Promise.all([
        supabase.from('exams').select('*').eq('id', examId).single(),
        supabase
          .from('attempts')
          .select('id, taker_name, taker_email, is_guest, score_percent, passed, submitted_at, profile:profiles(full_name, email)')
          .eq('exam_id', examId)
          .eq('status', 'submitted')
          .order('submitted_at', { ascending: false }),
      ])
      if (cancelled) return
      setExam(examData as Exam | null)
      setAttempts((attemptData as unknown as AttemptRow[]) ?? [])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [examId])

  const filtered = useMemo(() => {
    return attempts.filter((a) => {
      if (typeFilter === 'member' && a.is_guest) return false
      if (typeFilter === 'guest' && !a.is_guest) return false
      if (resultFilter === 'passed' && !a.passed) return false
      if (resultFilter === 'failed' && a.passed) return false
      if (fromDate && (!a.submitted_at || new Date(a.submitted_at) < new Date(fromDate))) return false
      if (toDate && (!a.submitted_at || new Date(a.submitted_at) > new Date(toDate + 'T23:59:59'))) return false
      return true
    })
  }, [attempts, typeFilter, resultFilter, fromDate, toDate])

  if (loading) return <div className="page"><p>Loading…</p></div>
  if (!exam) return <div className="page"><p>Exam not found.</p></div>

  const memberAttempts = attempts.filter((a) => !a.is_guest)
  const guestAttempts = attempts.filter((a) => a.is_guest)
  const total = attempts.length
  const passCount = attempts.filter((a) => a.passed).length
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : null
  const avgScore =
    total > 0 ? Math.round((attempts.reduce((sum, a) => sum + (a.score_percent ?? 0), 0) / total) * 10) / 10 : null

  function exportCsv() {
    const header = ['Name', 'Email', 'Type', 'Score %', 'Result', 'Submitted']
    const rows = filtered.map((a) => [
      a.is_guest ? a.taker_name ?? '' : a.profile?.full_name ?? '',
      a.is_guest ? a.taker_email ?? '' : a.profile?.email ?? '',
      a.is_guest ? 'Guest' : 'Member',
      String(a.score_percent ?? ''),
      a.passed ? 'Passed' : 'Failed',
      a.submitted_at ? new Date(a.submitted_at).toISOString() : '',
    ])
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exam!.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-attempts.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div className="list-header">
        <h1>Analytics — {exam.title}</h1>
        <button type="button" className="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
          Download report (CSV)
        </button>
      </div>

      <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 0 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TOTAL ATTEMPTS</span></div>
          <div className="kpi-value">{total}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">MEMBERS · GUESTS</span></div>
          <div className="kpi-value">{memberAttempts.length} · {guestAttempts.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">PASS RATE</span></div>
          <div className="kpi-value">{passRate === null ? '—' : `${passRate}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">AVG SCORE</span></div>
          <div className="kpi-value">{avgScore === null ? '—' : `${avgScore}%`}</div>
        </div>
      </section>

      <div className="field-row" style={{ marginTop: 24, alignItems: 'flex-end' }}>
        <label style={{ flex: '0 1 160px' }}>
          Type
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
            <option value="all">All</option>
            <option value="member">Members</option>
            <option value="guest">Guests</option>
          </select>
        </label>
        <label style={{ flex: '0 1 160px' }}>
          Result
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as ResultFilter)}>
            <option value="all">All</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label style={{ flex: '0 1 170px' }}>
          From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label style={{ flex: '0 1 170px' }}>
          To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
      </div>

      <div>
        {filtered.length === 0 ? (
          <p>No attempts match these filters.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Score</th>
                <th>Result</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/exams/${examId}/analytics/${a.id}`}>{a.is_guest ? a.taker_name : a.profile?.full_name ?? '—'}</Link>
                  </td>
                  <td>{a.is_guest ? 'Guest' : 'Member'}</td>
                  <td>{a.score_percent ?? '—'}%</td>
                  <td><span className={`badge ${a.passed ? 'passed' : 'failed'}`}>{a.passed ? 'Passed' : 'Failed'}</span></td>
                  <td>{a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
