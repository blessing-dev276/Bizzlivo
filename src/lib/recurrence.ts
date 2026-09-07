// Shared RRULE recurrence engine for Events (Phase A).
//
// A recurring series stores: an RFC-5545 RRULE string, a series start date,
// a wall-clock start time ("HH:MM") and duration, all interpreted in the
// ORGANIZATION's IANA timezone (never the browser's). Occurrences are
// computed here on demand — the DB only persists an occurrence row when a
// specific date needs state (attendance, a reminder, an override).
//
// Timezone strategy: rrule.js has no real tz support, so we expand the
// rule in "floating" time (wall-clock components read as if UTC) and then
// convert each wall-clock datetime to a real UTC instant using the IANA
// offset in effect on that date. This is correct across DST boundaries
// because the offset is recomputed per occurrence.

import { RRule, type Weekday } from 'rrule'

export type RecurrencePreset =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'selected_days'
  | 'monthly'
  | 'custom'

// 0 = Monday … 6 = Sunday, matching RRule's weekday numbering.
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const RRULE_WEEKDAYS: Weekday[] = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU]

export interface RecurrenceInput {
  preset: RecurrencePreset
  /** For 'selected_days' / 'weekly' / 'custom': indices 0..6 (Mon..Sun). */
  weekdays?: number[]
  /** For 'custom': repeat every N days/weeks. */
  interval?: number
  /** For 'custom': the base frequency. */
  customFreq?: 'daily' | 'weekly'
  /** The series start date, 'YYYY-MM-DD' — used to derive weekly/monthly anchors. */
  seriesStartDate: string
}

function jsDowToRRuleIndex(date: string): number {
  // getUTCDay: 0=Sun..6=Sat  ->  0=Mon..6=Sun
  const d = new Date(`${date}T00:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

/** Build an RFC-5545 RRULE string (without DTSTART) from the form input. */
export function buildRRule(input: RecurrenceInput): string {
  const { preset } = input
  switch (preset) {
    case 'daily':
      return 'FREQ=DAILY;INTERVAL=1'
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    case 'weekly': {
      const dow = input.weekdays?.length ? input.weekdays : [jsDowToRRuleIndex(input.seriesStartDate)]
      return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${dow.map((i) => RRULE_WEEKDAYS[i].toString()).join(',')}`
    }
    case 'selected_days': {
      const dow = (input.weekdays ?? []).slice().sort((a, b) => a - b)
      if (dow.length === 0) throw new Error('Pick at least one day.')
      return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${dow.map((i) => RRULE_WEEKDAYS[i].toString()).join(',')}`
    }
    case 'monthly': {
      const day = Number(input.seriesStartDate.slice(8, 10))
      return `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${day}`
    }
    case 'custom': {
      const n = Math.max(1, input.interval ?? 1)
      if ((input.customFreq ?? 'daily') === 'weekly') {
        const dow = input.weekdays?.length ? input.weekdays : [jsDowToRRuleIndex(input.seriesStartDate)]
        return `FREQ=WEEKLY;INTERVAL=${n};BYDAY=${dow.map((i) => RRULE_WEEKDAYS[i].toString()).join(',')}`
      }
      return `FREQ=DAILY;INTERVAL=${n}`
    }
  }
}

/** Best-effort inverse of buildRRule, to re-hydrate the edit form. */
export function parseRRule(rule: string): Partial<RecurrenceInput> & { endless: true } {
  const parts = Object.fromEntries(
    rule.replace(/^RRULE:/i, '').split(';').map((kv) => {
      const [k, v] = kv.split('=')
      return [k.toUpperCase(), v]
    }),
  ) as Record<string, string>

  const byday = (parts.BYDAY ?? '')
    .split(',')
    .filter(Boolean)
    .map((code) => RRULE_WEEKDAYS.findIndex((w) => w.toString() === code))
    .filter((i) => i >= 0)
  const interval = Number(parts.INTERVAL ?? '1')

  if (parts.FREQ === 'DAILY') {
    return interval === 1
      ? { preset: 'daily', endless: true }
      : { preset: 'custom', customFreq: 'daily', interval, endless: true }
  }
  if (parts.FREQ === 'MONTHLY') return { preset: 'monthly', endless: true }
  if (parts.FREQ === 'WEEKLY') {
    const isWeekdays = byday.length === 5 && [0, 1, 2, 3, 4].every((i) => byday.includes(i))
    if (isWeekdays && interval === 1) return { preset: 'weekdays', endless: true }
    if (interval !== 1) return { preset: 'custom', customFreq: 'weekly', interval, weekdays: byday, endless: true }
    if (byday.length <= 1) return { preset: 'weekly', weekdays: byday, endless: true }
    return { preset: 'selected_days', weekdays: byday, endless: true }
  }
  return { preset: 'custom', endless: true }
}

/** Human-readable summary, e.g. "Every weekday", "Every Tuesday", "Mon, Wed, Fri". */
export function describeRRule(rule: string, localStartTime?: string): string {
  const p = parseRRule(rule)
  const time = localStartTime ? ` at ${formatWallTime(localStartTime)}` : ''
  let base: string
  switch (p.preset) {
    case 'daily': base = 'Every day'; break
    case 'weekdays': base = 'Every weekday (Mon–Fri)'; break
    case 'monthly': base = 'Monthly'; break
    case 'weekly':
      base = p.weekdays?.length ? `Every ${fullDay(p.weekdays[0])}` : 'Weekly'
      break
    case 'selected_days':
      base = (p.weekdays ?? []).map((i) => WEEKDAY_LABELS[i]).join(', ')
      break
    case 'custom':
      base = p.customFreq === 'weekly'
        ? `Every ${p.interval} weeks on ${(p.weekdays ?? []).map((i) => WEEKDAY_LABELS[i]).join(', ')}`
        : `Every ${p.interval} days`
      break
    default: base = 'Custom'
  }
  return base + time
}

function fullDay(i: number): string {
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]
}

export function formatWallTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// ---- timezone helpers --------------------------------------------------------

// Offset (minutes) of `tz` from UTC at a given UTC instant.
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return (asUTC - utcMs) / 60000
}

/** Wall-clock time in `tz` -> real UTC Date. Handles DST by iterating twice. */
export function wallTimeToUtc(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, mo, d, hh, mm)
  let offset = tzOffsetMinutes(guess, tz)
  let utc = guess - offset * 60000
  // Re-check with the corrected instant (offset can shift across a DST edge).
  offset = tzOffsetMinutes(utc, tz)
  utc = guess - offset * 60000
  return new Date(utc)
}

// ---- occurrence expansion --------------------------------------------------

export interface SeriesArgs {
  recurrenceRule: string
  seriesStartDate: string // 'YYYY-MM-DD'
  localStartTime: string // 'HH:MM'
  durationMinutes: number
  timezone: string
  endType: 'never' | 'until' | 'count'
  until?: string | null // 'YYYY-MM-DD'
  count?: number | null
}

export interface Occurrence {
  date: string // 'YYYY-MM-DD' (the local anchor date)
  startAt: Date
  endAt: Date
}

function buildRRuleObject(args: SeriesArgs): RRule {
  const [sy, sm, sd] = args.seriesStartDate.split('-').map(Number)
  const opts = RRule.parseString(args.recurrenceRule)
  // DTSTART in "floating" UTC — its UTC components are the local wall date.
  opts.dtstart = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0))
  if (args.endType === 'count' && args.count) opts.count = args.count
  if (args.endType === 'until' && args.until) {
    const [uy, um, ud] = args.until.split('-').map(Number)
    opts.until = new Date(Date.UTC(uy, um - 1, ud, 23, 59, 59))
  }
  return new RRule(opts)
}

function toOccurrence(floatingDate: Date, args: SeriesArgs): Occurrence {
  const y = floatingDate.getUTCFullYear()
  const mo = floatingDate.getUTCMonth()
  const d = floatingDate.getUTCDate()
  const [hh, mm] = args.localStartTime.split(':').map(Number)
  const startAt = wallTimeToUtc(y, mo, d, hh, mm, args.timezone)
  const endAt = new Date(startAt.getTime() + args.durationMinutes * 60000)
  const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { date: iso, startAt, endAt }
}

/** Occurrences whose START falls in [rangeStart, rangeEnd). */
export function expandOccurrences(args: SeriesArgs, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const rule = buildRRuleObject(args)
  // Widen the floating-time window by a day each side so tz offsets near the
  // boundary can't drop a valid occurrence.
  const pad = 24 * 60 * 60 * 1000
  const lo = new Date(rangeStart.getTime() - pad)
  const hi = new Date(rangeEnd.getTime() + pad)
  const floatLo = new Date(Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate()))
  const floatHi = new Date(Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), hi.getUTCDate(), 23, 59, 59))
  return rule
    .between(floatLo, floatHi, true)
    .map((fd) => toOccurrence(fd, args))
    .filter((o) => o.startAt >= rangeStart && o.startAt < rangeEnd)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

/** The first occurrence whose END is at or after `from` (i.e. not finished). */
export function nextOccurrence(args: SeriesArgs, from: Date = new Date()): Occurrence | null {
  // Scan forward in ~90-day windows, up to ~3 years, so "never-ending" series
  // still resolve without materializing anything.
  let windowStart = new Date(from.getTime() - args.durationMinutes * 60000)
  for (let i = 0; i < 12; i++) {
    const windowEnd = new Date(windowStart.getTime() + 90 * 24 * 60 * 60 * 1000)
    const hits = expandOccurrences(args, windowStart, windowEnd)
    const live = hits.find((o) => o.endAt >= from)
    if (live) return live
    windowStart = windowEnd
  }
  return null
}
