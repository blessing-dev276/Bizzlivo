import { useId } from 'react'

// The Bizzlivo brand lockup — the gradient "B + bolt" mark + wordmark
// (+ optional tagline). One component so the logo lives in exactly one
// place: auth screens, the marketing landing, the public quiz page, and
// the collapsed sidebar all render this. The mark matches the app icon /
// favicon; the wordmark inherits `currentColor` so it flips with the theme.
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
  const gid = useId().replace(/:/g, '')

  const mark = (
    <svg
      className="bl-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gid}b`} x1="10" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f6bf0" />
          <stop offset="1" stopColor="#17c9c3" />
        </linearGradient>
        <linearGradient id={`${gid}z`} x1="8" y1="10" x2="28" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#19d08a" />
          <stop offset="1" stopColor="#14b9c0" />
        </linearGradient>
      </defs>
      {/* B */}
      <path
        fill={`url(#${gid}b)`}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 5h15.5c6.9 0 10.7 3.6 10.7 9.2 0 3.9-2 6.6-5.7 7.7 4.3 1 6.9 4 6.9 8.6C43.3 44 33.9 44 23.5 44H10V5Zm7.4 7.3v7.4h7.4c3.6 0 5.5-1.4 5.5-3.8 0-2.5-1.9-3.6-5.5-3.6h-7.4Zm0 13.6v6.4h8.4c3.8 0 5.7-1.1 5.7-3.2 0-2.1-2-3.2-6-3.2h-8.1Z"
      />
      {/* bolt */}
      <path
        fill={`url(#${gid}z)`}
        d="M12.5 11h16.8L16.9 23.6h10.4L12 38.5l5.6-15.1H8.7L12.5 11Z"
      />
    </svg>
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
