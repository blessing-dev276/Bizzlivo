import { useEffect, useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { supabase } from '../../../lib/supabase'
import { localDateString } from '../../../lib/date'
import SkillDevelopmentAdmin from '../skill-development/SkillDevelopmentAdmin'
import SkillDevelopmentMember from '../skill-development/SkillDevelopmentMember'
import type {
  IncomeDevelopmentIncomeEntry,
  IncomeDevelopmentPortfolioItem,
  IncomeDevelopmentProgress,
} from '../../../types/database'

const MANAGE_CATALOG_ROLES = new Set(['admin', 'trainer', 'team_leader'])
const TABS = ['Overview', 'Skill Catalog', 'Portfolio', 'Income', 'Milestones'] as const
type Tab = (typeof TABS)[number]

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : null
}

export default function IncomeDevelopmentMember() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const canManageCatalog = currentMembership ? MANAGE_CATALOG_ROLES.has(currentMembership.role) : false

  const [tab, setTab] = useState<Tab>('Overview')
  const [progress, setProgress] = useState<IncomeDevelopmentProgress | null>(null)
  const [portfolioItems, setPortfolioItems] = useState<IncomeDevelopmentPortfolioItem[]>([])
  const [incomeEntries, setIncomeEntries] = useState<IncomeDevelopmentIncomeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [skillName, setSkillName] = useState('')
  const [portfolioTitle, setPortfolioTitle] = useState('')
  const [portfolioLink, setPortfolioLink] = useState('')
  const [portfolioDesc, setPortfolioDesc] = useState('')
  const [incomeAmount, setIncomeAmount] = useState('')
  const [incomeSource, setIncomeSource] = useState('')
  const [incomeDate, setIncomeDate] = useState(localDateString())
  const [incomeNote, setIncomeNote] = useState('')

  async function load(org: string, userId: string) {
    setLoading(true)
    const [progressRes, portfolioRes, incomeRes] = await Promise.all([
      supabase.from('income_development_progress').select('*').eq('org_id', org).eq('user_id', userId).maybeSingle(),
      supabase.from('income_development_portfolio_items').select('*').eq('org_id', org).eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('income_development_income_entries').select('*').eq('org_id', org).eq('user_id', userId).order('earned_on', { ascending: false }),
    ])
    const p = (progressRes.data as IncomeDevelopmentProgress | null) ?? null
    setProgress(p)
    setSkillName(p?.skill_name ?? '')
    setPortfolioItems((portfolioRes.data as IncomeDevelopmentPortfolioItem[]) ?? [])
    setIncomeEntries((incomeRes.data as IncomeDevelopmentIncomeEntry[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId || !profile) return
    load(orgId, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, profile])

  if (loading) return <p>Loading…</p>

  async function saveProgress(patch: Partial<Omit<IncomeDevelopmentProgress, 'org_id' | 'user_id'>>) {
    if (!orgId || !profile) return
    setError(null)
    setBusy(true)
    const { data, error: upErr } = await supabase
      .from('income_development_progress')
      .upsert({ org_id: orgId, user_id: profile.id, ...progress, ...patch, updated_at: new Date().toISOString() })
      .select()
      .single()
    setBusy(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setProgress(data as IncomeDevelopmentProgress)
  }

  async function markSkill() {
    if (!skillName.trim()) return setError('Enter the skill you’re learning first.')
    await saveProgress({ skill_selected_at: new Date().toISOString(), skill_name: skillName.trim() })
  }

  async function togglePortfolioReady() {
    await saveProgress({ portfolio_built_at: progress?.portfolio_built_at ? null : new Date().toISOString() })
  }

  async function toggleFreelancing() {
    await saveProgress({ freelancing_started_at: progress?.freelancing_started_at ? null : new Date().toISOString() })
  }

  async function toggleConsistency() {
    await saveProgress({ consistency_at: progress?.consistency_at ? null : new Date().toISOString() })
  }

  async function addPortfolioItem() {
    if (!orgId || !profile) return
    if (!portfolioTitle.trim()) return setError('Give the portfolio item a title.')
    setError(null)
    setBusy(true)
    const { data, error: insertErr } = await supabase
      .from('income_development_portfolio_items')
      .insert({
        org_id: orgId,
        user_id: profile.id,
        title: portfolioTitle.trim(),
        description: portfolioDesc.trim() || null,
        link_url: portfolioLink.trim() || null,
      })
      .select()
      .single()
    setBusy(false)
    if (insertErr) return setError(insertErr.message)
    setPortfolioItems((prev) => [data as IncomeDevelopmentPortfolioItem, ...prev])
    setPortfolioTitle('')
    setPortfolioLink('')
    setPortfolioDesc('')
  }

  async function deletePortfolioItem(id: string) {
    setError(null)
    setBusy(true)
    const { error: deleteErr } = await supabase.from('income_development_portfolio_items').delete().eq('id', id)
    setBusy(false)
    if (deleteErr) return setError(deleteErr.message)
    setPortfolioItems((prev) => prev.filter((p) => p.id !== id))
  }

  async function addIncomeEntry() {
    if (!orgId || !profile) return
    const amountNum = Number(incomeAmount)
    if (!incomeAmount || Number.isNaN(amountNum) || amountNum <= 0) return setError('Enter a valid amount.')
    setError(null)
    setBusy(true)
    const { data, error: insertErr } = await supabase
      .from('income_development_income_entries')
      .insert({
        org_id: orgId,
        user_id: profile.id,
        amount: amountNum,
        source: incomeSource.trim() || null,
        earned_on: incomeDate,
        note: incomeNote.trim() || null,
      })
      .select()
      .single()
    if (insertErr) {
      setBusy(false)
      return setError(insertErr.message)
    }
    const entry = data as IncomeDevelopmentIncomeEntry
    setIncomeEntries((prev) => [entry, ...prev].sort((a, b) => (a.earned_on < b.earned_on ? 1 : -1)))
    if (!progress?.first_income_at) {
      await saveProgress({ first_income_at: new Date(`${incomeDate}T00:00:00`).toISOString() })
    }
    setBusy(false)
    setIncomeAmount('')
    setIncomeSource('')
    setIncomeNote('')
    setIncomeDate(localDateString())
  }

  async function deleteIncomeEntry(id: string) {
    setError(null)
    setBusy(true)
    const { error: deleteErr } = await supabase.from('income_development_income_entries').delete().eq('id', id)
    setBusy(false)
    if (deleteErr) return setError(deleteErr.message)
    setIncomeEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const totalIncome = incomeEntries.reduce((sum, e) => sum + Number(e.amount), 0)
  const firstIncomeDate = fmtDate(progress?.first_income_at ?? null)
  const milestonesDone = [
    !!progress?.skill_selected_at,
    !!progress?.portfolio_built_at,
    !!progress?.freelancing_started_at,
    !!progress?.first_income_at,
    !!progress?.consistency_at,
  ].filter(Boolean).length

  return (
    <div>
      <div className="view-tabs" style={{ marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={`view-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === 'Overview' && (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
            Learn a digital skill, build a portfolio, and start earning through freelancing before moving into
            Network Marketing.
          </p>
          <div className="upcoming-list" style={{ marginBottom: 20 }}>
            <span className="upcoming-pill">Milestones<span className="badge active">{milestonesDone} of 5</span></span>
            <span className="upcoming-pill">Skill<span className="badge active">{progress?.skill_name ?? 'Not chosen'}</span></span>
            <span className="upcoming-pill">Portfolio items<span className="badge active">{portfolioItems.length}</span></span>
            <span className="upcoming-pill">Total earned<span className="badge active">₦{totalIncome.toLocaleString('en-NG')}</span></span>
            {firstIncomeDate && <span className="upcoming-pill">First income<span className="badge active">{firstIncomeDate}</span></span>}
          </div>
          {milestonesDone === 5 && (
            <p className="form-info">All milestones complete — you're ready for Network Marketing. 🎉</p>
          )}
        </div>
      )}

      {tab === 'Skill Catalog' && (
        canManageCatalog
          ? <SkillDevelopmentAdmin purpose="income_development" />
          : <SkillDevelopmentMember purpose="income_development" />
      )}

      {tab === 'Portfolio' && (
        <div>
          <div className="upload-panel" style={{ marginBottom: 24 }}>
            <label>
              Title
              <input value={portfolioTitle} onChange={(e) => setPortfolioTitle(e.target.value)} placeholder="e.g. Logo design for a local bakery" />
            </label>
            <label>
              Link (optional)
              <input type="url" value={portfolioLink} onChange={(e) => setPortfolioLink(e.target.value)} placeholder="https://…" />
            </label>
            <label>
              Description (optional)
              <textarea value={portfolioDesc} onChange={(e) => setPortfolioDesc(e.target.value)} rows={2} />
            </label>
            <button type="button" onClick={addPortfolioItem} disabled={busy}>Add portfolio item</button>
          </div>

          <h4 className="overview-heading">YOUR PORTFOLIO ({portfolioItems.length})</h4>
          {portfolioItems.length === 0 ? (
            <p className="empty-row">Nothing added yet — add your first piece of work above.</p>
          ) : (
            portfolioItems.map((item) => (
              <div className="res-card" key={item.id} style={{ marginBottom: 8 }}>
                <div className="res-top">
                  <div className="res-left">
                    <div className="res-title-block">
                      <h3>{item.title}</h3>
                      {item.description && <p style={{ color: 'var(--text-dim)', margin: 0 }}>{item.description}</p>}
                      {item.link_url && <a href={item.link_url} target="_blank" rel="noreferrer">View →</a>}
                    </div>
                  </div>
                  <button type="button" className="secondary" onClick={() => deletePortfolioItem(item.id)} disabled={busy}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'Income' && (
        <div>
          <div className="upload-panel" style={{ marginBottom: 24 }}>
            <label>
              Amount (₦)
              <input type="number" min="0" step="0.01" value={incomeAmount} onChange={(e) => setIncomeAmount(e.target.value)} placeholder="0.00" />
            </label>
            <label>
              Source (optional)
              <input value={incomeSource} onChange={(e) => setIncomeSource(e.target.value)} placeholder="e.g. Fiverr, a direct client…" />
            </label>
            <label>
              Date earned
              <input type="date" value={incomeDate} onChange={(e) => setIncomeDate(e.target.value)} />
            </label>
            <label>
              Note (optional)
              <textarea value={incomeNote} onChange={(e) => setIncomeNote(e.target.value)} rows={2} />
            </label>
            <button type="button" onClick={addIncomeEntry} disabled={busy}>Log income</button>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
            <span className="badge active">Total earned: ₦{totalIncome.toLocaleString('en-NG')}</span>
            {firstIncomeDate && <span className="badge">First income: {firstIncomeDate}</span>}
          </div>

          <h4 className="overview-heading">INCOME LOG ({incomeEntries.length})</h4>
          {incomeEntries.length === 0 ? (
            <p className="empty-row">No income logged yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Amount</th><th>Source</th><th>Note</th><th /></tr>
                </thead>
                <tbody>
                  {incomeEntries.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(`${e.earned_on}T00:00:00`).toLocaleDateString()}</td>
                      <td>₦{Number(e.amount).toLocaleString('en-NG')}</td>
                      <td>{e.source ?? '—'}</td>
                      <td>{e.note ?? '—'}</td>
                      <td>
                        <button type="button" className="secondary" onClick={() => deleteIncomeEntry(e.id)} disabled={busy}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Milestones' && (
        <div>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
            Work through these at your own pace — mark each one off as you hit it.
          </p>

          <section className="growth-pillar" style={{ marginBottom: 16 }}>
            <div className="growth-pillar-head">
              <h2>1. Learn a digital skill</h2>
              {progress?.skill_selected_at && <span className="badge active">Done {new Date(progress.skill_selected_at).toLocaleDateString()}</span>}
            </div>
            {progress?.skill_selected_at ? (
              <p style={{ color: 'var(--text-faint)' }}>Skill: {progress.skill_name}</p>
            ) : (
              <>
                <input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="e.g. Graphic design, copywriting, video editing…"
                  style={{ marginBottom: 10, width: '100%', maxWidth: 360 }}
                />
                <div><button type="button" onClick={markSkill} disabled={busy}>Mark as learned</button></div>
              </>
            )}
          </section>

          <section className="growth-pillar" style={{ marginBottom: 16 }}>
            <div className="growth-pillar-head">
              <h2>2. Build a portfolio</h2>
              {progress?.portfolio_built_at && <span className="badge active">Done {new Date(progress.portfolio_built_at).toLocaleDateString()}</span>}
            </div>
            <p style={{ color: 'var(--text-faint)' }}>You've added {portfolioItems.length} portfolio item{portfolioItems.length === 1 ? '' : 's'}.</p>
            <button type="button" onClick={togglePortfolioReady} disabled={busy} className={progress?.portfolio_built_at ? 'secondary' : ''}>
              {progress?.portfolio_built_at ? 'Undo' : 'Mark portfolio as ready'}
            </button>
          </section>

          <section className="growth-pillar" style={{ marginBottom: 16 }}>
            <div className="growth-pillar-head">
              <h2>3. Start freelancing</h2>
              {progress?.freelancing_started_at && <span className="badge active">Done {new Date(progress.freelancing_started_at).toLocaleDateString()}</span>}
            </div>
            <button type="button" onClick={toggleFreelancing} disabled={busy} className={progress?.freelancing_started_at ? 'secondary' : ''}>
              {progress?.freelancing_started_at ? 'Undo' : "I've started freelancing"}
            </button>
          </section>

          <section className="growth-pillar" style={{ marginBottom: 16 }}>
            <div className="growth-pillar-head">
              <h2>4. Earn first income</h2>
              {progress?.first_income_at ? (
                <span className="badge active">Done {new Date(progress.first_income_at).toLocaleDateString()}</span>
              ) : (
                <span className="badge">Not yet</span>
              )}
            </div>
            <p style={{ color: 'var(--text-faint)' }}>
              {progress?.first_income_at
                ? 'Completed automatically from your income log.'
                : 'Log a payment in the Income tab to complete this automatically.'}
            </p>
          </section>

          <section className="growth-pillar">
            <div className="growth-pillar-head">
              <h2>5. Build consistency</h2>
              {progress?.consistency_at && <span className="badge active">Done {new Date(progress.consistency_at).toLocaleDateString()}</span>}
            </div>
            <p style={{ color: 'var(--text-faint)' }}>Earning steadily over multiple weeks? Mark this once it feels consistent.</p>
            <button type="button" onClick={toggleConsistency} disabled={busy} className={progress?.consistency_at ? 'secondary' : ''}>
              {progress?.consistency_at ? 'Undo' : "I'm earning consistently"}
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
