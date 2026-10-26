import { toHash } from '../navigation'
import type { Chapter } from '../navigation'

/**
 * Compact numbered outline. Chapters and their sections are always listed, so the whole structure is visible at once.
 * `activeSection` follows the scroll position inside the open chapter. `onNavigate` runs on every link click.
 */
export function Sidebar({ chapters, activeChapter, activeSection, onNavigate }: {
  chapters: Chapter[]; activeChapter: string; activeSection: string; onNavigate: (hash: string) => void
}) {
  return <nav aria-label="Chapters" className="space-y-1 rounded-2xl bg-surface p-2 shadow-[var(--shadow-sm),var(--inner-highlight)]">
    {chapters.map((chapter, chapterIndex) => {
      const openChapter = chapter.id === activeChapter
      const first = toHash(chapter.id, chapter.sections[0].id)
      return <div key={chapter.id} className={openChapter ? 'rounded-xl bg-paper p-1' : ''}>
        <a href={first} onClick={() => onNavigate(first)} aria-current={openChapter ? 'true' : undefined}
          className={`flex gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition hover:bg-hover hover:text-ink ${openChapter ? 'text-ink' : 'text-ink-muted'}`}>
          <span aria-hidden="true" className="w-4 shrink-0 tabular-nums text-ink-muted">{chapterIndex + 1}</span>
          <span className="min-w-0 text-pretty">{chapter.title}</span>
        </a>
        <ul className="space-y-0.5 pl-3">
          {chapter.sections.map((section, sectionIndex) => {
            const current = openChapter && section.id === activeSection
            const hash = toHash(chapter.id, section.id)
            return <li key={section.id}>
              <a href={hash} onClick={() => onNavigate(hash)} aria-current={current ? 'location' : undefined}
                className={`flex gap-2 rounded-lg px-2.5 py-1.5 text-xs transition hover:bg-hover hover:text-ink ${current ? 'bg-hover-strong text-ink' : 'text-ink-muted'}`}>
                <span aria-hidden="true" className="shrink-0 tabular-nums text-ink-muted">{chapterIndex + 1}.{sectionIndex + 1}</span>
                <span className="min-w-0 text-pretty">{section.title}</span>
              </a>
            </li>
          })}
        </ul>
      </div>
    })}
  </nav>
}
