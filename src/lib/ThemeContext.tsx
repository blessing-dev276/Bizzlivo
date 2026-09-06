import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

const THEME_KEY = 'bizzlivo-theme'
// One-time carry-over from the pre-rename key so a user's theme choice sticks.
try {
  const legacy = localStorage.getItem('hq360-theme')
  if (legacy && !localStorage.getItem(THEME_KEY)) localStorage.setItem(THEME_KEY, legacy)
} catch { /* ignore */ }

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

// Dark is the primary theme for the whole app. The OS `prefers-color-scheme`
// is deliberately ignored — light mode is opt-in via the in-app toggle only.
const THEME_BG: Record<Theme, string> = { dark: '#0a0d12', light: '#f3f4f6' }

function readInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
    // Keep the browser/OS chrome (mobile status bar, desktop title bar,
    // PWA surfaces) in sync with the active theme.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_BG[theme])
  }, [theme])

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
