import { Pane } from '@nightmarket/tiao/core'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  createHighlighterCoreSync,
  type LanguageRegistration,
  type ShikiTransformer,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import shellscript from 'shiki/langs/shellscript.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import { Link } from '../router'
import { neon } from './neon'

/**
 * The grammar editors use (TextMate), so JSX, types, and template strings
 * highlight as they would there. Built synchronously with the JavaScript
 * engine (no WebAssembly), with TSX and the shell for the install commands,
 * so most code never shows plain first.
 */
const highlighter = createHighlighterCoreSync({
  themes: [neon],
  langs: [tsx, shellscript],
  engine: createJavaScriptRegexEngine(),
})

/** `text` is built into Shiki, so plain files like AGENTS.md cost no grammar */
type Lang = 'tsx' | 'shellscript' | 'text' | 'svelte' | 'vue'

/** single-file components embed HTML, CSS, and TypeScript grammars, so they load on first use */
const LAZY_GRAMMARS: Partial<Record<Lang, () => Promise<{ default: LanguageRegistration[] }>>> = {
  svelte: () => import('shiki/langs/svelte.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
}
const grammars = new Map<Lang, Promise<void>>()

const hasGrammar = (lang: Lang) =>
  !(lang in LAZY_GRAMMARS) || highlighter.getLoadedLanguages().includes(lang)

function loadGrammar(lang: Lang): Promise<void> {
  const load = LAZY_GRAMMARS[lang]
  if (!load) return Promise.resolve()
  let loading = grammars.get(lang)
  if (!loading) {
    loading = load().then((grammar) => highlighter.loadLanguageSync(grammar.default))
    grammars.set(lang, loading)
  }
  return loading
}

/** Drops the theme's background, so code sits on the docs' own surface. */
const keepSurface: ShikiTransformer = {
  pre(node) {
    const style = node.properties.style
    if (typeof style === 'string')
      node.properties.style = style.replace(/background-color:[^;]*;?/, '')
  },
}

/** A heading's id, from its text, for the table of contents to link to. */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** marks a link that leaves the docs */
export function ArrowUpRight() {
  return (
    <svg className="docs-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  )
}

/** Lucide's mouse-pointer-2, for the cursor that tours the landing demo */
export function CursorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
    </svg>
  )
}

/** the tiao mark and name, linking home, with the version unless `version` is false */
export function Logo({ version = true }: { version?: boolean }) {
  return (
    <Link className="docs-logo" href="/">
      <img src="/favicon.svg" alt="" />
      tiao
      {version && <span className="docs-version">{__TIAO_VERSION__}</span>}
    </Link>
  )
}

/** GitHub's mark, from Simple Icons */
export function GitHubIcon() {
  return (
    <svg className="docs-brand" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3" />
    </svg>
  )
}

/** npm's mark, from Simple Icons */
export function NpmIcon() {
  return (
    <svg className="docs-brand" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1.76 0A1.76 1.76 0 0 0 0 1.76v20.48C0 23.21.79 24 1.76 24h20.48c.97 0 1.76-.79 1.76-1.76V1.76C24 .79 23.21 0 22.24 0zm3.37 5.32 13.84.02-.01 13.84h-3.46l.01-10.39H12.05l-.01 10.38H5.11z" />
    </svg>
  )
}

/** how long the copy button shows its check */
const COPIED_MS = 1200

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <button type="button" className="docs-copy" aria-label={label} onClick={copy}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="8" y="8" width="13" height="13" rx="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </>
        )}
      </svg>
    </button>
  )
}

interface CodeProps {
  children: string
  lang?: Lang
  /** a file name for a header bar, which keeps the copy button in view */
  title?: string
}

export function Code({ children, lang = 'tsx', title }: CodeProps) {
  const ready = hasGrammar(lang)
  const [, setLoaded] = useState<Lang | null>(null)
  useEffect(() => {
    if (!ready) void loadGrammar(lang).then(() => setLoaded(lang))
  }, [lang, ready])
  const html = useMemo(
    () =>
      highlighter.codeToHtml(children, {
        lang: ready ? lang : 'text',
        theme: 'neon',
        transformers: [keepSurface],
      }),
    [children, lang, ready],
  )
  return (
    <div className="docs-code">
      {title && (
        <div className="docs-code-title">
          {title}
          <CopyButton text={children} label={`Copy ${title}`} />
        </div>
      )}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes the source it highlights */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {!title && <CopyButton text={children} label="Copy code" />}
    </div>
  )
}

/** One line of code in its colors, for code set in a sentence or a box rather than a block. */
export function Highlight({ code, lang }: { code: string; lang: Lang }) {
  const tokens = useMemo(
    () =>
      highlighter.codeToTokensBase(code, { lang: hasGrammar(lang) ? lang : 'text', theme: 'neon' }),
    [code, lang],
  )
  return tokens.flat().map((token) => (
    <span key={token.offset} style={{ color: token.color }}>
      {token.content}
    </span>
  ))
}

/** quick and critically damped, so pills and boxes settle without bouncing */
export const TAB_SPRING = { type: 'spring', duration: 0.35, bounce: 0 } as const

interface TabsProps<T extends string> {
  tabs: readonly T[]
  current: T
  onSelect(tab: NoInfer<T>): void
  label: string
}

/** A row of tabs; the selected one's pill slides between them. */
export function Tabs<T extends string>({ tabs, current, onSelect, label }: TabsProps<T>) {
  const pill = useId()
  return (
    <div className="docs-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === current}
          onClick={() => onSelect(tab)}
        >
          {tab === current && (
            <motion.span
              layoutId={pill}
              className="docs-tab-bg"
              style={{ borderRadius: 6 }}
              transition={TAB_SPRING}
            />
          )}
          <span className="docs-tab-label">{tab}</span>
        </button>
      ))}
    </div>
  )
}

export interface CodeFile {
  name: string
  lang: Lang
  code: string
}

/** The same code in each framework, a tab apiece. */
export function CodeTabs({ files, label }: { files: readonly CodeFile[]; label: string }) {
  const [current, setCurrent] = useState(files[0]!.name)
  // the grammars land before a tab is picked
  useEffect(() => {
    for (const file of files) void loadGrammar(file.lang)
  }, [files])
  const file = files.find((f) => f.name === current) ?? files[0]!
  return (
    <div className="docs-code-tabs">
      <Tabs tabs={files.map((f) => f.name)} current={current} onSelect={setCurrent} label={label} />
      <Code lang={file.lang}>{file.code}</Code>
    </div>
  )
}

/** the stroked traffic lights in a window frame's top margin */
export function WindowLights() {
  return (
    <div className="docs-window-lights" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

interface DemoProps {
  /** so the rows join the TT search and keep their values across reloads */
  paneId: string
  title: string
  /** keep it stable: a new function rebuilds the pane */
  build: (pane: Pane) => void
}

/** A live inline pane. */
export function Demo({ paneId, title, build }: DemoProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const pane = new Pane({ id: paneId, title, container: ref.current! })
    build(pane)
    return () => pane.dispose()
  }, [paneId, title, build])
  return <div ref={ref} className="docs-demo" />
}

interface DemoWindowProps {
  /** the tiao the window holds; its pane takes the same id */
  namespace: string
  title: string
  /** keep it stable: a new function rebuilds the pane */
  build: (pane: Pane) => void
}

/**
 * A live pane floating in a mini window: a namespace of its own rooted in the
 * view, so the pane drags around inside it, and its notch tucks behind the
 * window's top edge until the pointer comes near, which the hint asks for.
 */
export function DemoWindow({ namespace, title, build }: DemoWindowProps) {
  const viewRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const release = Pane.namespace(namespace, { root: viewRef.current!, hiding: true })
    const pane = new Pane({ id: namespace, namespace, title, anchor: 'center' })
    build(pane)
    return () => {
      pane.dispose()
      release()
    }
  }, [namespace, title, build])
  return (
    <figure className="docs-window">
      <WindowLights />
      <div ref={viewRef} className="docs-window-view">
        <div className="docs-window-screen docs-demo-screen" />
        <span className="docs-window-hint" aria-hidden="true">
          Hover me
        </span>
      </div>
    </figure>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="docs-section">
      <h2 id={slugify(title)} data-toc="">
        {title}
      </h2>
      {children}
    </section>
  )
}

export interface ReferenceProps {
  name: string
  /** the value the control binds, shown as a badge */
  type: string
  about: ReactNode
  code: string
  /** runs `code` for the live pane */
  build: (pane: Pane) => void
}

/** One control: what it does beside a live pane, then the code that pane runs. */
export function Reference({ name, type, about, code, build }: ReferenceProps) {
  return (
    <article className="docs-reference">
      <div className="docs-reference-text">
        <h3 id={slugify(name)} data-toc="">
          {name}
          <span className="docs-badge">{type}</span>
        </h3>
        <p>{about}</p>
      </div>
      <Demo paneId={`docs-${slugify(name)}`} title={name} build={build} />
      <Code>{code}</Code>
    </article>
  )
}
