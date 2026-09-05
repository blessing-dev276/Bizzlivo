import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import { localDateString } from '../../../lib/date'
import { KIND_ICON, resourceKind } from '../../../lib/resourceKind'
import type { PersonalDevelopmentCompletion, PersonalDevelopmentResource, Resource, ResourceKind } from '../../../types/database'

const GROUP_TITLE: Record<ResourceKind, string> = { pdf: 'Books', podcast: 'Podcasts', video: 'Videos' }
const GROUP_ORDER: ResourceKind[] = ['pdf', 'podcast', 'video']
const SIGNED_URL_TTL_SECONDS = 3600
const STREAK_LOOKBACK_DAYS = 60

interface LinkedRow extends PersonalDevelopmentResource {
  resource: Resource
}

function groupByKind(resources: Resource[]): Map<ResourceKind, Resource[]> {
  const map = new Map<ResourceKind, Resource[]>(GROUP_ORDER.map((k) => [k, []]))
  for (const r of resources) map.get(resourceKind(r))!.push(r)
  return map
}

function computeStreak(
  completions: Pick<PersonalDevelopmentCompletion, 'resource_id' | 'completed_on'>[],
  requiredCount: number,
  todayStr: string
): number {
  if (requiredCount === 0) return 0
  const byDay = new Map<string, Set<string>>()
  for (const c of completions) {
    if (!byDay.has(c.completed_on)) byDay.set(c.completed_on, new Set())
    byDay.get(c.completed_on)!.add(c.resource_id)
  }
  const isDone = (d: string) => (byDay.get(d)?.size ?? 0) >= requiredCount

  const cursor = new Date(`${todayStr}T00:00:00`)
  if (!isDone(todayStr)) cursor.setDate(cursor.getDate() - 1)

  let streak = 0
  while (true) {
    const key = localDateString(cursor)
    if (!isDone(key)) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export default function PersonalDevelopmentMember() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [linked, setLinked] = useState<LinkedRow[]>([])
  const [completions, setCompletions] = useState<PersonalDevelopmentCompletion[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(org: string, userId: string) {
    setLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - STREAK_LOOKBACK_DAYS)

    const [linkRes, completionsRes] = await Promise.all([
      supabase.from('personal_development_resources').select('*, resource:resources(*)').eq('org_id', org),
      supabase
        .from('personal_development_completions')
        .select('*')
        .eq('org_id', org)
        .eq('user_id', userId)
        .gte('completed_on', localDateString(since)),
    ])
    const linkedRows = (linkRes.data as unknown as LinkedRow[]) ?? []
    setLinked(linkedRows)
    setCompletions((completionsRes.data as PersonalDevelopmentCompletion[]) ?? [])

    const pdfPaths = linkedRows.filter((l) => resourceKind(l.resource) === 'pdf')
    const signedEntries = await Promise.all(
      pdfPaths.map(async (l) => {
        const { data } = await supabase.storage.from('resources').createSignedUrl(l.resource.file_url, SIGNED_URL_TTL_SECONDS)
        return [l.resource.id, data?.signedUrl ?? null] as const
      })
    )
    const map = new Map<string, string>()
    for (const l of linkedRows) {
      if (resourceKind(l.resource) !== 'pdf') map.set(l.resource.id, l.resource.file_url)
    }
    for (const [id, url] of signedEntries) if (url) map.set(id, url)
    setUrls(map)
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId || !profile) return
    load(orgId, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, profile])

  if (loading) return <p>Loading…</p>

  const todayStr = localDateString()
  const doneTodayIds = new Set(completions.filter((c) => c.completed_on === todayStr).map((c) => c.resource_id))
  const grouped = groupByKind(linked.map((l) => l.resource))
  const streak = computeStreak(completions, linked.length, todayStr)

  async function markDone(resourceId: string) {
    if (!orgId || !profile) return
    setError(null)
    setBusyId(resourceId)
    const { data, error: insertErr } = await supabase
      .from('personal_development_completions')
      .insert({ org_id: orgId, resource_id: resourceId, user_id: profile.id, completed_on: todayStr })
      .select()
      .single()
    setBusyId(null)
    if (insertErr) setError(insertErr.message)
    else setCompletions((prev) => [...prev, data as PersonalDevelopmentCompletion])
  }

  async function undo(resourceId: string) {
    if (!orgId || !profile) return
    setError(null)
    setBusyId(resourceId)
    const { error: deleteErr } = await supabase
      .from('personal_development_completions')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', profile.id)
      .eq('resource_id', resourceId)
      .eq('completed_on', todayStr)
    setBusyId(null)
    if (deleteErr) setError(deleteErr.message)
    else setCompletions((prev) => prev.filter((c) => !(c.resource_id === resourceId && c.completed_on === todayStr)))
  }

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
        Your office's daily growth list — get through everything below today. It resets tomorrow.
      </p>

      {linked.length > 0 && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
          <span className="badge active">{doneTodayIds.size} of {linked.length} done today</span>
          {streak > 0 && <span className="badge">{streak} day streak</span>}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {linked.length === 0 ? (
        <p className="empty-row">Your office hasn't added any required resources yet.</p>
      ) : (
        GROUP_ORDER.map((k) => {
          const items = grouped.get(k) ?? []
          if (items.length === 0) return null
          return (
            <div key={k} style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-faint)', marginBottom: 8 }}>{GROUP_TITLE[k]}</p>
              {items.map((r) => {
                const done = doneTodayIds.has(r.id)
                const url = urls.get(r.id) ?? null
                return (
                  <div className="res-card" key={r.id} style={{ marginBottom: 8 }}>
                    <div className="res-top">
                      <div className="res-left">
                        <div className="res-icon">{KIND_ICON[k]}</div>
                        <div className="res-title-block">
                          <h3>{r.title}</h3>
                          {url && <a href={url} target="_blank" rel="noreferrer">Open →</a>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {done ? (
                          <>
                            <span className="badge active">Done ✓</span>
                            <button type="button" className="secondary" onClick={() => undo(r.id)} disabled={busyId === r.id}>
                              Undo
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => markDone(r.id)} disabled={busyId === r.id || !url}>
                            Mark done today
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
