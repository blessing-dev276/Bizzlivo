import { useState } from 'react'

export function timeOfDayGreeting(date: Date) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function initialsOf(name: string | null | undefined) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0]?.toUpperCase() || '?'
}

// Relative "in N days" / "today" / "tomorrow" for a future date.
export function untilLabel(iso: string): string {
  const start = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d0 = new Date(start)
  d0.setHours(0, 0, 0, 0)
  const days = Math.round((d0.getTime() - today.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  if (days < 14) return 'Next week'
  return `In ${Math.round(days / 7)} weeks`
}

const OFFICE_URL_ROOT_DOMAIN = 'bizzlivo.com'

export function OfficeLoginLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const url = `https://${slug}.${OFFICE_URL_ROOT_DOMAIN}`

  function copy() {
    navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span className="dash-pill">
      <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
      <code>{url}</code>
      <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  )
}

export function Skeleton({ w = '100%', h = 14, style }: { w?: string | number; h?: string | number; style?: React.CSSProperties }) {
  return <span className="sk" style={{ width: w, height: h, ...style }} aria-hidden />
}
