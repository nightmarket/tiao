import { setTiaoStorage } from '@nightmarket/tiao/core'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { type ComponentType, useEffect, useLayoutEffect, useState } from 'react'
import './docs.css'
import { Link } from '../router'
import { Agents } from './pages/agents'
import { Controls } from './pages/controls'
import { Overview, OverviewStage } from './pages/overview'
import { Panes } from './pages/panes'
import { Plugins } from './pages/plugins'
import { Production } from './pages/production'
import { ReactPage } from './pages/react'
import { PageBody, TableOfContents, type TocEntry } from './toc'
import { ArrowUpRight, GitHubIcon, Logo, NpmIcon } from './ui'

interface DocPage {
  /** the path; '' is the landing page */
  slug: string
  title: string
  Component: ComponentType
  /** a demo across the full width of the layout, above the sidebar and the page */
  Stage?: ComponentType
}

const PAGES: DocPage[] = [
  { slug: '', title: 'Overview', Component: Overview, Stage: OverviewStage },
  { slug: 'controls', title: 'Controls', Component: Controls },
  { slug: 'panes', title: 'Panes', Component: Panes },
  { slug: 'plugins', title: 'Plugins', Component: Plugins },
  { slug: 'react', title: 'React', Component: ReactPage },
  { slug: 'production', title: 'Production', Component: Production },
  { slug: 'agents', title: 'Agents', Component: Agents },
]

const LINKS = [
  { title: 'GitHub', href: 'https://github.com/nightmarket/tiao', Icon: GitHubIcon },
  { title: 'npm', href: 'https://www.npmjs.com/package/@nightmarket/tiao', Icon: NpmIcon },
]

/** GitHub and npm, in the sidebar and the page's top right corner */
function OutboundLinks() {
  return LINKS.map((link) => (
    <li key={link.title}>
      <a href={link.href} target="_blank" rel="noreferrer">
        <link.Icon />
        {link.title}
        <ArrowUpRight />
      </a>
    </li>
  ))
}

/** Pages drift up into place and away, a little blurred on the way. */
const PAGE_MOTION = {
  initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, y: -8, filter: 'blur(2px)', transition: { duration: 0.16, ease: 'easeIn' } },
} as const

/** The page's contents unfold under its link and fold away when you leave. */
const TOC_MOTION = {
  initial: { height: 0, opacity: 0 },
  animate: {
    height: 'auto',
    opacity: 1,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } },
} as const

export function Docs({ slug }: { slug: string }) {
  const page = PAGES.find((p) => p.slug === slug) ?? PAGES[0]!
  const [toc, setToc] = useState<{ slug: string; entries: TocEntry[] } | null>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // every visit starts from the code; a layout effect, so it lands before the demos mount their panes
  useLayoutEffect(() => {
    setTiaoStorage(false)
    return () => setTiaoStorage(true)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="docs">
        <ul className="docs-corner">
          <OutboundLinks />
        </ul>
        {page.Stage && (
          <section className="docs-stage" aria-label="Demo">
            <page.Stage />
          </section>
        )}
        <aside className="docs-nav">
          <Logo />
          <nav aria-label="Documentation">
            <ul>
              {PAGES.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${p.slug}`} aria-current={p === page ? 'page' : undefined}>
                    {p.title}
                  </Link>
                  <AnimatePresence initial={false}>
                    {p === page && toc?.slug === p.slug && toc.entries.length > 0 && (
                      <motion.div key={p.slug} className="docs-toc" {...TOC_MOTION}>
                        <TableOfContents entries={toc.entries} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              ))}
            </ul>
            <ul className="docs-nav-group">
              <li>
                <Link href="/examples/showcase">
                  Examples
                  <ArrowUpRight />
                </Link>
              </li>
            </ul>
            <ul className="docs-nav-group">
              <OutboundLinks />
            </ul>
          </nav>
        </aside>
        <main className="docs-main">
          {/* The next page waits for this one to go, then starts at the top. */}
          <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
            <motion.div key={page.slug} {...PAGE_MOTION}>
              <PageBody onHeadings={(entries) => setToc({ slug: page.slug, entries })}>
                <page.Component />
              </PageBody>
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="docs-footer">
          Made by{' '}
          <a href="https://changliu.io" target="_blank" rel="noreferrer">
            Chang Liu
          </a>
        </footer>
      </div>
    </MotionConfig>
  )
}
