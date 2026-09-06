// One date-range resolver every report shares. A range is a half-open
// [start, end) window in real Date terms; `prevStart`/`prevEnd` is the
// equally-long window immediately before it, for period-over-period deltas.
export type RangePreset =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'custom'

export interface ResolvedRange {
  preset: RangePreset
  start: Date
  end: Date
  prevStart: Date
  prevEnd: Date
  label: string
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  last_month: 'Last Month',
  last_30_days: 'Last 30 Days',
  last_90_days: 'Last 90 Days',
  custom: 'Custom Range',
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function resolveRange(preset: RangePreset, customStart?: string, customEnd?: string): ResolvedRange {
  const now = new Date()
  const todayStart = startOfDay(now)
  let start: Date
  let end: Date = startOfDay(new Date(now.getTime() + 86_400_000)) // tomorrow 00:00 — inclusive of today

  switch (preset) {
    case 'today':
      start = todayStart
      break
    case 'this_week': {
      const dow = (todayStart.getDay() + 6) % 7 // Mon = 0
      start = new Date(todayStart.getTime() - dow * 86_400_000)
      break
    }
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'last_30_days':
      start = new Date(todayStart.getTime() - 29 * 86_400_000)
      break
    case 'last_90_days':
      start = new Date(todayStart.getTime() - 89 * 86_400_000)
      break
    case 'custom':
      start = customStart ? startOfDay(new Date(customStart)) : new Date(now.getFullYear(), now.getMonth(), 1)
      end = customEnd ? startOfDay(new Date(new Date(customEnd).getTime() + 86_400_000)) : end
      break
  }

  const span = end.getTime() - start.getTime()
  const prevEnd = new Date(start)
  const prevStart = new Date(start.getTime() - span)

  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const label =
    preset === 'custom' || preset === 'this_week' || preset === 'last_30_days' || preset === 'last_90_days'
      ? `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}`
      : PRESET_LABELS[preset]

  return { preset, start, end, prevStart, prevEnd, label }
}

// metric-aware trend semantics: is an increase good, bad, or neutral?
export type TrendDir = 'up' | 'down' | 'flat'
export type TrendTone = 'good' | 'bad' | 'neutral'

export function trend(current: number, previous: number, higherIsBetter = true): {
  dir: TrendDir
  tone: TrendTone
  pct: number | null
} {
  if (previous === 0) {
    if (current === 0) return { dir: 'flat', tone: 'neutral', pct: null }
    return { dir: 'up', tone: higherIsBetter ? 'good' : 'bad', pct: null }
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  if (pct === 0) return { dir: 'flat', tone: 'neutral', pct: 0 }
  const dir: TrendDir = pct > 0 ? 'up' : 'down'
  const improving = higherIsBetter ? pct > 0 : pct < 0
  return { dir, tone: improving ? 'good' : 'bad', pct }
}
