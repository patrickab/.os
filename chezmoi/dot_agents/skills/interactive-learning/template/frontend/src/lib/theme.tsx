import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** Keep the key in sync with the inline script in index.html. */
const STORAGE_KEY = 'interactive-learning-theme'
const THEME_COLOR = { light: '#f5eee0', dark: '#161410' }

type Theme = 'light' | 'dark'
type Preference = 'system' | Theme
type ThemeState = { theme: Theme; toggle: () => void }
const ThemeContext = createContext<ThemeState | null>(null)

/** Saved choice wins, otherwise follow the system. The saved choice is only written after the user picks one. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(() => {
    const saved = document.documentElement.dataset.themePreference
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const theme: Theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.themePreference = preference
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = THEME_COLOR[theme]
  }, [theme, preference])

  const value = useMemo<ThemeState>(() => {
    const toggle = () => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      setPreference(next)
      try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Keep the in-memory preference when storage is unavailable. */ }
    }
    return { theme, toggle }
  }, [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const state = useContext(ThemeContext)
  if (!state) throw new Error('ThemeProvider is required')
  return state
}
