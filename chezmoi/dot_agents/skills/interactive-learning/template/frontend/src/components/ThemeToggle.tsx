import { useTheme } from '../lib/theme'

/** Fixed icon-only light/dark button. The label names the action, so it reads "Switch to dark mode" while the page is light. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return <button type="button" onClick={toggle} aria-label={label} title={label}
    className="fixed top-4 right-4 z-50 grid size-10 place-items-center rounded-full bg-surface text-ink-muted opacity-0 shadow-[var(--shadow-sm),var(--inner-highlight)] transition hover:bg-surface-elevated hover:text-ink hover:opacity-100 focus-visible:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-muted sm:top-6 sm:right-6">
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {theme === 'dark'
        ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>
        : <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />}
    </svg>
  </button>
}
