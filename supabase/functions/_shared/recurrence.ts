// Deno port of the occurrence-expansion core from src/lib/recurrence.ts.
// Kept deliberately minimal — events-tick only needs "which occurrences
// start in [from, to)" for a series, resolved to real UTC instants in the
// series' IANA timezone. Building / describing rules stays frontend-only.

import { RRule } from 'npm:rrule@2.8.1'

export interface SeriesArgs {
  recurrenceRule: string
  seriesStartDate: string // 'YYYY-MM-DD'
  localStartTime: string // 'HH:MM'
  durationMinutes: number
  timezone: string
  endType: 'never' | 'until' | 'count'
  until?: string | null
  count?: number | null
}

export interface Occurrence {
  date: string // 'YYYY-MM-DD'
  startAt: Date
  endAt: Date
}

function tzOffsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return (asUTC - utcMs) / 60000
}

export function wallTimeToUtc(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, mo, d, hh, mm)
  let offset = tzOffsetMinutes(guess, tz)
  let utc = guess - offset * 60000
  offset = tzOffsetMinutes(utc, tz)
  utc = guess - offset * 60000
  return new Date(utc)
}

function ruleObject(args: SeriesArgs): RRule {
  const [sy, sm, sd] = args.seriesStartDate.split('-').map(Number)
  const opts = RRule.parseString(args.recurrenceRule)
  opts.dtstart = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0))
  if (args.endType === 'count' && args.count) opts.count = args.count
  if (args.endType === 'until' && args.until) {
    const [uy, um, ud] = args.until.split('-').map(Number)
    opts.until = new Date(Date.UTC(uy, um - 1, ud, 23, 59, 59))
  }
  return new RRule(opts)
}

export function expandOccurrences(args: SeriesArgs, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const rule = ruleObject(args)
  const pad = 24 * 60 * 60 * 1000
  const lo = new Date(rangeStart.getTime() - pad)
  const hi = new Date(rangeEnd.getTime() + pad)
  const fLo = new Date(Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate()))
  const fHi = new Date(Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), hi.getUTCDate(), 23, 59, 59))
  const [hh, mm] = args.localStartTime.split(':').map(Number)
  return rule.between(fLo, fHi, true).map((fd) => {
    const y = fd.getUTCFullYear(), mo = fd.getUTCMonth(), d = fd.getUTCDate()
    const startAt = wallTimeToUtc(y, mo, d, hh, mm, args.timezone)
    const endAt = new Date(startAt.getTime() + args.durationMinutes * 60000)
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return { date: iso, startAt, endAt }
  }).filter((o) => o.startAt >= rangeStart && o.startAt < rangeEnd)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}
