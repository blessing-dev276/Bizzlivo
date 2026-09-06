import type { ReactNode } from 'react'
import { trend, type TrendTone } from '../../lib/reports/range'

export function naira(n: number): string {
  return `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n)}%`
}

// ---- metric card with optional period-over-period trend ----
export function MetricCard({
  label,
  value,
  sub,
  current,
  previous,
  higherIsBetter = true,
  onClick,
  loading,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  current?: number
  previous?: number
  higherIsBetter?: boolean
  onClick?: () => void
  loading?: boolean
}) {
  const t = current != null && previous != null ? trend(current, previous, higherIsBetter) : null
  return (
    <button
      type="button"
      className={`rp-metric${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="rp-metric-label">{label}</span>
      <span className="rp-metric-value">{loading ? <span className="rp-sk rp-sk-lg" /> : value}</span>
      <span className="rp-metric-sub">
        {loading ? (
          <span className="rp-sk" />
        ) : t && t.pct != null ? (
          <span className={`rp-trend ${t.tone}`}>
            {t.dir === 'up' ? '↑' : t.dir === 'down' ? '↓' : '—'} {Math.abs(t.pct)}%{sub ? ` · ${sub}` : ''}
          </span>
        ) : (
          sub ?? ' '
        )}
      </span>
    </button>
  )
}

export function ReportSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rp-section">
      <div className="rp-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ text, cta }: { text: string; cta?: ReactNode }) {
  return (
    <div className="rp-empty">
      <p>{text}</p>
      {cta}
    </div>
  )
}

export function SectionError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="rp-error">
      <p>This section could not be loaded.</p>
      {message && <code className="rp-error-msg">{message}</code>}
      <button type="button" className="rp-btn ghost sm" onClick={onRetry}>Retry</button>
    </div>
  )
}

// ---- horizontal bar list (rank distribution, area completion, sources) ----
export function BarList({
  rows,
  max,
  fmt,
  tone,
}: {
  rows: { label: string; value: number }[]
  max?: number
  fmt?: (v: number) => string
  tone?: TrendTone
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="rp-bars">
      {rows.map((r) => (
        <div className="rp-bar-row" key={r.label}>
          <span className="rp-bar-label">{r.label}</span>
          <span className="rp-bar-track">
            <span
              className={`rp-bar-fill${tone ? ` ${tone}` : ''}`}
              style={{ width: `${(r.value / top) * 100}%` }}
            />
          </span>
          <span className="rp-bar-val">{fmt ? fmt(r.value) : r.value}</span>
        </div>
      ))}
    </div>
  )
}

// ---- tiny inline-SVG line/area chart for real time series ----
export function Sparkline({
  points,
  height = 160,
}: {
  points: { x: number; y: number; label: string }[]
  height?: number
}) {
  if (points.length < 2) {
    return <div className="rp-chart-empty">Not enough data in this period to chart.</div>
  }
  const w = 640
  const pad = 24
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const maxY = Math.max(1, ...ys)
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (w - pad * 2)
  const sy = (y: number) => height - pad - (y / maxY) * (height - pad * 2)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ')
  const area = `${line} L ${sx(maxX).toFixed(1)} ${height - pad} L ${sx(minX).toFixed(1)} ${height - pad} Z`
  return (
    <div className="rp-chart">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img">
        <path d={area} className="rp-chart-area" />
        <path d={line} className="rp-chart-line" fill="none" />
      </svg>
      <div className="rp-chart-axis">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  )
}
