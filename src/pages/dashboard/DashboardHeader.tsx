import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { OfficeLoginLink, timeOfDayGreeting } from './dashboardShared'
import { IcSpark } from './icons'

// The AI sentence is fetched here, independently — the rest of the
// dashboard renders immediately whether or not this resolves.
function useAiSummary(orgId: string | undefined) {
  const [state, setState] = useState<{ text: string; loading: boolean }>({ text: '', loading: true })

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setState({ text: '', loading: true })
    supabase.functions
      .invoke('dashboard-ai-summary', { body: { orgId } })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || data?.error || !data?.summary) {
          setState({ text: '', loading: false })
          return
        }
        setState({ text: data.summary, loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ text: '', loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return state
}

export default function DashboardHeader({
  firstName,
  officeName,
  officeSlug,
  orgId,
}: {
  firstName: string
  officeName: string
  officeSlug: string
  orgId: string | undefined
}) {
  const now = new Date()
  const ai = useAiSummary(orgId)

  return (
    <header className="dash-header">
      <h1 className="dash-hello">{timeOfDayGreeting(now)}, {firstName} 👋</h1>
      <p className="dash-sub">
        Here's what's happening at {officeName} today · {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      <div className="dash-metaline">
        {!ai.loading && ai.text && (
          <span className="dash-pill ai">
            <IcSpark />
            {ai.text}
          </span>
        )}
        <OfficeLoginLink slug={officeSlug} />
      </div>
    </header>
  )
}
