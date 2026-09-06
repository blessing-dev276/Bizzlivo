import { useId } from 'react'

// The Bizzlivo brand lockup — gradient "B" mark + wordmark (+ optional
// tagline). One component so the logo lives in exactly one place: auth
// screens, the marketing landing, the public exam page, and the collapsed
// sidebar all render this. Colours track the app's blue→teal gradient
// tokens; the wordmark inherits `currentColor` so it flips with the theme.
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
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gid}g`} x1="4" y1="38" x2="34" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#19c37d" />
          <stop offset="0.5" stopColor="#17c3c9" />
          <stop offset="1" stopColor="#2f6bf0" />
        </linearGradient>
      </defs>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={`url(#${gid}g)`}
        d="M8 4h15c6.5 0 10 3.4 10 8.8 0 3.7-1.9 6.3-5.4 7.4 4.1.9 6.6 3.8 6.6 8.2C42.8 42 33.9 42 24 42H8V4Zm7 7v7h7c3.4 0 5.2-1.3 5.2-3.6C27.2 12.2 25.4 11 22 11h-7Zm0 13v6h8c3.6 0 5.4-1 5.4-3S28 24 24 24h-9Z"
        transform="scale(0.9) translate(2 0)"
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
