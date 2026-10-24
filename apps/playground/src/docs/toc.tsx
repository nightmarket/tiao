import { motion } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface TocEntry {
  id: string
  title: string
}

/** below the top of the window, where a heading counts as the one being read */
const READING_LINE = 120

/** input that means the reader is scrolling on their own, not riding a click */
const MANUAL_SCROLL = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const

/**
 * Wraps a page and hands its headings (`data-toc`, set by `Section` and
 * `Reference`) to the table of contents once it has rendered: pages mount
 * after the last one has faded out, so they can't be read any earlier.
 */
export function PageBody({
  onHeadings,
  children,
}: {
  onHeadings: (entries: TocEntry[]) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, when the page mounts
  useLayoutEffect(() => {
    const headings = ref.current?.querySelectorAll<HTMLElement>('[data-toc]') ?? []
    onHeadings(
      Array.from(headings, (heading) => ({
        id: heading.id,
        // the heading's own text, without a badge beside it
        title: heading.firstChild?.textContent?.trim() ?? heading.textContent ?? '',
      })),
    )
  }, [])
  return <div ref={ref}>{children}</div>
}

/**
 * The heading being read: the last one above the reading line, or the last of
 * all at the bottom of the page. A clicked entry holds until the reader scrolls
 * on their own, since a section near the end can't reach the reading line and
 * the scroll to it would land on the last entry instead.
 */
function useCurrentHeading(entries: TocEntry[]): [string | undefined, (id: string) => void] {
  const [current, setCurrent] = useState(entries[0]?.id)
  const chosen = useRef<string | null>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (chosen.current) {
          setCurrent(chosen.current)
          return
        }
        let reading = entries[0]?.id
        for (const entry of entries) {
          const top = document.getElementById(entry.id)?.getBoundingClientRect().top
          if (top !== undefined && top <= READING_LINE) reading = entry.id
        }
        const atBottom =
          window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
        setCurrent(atBottom ? entries.at(-1)?.id : reading)
      })
    }
    const release = () => {
      chosen.current = null
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    for (const type of MANUAL_SCROLL) window.addEventListener(type, release, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      for (const type of MANUAL_SCROLL) window.removeEventListener(type, release)
    }
  }, [entries])
  const choose = (id: string) => {
    chosen.current = id
    setCurrent(id)
  }
  return [current, choose]
}

/** The page's sections and controls; the one being read is marked, and a click scrolls to it. */
export function TableOfContents({ entries }: { entries: TocEntry[] }) {
  const [current, choose] = useCurrentHeading(entries)
  const listRef = useRef<HTMLUListElement>(null)

  // a long list (every control on a page) keeps the current entry in view. The sidebar
  // scrolls itself rather than through scrollIntoView, which would cut off a smooth
  // page scroll still under way
  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-id="${current}"]`)
    const nav = listRef.current?.closest('.docs-nav')
    if (!item || !nav) return
    const box = nav.getBoundingClientRect()
    const rect = item.getBoundingClientRect()
    if (rect.top < box.top) nav.scrollTop -= box.top - rect.top
    else if (rect.bottom > box.bottom) nav.scrollTop += rect.bottom - box.bottom
  }, [current])

  return (
    <ul ref={listRef} aria-label="On this page">
      {entries.map((entry) => (
        <li key={entry.id} className="docs-toc-item" data-id={entry.id}>
          {entry.id === current && (
            <motion.span
              layoutId="docs-toc-current"
              className="docs-toc-bar"
              transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
            />
          )}
          <button
            type="button"
            aria-current={entry.id === current ? 'true' : undefined}
            onClick={() => {
              choose(entry.id)
              document
                .getElementById(entry.id)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {entry.title}
          </button>
        </li>
      ))}
    </ul>
  )
}
