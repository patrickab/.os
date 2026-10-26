import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

export type Section = { id: string; title: string; summary: string; content: ReactNode }
export type Chapter = { id: string; title: string; sections: Section[] }
export type Place = { chapter: Chapter; section: Section; hash: string }
/** Pages with more than one entry show page tabs above the chapter. */
export type Page = { id: string; title: string; chapters: Chapter[] }
/** A lesson is one self-contained app topic. More than one lesson shows a lesson picker. */
export type Lesson = { id: string; title: string; description: string; pages: Page[] }

export const toHash = (chapterId: string, sectionId: string) => `#${chapterId}/${sectionId}`

const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify)
  return () => window.removeEventListener('hashchange', notify)
}

/** Current `location.hash`. Back and forward buttons fire `hashchange`, so they need no extra handling. */
export function useHash() {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => '')
}

/** Map `#chapter/section` to metadata. A missing or unknown part falls back to the first entry. */
export function resolvePlace(hash: string, chapters: Chapter[]): Place {
  let path = hash.replace(/^#\/?/, '')
  try { path = decodeURIComponent(path) } catch { /* Malformed escapes fall through to the default place. */ }
  const [chapterId, sectionId] = path.split('/')
  const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0]
  const section = chapter.sections.find((item) => item.id === sectionId) ?? chapter.sections[0]
  return { chapter, section, hash: toHash(chapter.id, section.id) }
}
