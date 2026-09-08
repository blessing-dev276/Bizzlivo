import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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

function applyThemeDom(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_BG[theme])
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    applyThemeDom(theme)
  }, [theme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    toggleTheme() {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      const root = document.documentElement
      // Kill every CSS transition for the duration of the swap so the
      // whole page recolours in a single paint instead of dozens of
      // elements each animating their border/background/color.
      root.classList.add('theme-switching')
      applyThemeDom(next)          // instant DOM flip, before React re-renders
      setTheme(next)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.remove('theme-switching'))
      })
    },
  }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
