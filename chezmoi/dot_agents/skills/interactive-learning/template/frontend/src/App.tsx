import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { APP_TITLE, lessons } from './lessons'
import { Disclosure } from './components/ui'
import { Sidebar } from './components/Sidebar'
import { ThemeToggle } from './components/ThemeToggle'
import { resolvePlace, toHash, useHash } from './navigation'

const sectionDomId = (chapterId: string, sectionId: string) => `${chapterId}/${sectionId}`
const allChapters = lessons.flatMap((lesson) => lesson.pages.flatMap((page) => page.chapters))

/** Shared shell: content comes only from `lessons.tsx`. */
export default function App() {
  const place = resolvePlace(useHash(), allChapters)
  const lesson = lessons.find((item) => item.pages.some((page) => page.chapters.includes(place.chapter)))!
  const page = lesson.pages.find((item) => item.chapters.includes(place.chapter))!
  const [navOpen, setNavOpen] = useState(false)
  // Chapters mount on first visit and stay mounted, so sliders, requests and disclosures keep their state.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([place.chapter.id]))
  // Section nearest the top of the viewport, drives the sidebar highlight while reading.
  const [reading, setReading] = useState<{ hash: string; section: string }>({ hash: place.hash, section: place.section.id })
  // Bumped when a link to the current hash is clicked, so the scroll runs even though `hashchange` does not fire.
  const [nudge, setNudge] = useState(0)
  const menuButton = useRef<HTMLButtonElement>(null)
  const firstRun = useRef(true)

  // Normalise `#`, `#chapter` and unknown hashes to a full address without adding a history entry.
  useEffect(() => {
    if (window.location.hash !== place.hash) history.replaceState(null, '', place.hash)
  }, [place.hash])

  useEffect(() => {
    setVisited((current) => (current.has(place.chapter.id) ? current : new Set(current).add(place.chapter.id)))
    document.title = `${place.section.title} · ${place.chapter.title} · ${APP_TITLE}`
  }, [place.chapter.id, place.chapter.title, place.section.title])

  // Scroll to the addressed section and move focus to its heading. The first load only scrolls to a deep link.
  useEffect(() => {
    setReading({ hash: place.hash, section: place.section.id })
    const heading = document.getElementById(sectionDomId(place.chapter.id, place.section.id))
    const isFirst = firstRun.current
    firstRun.current = false
    const firstSection = place.chapter.sections[0].id === place.section.id
    if (!heading) return
    if (firstSection) {
      if (!isFirst) {
        window.scrollTo(0, 0)
        heading.focus({ preventScroll: true })
      }
      return
    }
    heading.scrollIntoView({ block: 'start' })
    heading.focus({ preventScroll: true })
  }, [place.hash, place.chapter, place.section.id, nudge])

  // Track which section heading was passed last, for the sidebar highlight.
  useEffect(() => {
    const ids = place.chapter.sections.map((section) => section.id)
    const update = () => {
      let current = ids[0]
      for (const id of ids) {
        const element = document.getElementById(sectionDomId(place.chapter.id, id))
        if (element && element.getBoundingClientRect().top <= window.innerHeight * 0.35) current = id
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      if (atEnd && window.scrollY > 0) current = ids[ids.length - 1]
      setReading((value) => (value.section === current ? value : { hash: value.hash, section: current }))
    }
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [place.chapter])

  const closeNav = () => { setNavOpen(false); menuButton.current?.focus() }
  const handleNavigationKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && navOpen) {
      event.stopPropagation()
      closeNav()
    }
  }

  return <div className="min-h-screen bg-paper font-sans text-ink antialiased md:flex md:gap-6 md:p-6">
    <a href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}
      className="fixed top-2 left-2 z-50 -translate-y-16 rounded-lg bg-surface-elevated px-4 py-2 text-sm shadow-[var(--shadow-sm)] focus:translate-y-0">
      Skip to content
    </a>
    <ThemeToggle />

    <header onKeyDown={handleNavigationKey} className="sticky top-0 z-30 flex items-center gap-3 bg-paper py-2 pr-14 pl-4 shadow-[0_1px_0_var(--divider-soft)] md:hidden">
      <button ref={menuButton} type="button" aria-expanded={navOpen} aria-controls="chapter-nav" onClick={() => setNavOpen((value) => !value)}
        className="rounded-lg bg-hover-strong px-3 py-1.5 text-xs">
        {navOpen ? 'Close' : 'Chapters'}
      </button>
      <span className="min-w-0 truncate text-sm font-medium">{APP_TITLE}</span>
    </header>

    <aside id="chapter-nav" onKeyDown={handleNavigationKey}
      className={`z-20 shrink-0 md:sticky md:top-6 md:block md:h-[calc(100vh-3rem)] md:w-72 md:overflow-y-auto max-md:sticky max-md:top-[3.25rem] max-md:max-h-[calc(100vh-3.25rem)] max-md:overflow-y-auto max-md:bg-paper ${navOpen ? '' : 'max-md:hidden'}`}>
      <div className="space-y-5 max-md:p-4">
        <p className="px-1 text-2xl font-semibold tracking-tight max-md:hidden">{APP_TITLE}</p>
        {lessons.length > 1 && <Disclosure key={lesson.id} label={lesson.title} className="mb-4">
          <nav aria-label="Lessons" className="space-y-3">
            {lessons.map((item) => {
              const first = item.pages[0].chapters[0]
              return <a key={item.id} href={toHash(first.id, first.sections[0].id)} onClick={() => setNavOpen(false)}
                aria-current={item.id === lesson.id ? 'true' : undefined} className="block rounded-lg py-1 text-sm hover:underline">
                <span className="block font-medium">{item.title}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
              </a>
            })}
          </nav>
        </Disclosure>}
        <Sidebar chapters={page.chapters} activeChapter={place.chapter.id}
          activeSection={reading.hash === place.hash ? reading.section : place.section.id}
          onNavigate={(hash) => { setNavOpen(false); if (hash === window.location.hash) setNudge((value) => value + 1) }} />
      </div>
    </aside>

    <main className="min-w-0 flex-1 px-4 pt-6 pb-24 md:px-0 md:pt-0">
      {lesson.pages.length > 1 && <div className="mb-8 space-y-3">
        <p className="text-sm text-ink-muted">{lesson.title}</p>
        <nav aria-label="Pages" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-divider-soft text-sm">
          {lesson.pages.map((item) => {
            const first = item.chapters[0]
            return <a key={item.id} href={toHash(first.id, first.sections[0].id)}
              aria-current={item.id === page.id ? 'page' : undefined}
              className={`border-b-2 pb-2 ${item.id === page.id ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              {item.title}
            </a>
          })}
        </nav>
      </div>}
      {allChapters.map((chapter) => (visited.has(chapter.id) || chapter.id === place.chapter.id) && <div key={chapter.id} hidden={chapter.id !== place.chapter.id}>
        <h1 id={chapter.id === place.chapter.id ? 'main-content' : undefined} tabIndex={-1} className="text-3xl font-semibold tracking-tight text-balance outline-none">{chapter.title}</h1>
        {chapter.sections.map((section) => <section key={section.id} aria-labelledby={sectionDomId(chapter.id, section.id)} className="mt-10 space-y-5">
          <div>
            <h2 id={sectionDomId(chapter.id, section.id)} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">{section.title}</h2>
            <p className="mt-1 max-w-prose text-sm text-ink-muted text-pretty">{section.summary}</p>
          </div>
          {section.content}
        </section>)}
      </div>)}
    </main>
  </div>
}
