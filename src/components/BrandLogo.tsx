// The Bizzlivo brand lockup — the "B + bolt" app icon + wordmark (+ optional
// tagline). One component so the logo lives in exactly one place: auth
// screens, the marketing landing, the public quiz page, and the collapsed
// sidebar all render this. The mark is /logo-mark.png (a downscaled copy of
// the master /logo.png); the wordmark inherits `currentColor` so it flips
// with the theme.
export default function BrandLogo({
  size = 26,
  tagline = false,
  markOnly = false,
  className = '',
}: {
  size?: number
  tagline?: boolean
  markOnly?: boolean
  className?: string
}) {
  const mark = (
    <img
      className="bl-mark"
      src="/logo-mark.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )

  if (markOnly) return <span className={`bl ${className}`}>{mark}</span>

  return (
    <span className={`bl ${tagline ? 'bl-stack' : ''} ${className}`}>
      <span className="bl-row">
        {mark}
        <span className="bl-word" style={{ fontSize: size * 0.82 }}>Bizzlivo</span>
      </span>
      {tagline && <span className="bl-tag">Your Business. One Place.</span>}
    </span>
  )
}
