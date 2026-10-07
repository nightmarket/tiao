import {
  type BindingApi,
  type BladeHost,
  bindingAt,
  Container,
  FolderApi,
  markPointerBlur,
  revealOverridden,
  TabApi,
  walkBindings,
} from './blade'
import { installCaret } from './controls/caret'
import { ensureBuiltins } from './controls/index'
import {
  closeDock,
  type DockHost,
  type DockState,
  dockBody,
  dockRoot,
  ensureDock,
  readDockState,
  setDockVisible,
  writeDockState,
} from './dock'
import { collapseSelection, draggable, gearIcon, h, icon, searchIcon, withDocument } from './dom'
import { ValueHistory } from './history'
import { createNotch, type Notch } from './notch'
import { createPaneMenu } from './pane-menu'
import { globalRegistry, PluginRegistry, type TiaoPlugin } from './plugin'
import { openRowToolbar } from './row-toolbar'
import { injectStyles } from './styles'
import { tooltip } from './tooltip'
import { clamp, isRecord, type JSONStore, jsonStore } from './util'
import { createValueStore, sameShape, type ValueStore } from './values'

export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'left-center'
  | 'center'
  | 'right-center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface PaneOptions {
  /** stable id: enables Pane.get() lookup and position persistence */
  id?: string
  title?: string
  /** render inline inside this element instead of floating */
  container?: HTMLElement
  anchor?: Anchor
  /** offset in px from the anchored edge(s) */
  margin?: number
  /** sidebar position, z-index style: lower sorts first, ties keep creation order */
  order?: number
  /** floating panes are draggable by default (toggleable from the pane menu) */
  draggable?: boolean
  expanded?: boolean
  hidden?: boolean
  /** keyboard shortcut that toggles visibility, e.g. '`' */
  toggleKey?: string
  /** persist position/expanded/anchor to localStorage (requires id; default true) */
  storage?: boolean
  /** max pane height in px before the content scrolls (default 500) */
  maxHeight?: number
  /** CSS custom property overrides, e.g. { '--tiao-accent': '#f0f' } */
  theme?: Record<string, string>
  /** overall scale: fonts, control heights, spacing, and width (default 'm') */
  size?: PaneSize
  /** surface style: bouba (rounded, soft shadow) or kiki (sharp, hairline) */
  style?: PaneStyle
  width?: number
  document?: Document
  /** internal: set false to omit the settings menu (used by the menu's own pane) */
  menu?: boolean
  /** set false to keep this pane from mounting the global notch bar */
  notch?: boolean
}

/** explicit `undefined` clears a key on save (JSON.stringify drops it) */
interface PersistedState {
  x?: number | undefined
  y?: number | undefined
  expanded?: boolean | undefined
  anchor?: Anchor | undefined
  draggable?: boolean | undefined
  theme?: PaneTheme | undefined
  style?: PaneStyle | undefined
  accent?: string | undefined
  /** width / max-height set by edge-resizing */
  w?: number | undefined
  hMax?: number | undefined
  /** section numbering on folder titles */
  numbers?: boolean | undefined
}

export type PaneTheme = 'system' | 'light' | 'dark' | 'solarized' | 'nord' | 'catppuccin'

/** themes that map 1:1 onto a CSS class; system resolves to light or dark */
type ResolvedTheme = Exclude<PaneTheme, 'system'>

/** CSS class for each resolved theme; light uses no theme class (base tokens). */
const THEME_CLASS: Record<ResolvedTheme, string | null> = {
  light: null,
  dark: 'tiao-theme-dark',
  solarized: 'tiao-theme-solarized',
  nord: 'tiao-theme-nord',
  catppuccin: 'tiao-theme-catppuccin',
}
const THEME_CLASSES = Object.values(THEME_CLASS).filter((cls): cls is string => Boolean(cls))

/** whether the OS is in dark mode; default dark when matchMedia is unavailable */
function prefersDark(doc: Document = document): boolean {
  return doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

function resolveTheme(theme: PaneTheme, doc: Document = document): ResolvedTheme {
  if (theme === 'system') return prefersDark(doc) ? 'dark' : 'light'
  return theme
}

/** one media-query listener per document; re-paints every element on system */
const schemeWatch = new WeakMap<Document, { mql: MediaQueryList; onChange: () => void }>()

function watchColorScheme(doc: Document): void {
  const mql = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mql) return
  const existing = schemeWatch.get(doc)
  if (existing?.mql === mql) return
  if (existing) existing.mql.removeEventListener('change', existing.onChange)
  const onChange = () => {
    for (const el of doc.querySelectorAll('[data-tiao-theme="system"]')) {
      if (el instanceof HTMLElement) applyThemeClass(el, 'system')
    }
  }
  mql.addEventListener('change', onChange)
  schemeWatch.set(doc, { mql, onChange })
}

function releaseColorScheme(doc: Document): void {
  const existing = schemeWatch.get(doc)
  if (!existing) return
  existing.mql.removeEventListener('change', existing.onChange)
  schemeWatch.delete(doc)
}

/** Surface style (shape/elevation) — orthogonal to PaneTheme colors. */
export type PaneStyle = 'bouba' | 'kiki'

const STYLE_CLASS: Record<PaneStyle, string | null> = {
  bouba: null,
  kiki: 'tiao-style-kiki',
}
const STYLE_CLASSES = Object.values(STYLE_CLASS).filter((cls): cls is string => Boolean(cls))

/** Map legacy persisted ids onto the bouba/kiki axis. */
function normalizeStyle(v: string | undefined | null): PaneStyle {
  if (v === 'kiki' || v === 'arena') return 'kiki'
  return 'bouba' // includes 'default', 'bouba', missing
}

export type PaneSize = 's' | 'm' | 'l'

/** row padding around controls; S is the default this library ships */
export type PaneSpacing = 's' | 'm' | 'l'

/**
 * How big every floating pane draws, set once for all of them from the notch.
 * Maps onto PaneSize: small → s, normal → m, large → l.
 */
export type PaneFontSize = 'small' | 'normal' | 'large'

/**
 * Typeface for every pane, set from the notch. `areal` asks for ABC Areal
 * Superfamily Variable, which tiao cannot ship (it is licensed): the page
 * declares the @font-face, or the system has it installed. Without either,
 * text falls back to the system stack.
 */
export type PaneFont = 'system' | 'areal'

/** default --tiao-accent, used when the computed style is unavailable (e.g. jsdom) */
const DEFAULT_ACCENT = '#facc15'

/** inline styles a floating pane owns; parked and restored around docking */
const FREE_PROPS = ['left', 'top', 'right', 'bottom', 'transform', 'width', 'z-index']

/** edge-resize bounds */
const MIN_WIDTH = 200
const MAX_WIDTH = 640
const MIN_HEIGHT = 120
const MAX_HEIGHT = 2000

/** gap between co-anchored floating panes; matches the default window inset */
const PACK_GAP = 8

/** .tiao-folder-body's grid-template-rows transition */
const FOLDER_EXPAND_MS = 180

const panes = new Map<string, Pane>()

/** all live floating panes (for the global H toggle) */
const floatingPanes = new Set<Pane>()

/** one global-toggle listener per document */
const globalToggleInstalled = new WeakMap<Document, (e: KeyboardEvent) => void>()

/** shared stacking counter so the last-interacted floating pane wins */
let zTop = 9999

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

function ensureGlobalToggle(doc: Document): void {
  if (globalToggleInstalled.has(doc)) return
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'h' && e.key !== 'H') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isTypingTarget(e.target)) return
    Pane.toggleAll(doc)
  }
  doc.addEventListener('keydown', onKey)
  globalToggleInstalled.set(doc, onKey)
}

function releaseGlobalToggle(doc: Document): void {
  const onKey = globalToggleInstalled.get(doc)
  if (!onKey) return
  doc.removeEventListener('keydown', onKey)
  globalToggleInstalled.delete(doc)
}

/** one notch bar per document, mounted with the first floating pane */
const notches = new WeakMap<Document, Notch>()

/**
 * Notch state shared by every pane in the page. The chrome keys are the global
 * settings panel's last broadcast: live panes take them immediately, and panes
 * mounted later inherit them unless they carry saved chrome of their own.
 */
interface NotchState {
  font?: PaneFont | undefined
  fontSize?: PaneFontSize | undefined
  spacing?: PaneSpacing | undefined
  /** the notch vanishes until the pointer comes near the top edge */
  hiding?: boolean | undefined
  /** every floating pane is hidden (H / the notch eye); restored on remount */
  hidden?: boolean | undefined
  /** floating panes and the notch draw translucent and frosted */
  glass?: boolean | undefined
  theme?: PaneTheme | undefined
  style?: PaneStyle | undefined
  accent?: string | undefined
  numbers?: boolean | undefined
}

const notchStore = jsonStore<NotchState>('tiao:notch')

function readNotchState(): NotchState {
  return notchStore.get()
}

/**
 * The face lands on the root element as an attribute the stylesheet keys off:
 * a token set on each pane would be re-declared by panes nested inside it
 * (the settings menus), and the attribute reaches every one of them.
 */
function applyFont(doc: Document, font: PaneFont): void {
  const root = doc.documentElement
  if (font === 'system') delete root.dataset['tiaoFont']
  else root.dataset['tiaoFont'] = font
}

/** the panes the notch counts, reveals, and resets: floating plus every id'd one */
function trackedPanes(doc: Document): Pane[] {
  // inline panes without an id (the settings menu's own pane) drive the
  // chrome rather than the app, so their rows don't count
  return [...new Set([...floatingPanes, ...panes.values()])].filter(
    (p) => p.element.ownerDocument === doc,
  )
}

/** value changes arrive per drag frame; refresh the notch once per burst */
const valuesPending = new WeakSet<Document>()

function scheduleValueSync(doc: Document): void {
  if (valuesPending.has(doc)) return
  valuesPending.add(doc)
  queueMicrotask(() => {
    valuesPending.delete(doc)
    notches.get(doc)?.syncValues()
  })
}

/** undo/redo across every tracked pane in a document */
const histories = new WeakMap<Document, ValueHistory>()

function historyFor(doc: Document): ValueHistory {
  let history = histories.get(doc)
  if (!history) {
    history = new ValueHistory(() => scheduleValueSync(doc))
    histories.set(doc, history)
  }
  return history
}

function panesIn(doc: Document): Pane[] {
  const list: Pane[] = []
  for (const p of floatingPanes) {
    if (p.element.ownerDocument === doc) list.push(p)
  }
  return list
}

/** which way a packed column grows; `mid` centers the group on the viewport */
function packStack(anchor: Anchor): 'start' | 'mid' {
  switch (anchor) {
    case 'left-center':
    case 'right-center':
    case 'center':
      return 'mid'
    case 'top-left':
    case 'top-center':
    case 'top-right':
    case 'bottom-left':
    case 'bottom-center':
    case 'bottom-right':
      return 'start'
    default: {
      const _exhaustive: never = anchor
      return _exhaustive
    }
  }
}

/** wrap a full column inward from this edge; center anchors stay a single column */
function packWrap(anchor: Anchor): 'left' | 'right' | null {
  switch (anchor) {
    case 'top-left':
    case 'bottom-left':
      return 'left'
    case 'top-right':
    case 'bottom-right':
      return 'right'
    case 'top-center':
    case 'bottom-center':
    case 'left-center':
    case 'right-center':
    case 'center':
      return null
    default: {
      const _exhaustive: never = anchor
      return _exhaustive
    }
  }
}

let packing = false

/**
 * Global actions (H, dock, reveal, a viewport resize) touch every pane, and
 * each pane on its own would re-pack its anchor and re-sync the notch, each a
 * forced layout. Inside a batch those queue up and run once at the end.
 */
let batchDepth = 0
/** anchors to re-pack per document; null re-packs all of them */
const queuedPacks = new Map<Document, Set<Anchor> | null>()
const queuedNotchSyncs = new Set<Document>()

function batchPanes(fn: () => void): void {
  batchDepth++
  try {
    fn()
  } finally {
    batchDepth--
    if (batchDepth === 0) flushPaneBatch()
  }
}

function flushPaneBatch(): void {
  const packs = [...queuedPacks]
  const syncs = [...queuedNotchSyncs]
  queuedPacks.clear()
  queuedNotchSyncs.clear()
  for (const [doc, anchors] of packs) packAnchored(doc, anchors ?? undefined)
  for (const doc of syncs) syncNotch(doc)
}

/**
 * Lay out every movable, visible, still-anchored pane in `doc` so siblings
 * that share an anchor sit along that edge instead of occupying one spot.
 */
function packAnchored(doc: Document, only?: Anchor | ReadonlySet<Anchor>): void {
  if (batchDepth > 0) {
    const queued = queuedPacks.get(doc)
    if (queued === null) return
    if (only === undefined) queuedPacks.set(doc, null)
    else {
      const set = queued ?? new Set<Anchor>()
      if (typeof only === 'string') set.add(only)
      else for (const a of only) set.add(a)
      queuedPacks.set(doc, set)
    }
    return
  }
  if (packing) return
  packing = true
  try {
    const groups = new Map<Anchor, Pane[]>()
    for (const p of panesIn(doc)) {
      if (p.docked || p.hidden) continue
      const anchor = p.anchor
      if (!anchor) continue
      if (only !== undefined && (typeof only === 'string' ? anchor !== only : !only.has(anchor))) {
        continue
      }
      const list = groups.get(anchor)
      if (list) list.push(p)
      else groups.set(anchor, [p])
    }
    const viewH = doc.defaultView?.innerHeight ?? 0
    // every size is read before any pane moves, so layout is computed once
    // rather than once per pane
    const sized: { anchor: Anchor; list: Pane[]; sizes: PaneBox[] }[] = []
    for (const [anchor, list] of groups) {
      // order, then creation (panesIn walks the insertion-ordered floating set)
      list.sort((a, b) => a.order - b.order)
      sized.push({ anchor, list, sizes: list.map(measurePane) })
    }
    for (const { anchor, list, sizes } of sized) layoutAnchorGroup(anchor, list, sizes, viewH)
  } finally {
    packing = false
  }
}

interface PaneBox {
  width: number
  height: number
}

function measurePane(p: Pane): PaneBox {
  return { width: p.element.offsetWidth, height: p.element.offsetHeight }
}

function layoutAnchorGroup(anchor: Anchor, list: Pane[], sizes: PaneBox[], viewH: number): void {
  if (packStack(anchor) === 'mid') {
    const total =
      sizes.reduce((sum, s) => sum + s.height, 0) + PACK_GAP * Math.max(0, list.length - 1)
    let y = -total / 2
    for (let i = 0; i < list.length; i++) {
      list[i]!.placePacked(y, 0, sizes[i]!)
      y += sizes[i]!.height + PACK_GAP
    }
    return
  }
  const wrap = packWrap(anchor)
  const limit = Math.max(0, viewH - 2 * PACK_GAP)
  let stack = 0
  let column = 0
  let colWidth = 0
  for (let i = 0; i < list.length; i++) {
    const size = sizes[i]!
    if (wrap && stack > 0 && limit > 0 && stack + size.height > limit) {
      column += colWidth + PACK_GAP
      stack = 0
      colWidth = 0
    }
    list[i]!.placePacked(stack, column, size)
    stack += size.height + PACK_GAP
    colWidth = Math.max(colWidth, size.width)
  }
}

/** one observer for every floating pane, so a resize burst re-packs each anchor once */
let paneObserver: ResizeObserver | null | undefined
const observedPanes = new WeakMap<Element, Pane>()

function observePaneSize(pane: Pane): () => void {
  if (paneObserver === undefined) {
    paneObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            batchPanes(() => {
              for (const e of entries) observedPanes.get(e.target)?.onSizeChange()
            })
          })
  }
  const observer = paneObserver
  if (!observer) return () => {}
  observedPanes.set(pane.element, pane)
  observer.observe(pane.element)
  return () => {
    observer.unobserve(pane.element)
    observedPanes.delete(pane.element)
  }
}

/** one window-resize listener per document, coalesced to a frame */
const viewportWatch = new WeakMap<Document, () => void>()

function watchViewport(doc: Document): void {
  const win = doc.defaultView
  if (!win || viewportWatch.has(doc)) return
  let raf = 0
  const onResize = () => {
    if (raf) return
    raf = win.requestAnimationFrame(() => {
      raf = 0
      batchPanes(() => {
        for (const p of panesIn(doc)) p.onViewportResize()
      })
    })
  }
  win.addEventListener('resize', onResize)
  viewportWatch.set(doc, () => {
    if (raf) win.cancelAnimationFrame(raf)
    win.removeEventListener('resize', onResize)
  })
}

function releaseViewport(doc: Document): void {
  viewportWatch.get(doc)?.()
  viewportWatch.delete(doc)
}

/** persistence is opt-out, but needs a stable id to key on */
function paneStorageKey(options: PaneOptions): string | null {
  if (!options.id || options.storage === false) return null
  return `tiao:${options.id}`
}

function ensureNotch(doc: Document): void {
  watchColorScheme(doc)
  if (notches.has(doc)) return
  notches.set(
    doc,
    createNotch({
      document: doc,
      getHidden: () => {
        const list = panesIn(doc)
        return list.length > 0 && list.every((p) => p.hidden)
      },
      toggleHidden: () => {
        Pane.toggleAll(doc)
      },
      getDocked: () => dockBody(doc) !== null,
      toggleDocked: () => {
        Pane.toggleDock(doc)
      },
      reset: () => {
        Pane.resetValues(doc)
      },
      exportValues: () => Pane.exportValues(doc),
      importValues: (data) => Pane.importValues(data, doc),
      countOverrides: () => Pane.countOverrides(doc),
      history: {
        canUndo: () => Pane.canUndo(doc),
        canRedo: () => Pane.canRedo(doc),
        undo: () => Pane.undo(doc),
        redo: () => Pane.redo(doc),
      },
      revealOverrides: () => {
        Pane.revealOverrides(doc)
      },
      font: {
        get: () => Pane.font,
        set: (v) => Pane.setFont(v, doc),
      },
      createPane: (options) => new Pane(options),
      getTheme: () => globalChrome(doc).theme,
      setTheme: (theme) => setGlobalChrome(doc, { theme }),
      getStyle: () => globalChrome(doc).style,
      setStyle: (style) => setGlobalChrome(doc, { style }),
      getAccent: () => {
        const first = panesIn(doc)[0]
        return first ? resolvedAccent(first.element) : globalChrome(doc).accent
      },
      setAccent: (accent) => setGlobalChrome(doc, { accent }),
      getNumbers: () => globalChrome(doc).numbers,
      setNumbers: (numbers) => setGlobalChrome(doc, { numbers }),
      fontSize: {
        get: () => Pane.fontSize,
        set: (v) => Pane.setFontSize(v, doc),
      },
      spacing: {
        get: () => Pane.spacing,
        set: (v) => Pane.setSpacing(v, doc),
      },
      hiding: {
        get: () => readNotchState().hiding ?? true,
        set: (hiding) => {
          notchStore.patch({ hiding })
          syncNotch(doc)
        },
      },
      glass: {
        get: () => Pane.glass,
        set: (v) => Pane.setGlass(v, doc),
      },
    }),
  )
}

function resolveChrome(
  saved: {
    theme?: PaneTheme | undefined
    style?: string | undefined
    accent?: string | undefined
    numbers?: boolean | undefined
  },
  first: Pane | undefined,
): PaneChrome {
  return {
    theme: saved.theme ?? first?.theme ?? 'dark',
    style: normalizeStyle(saved.style ?? first?.style),
    accent: saved.accent ?? first?.chrome.accent ?? '',
    numbers: saved.numbers ?? first?.numbers ?? false,
  }
}

/**
 * The look the global settings panel shows: what it last broadcast, or the
 * primary pane's own chrome until something is set.
 */
function globalChrome(doc: Document): PaneChrome {
  return resolveChrome(readNotchState(), panesIn(doc)[0])
}

/**
 * Broadcast part of the chrome to every pane in both views. Each pane saves it
 * as its own, so a later per-pane tweak still sticks, and the stored copy seeds
 * panes mounted after this.
 */
function setGlobalChrome(doc: Document, patch: Partial<PaneChrome>): void {
  notchStore.patch(patch)
  writeDockState(patch)
  batchPanes(() => {
    for (const p of panesIn(doc)) p.adoptGlobalChrome(patch)
    applyDockChrome(doc)
    syncNotch(doc)
  })
}

function syncNotch(doc: Document): void {
  if (batchDepth > 0) {
    queuedNotchSyncs.add(doc)
    return
  }
  const notch = notches.get(doc)
  if (!notch) return
  // the notch re-declares the theme and size tokens, so it tracks the look
  // and scale the floating panes wear
  const el = notch.element
  const state = readNotchState()
  applyChrome(el, resolveChrome(state, panesIn(doc)[0]))
  el.classList.toggle('tiao-glass', state.glass ?? false)
  const size = paneSizeFor(state.fontSize ?? 'small')
  const spacing = state.spacing ?? 's'
  el.classList.toggle('tiao-size-s', size === 's')
  el.classList.toggle('tiao-size-l', size === 'l')
  el.classList.toggle('tiao-spacing-m', spacing === 'm')
  el.classList.toggle('tiao-spacing-l', spacing === 'l')
  notch.sync()
}

function paneSizeFor(fontSize: PaneFontSize): PaneSize {
  switch (fontSize) {
    case 'large':
      return 'l'
    case 'normal':
      return 'm'
    case 'small':
      return 's'
    default: {
      const _exhaustive: never = fontSize
      return _exhaustive
    }
  }
}

/** tear the notch and dock down once the last floating pane is gone */
function releaseNotch(doc: Document): void {
  if (panesIn(doc).length > 0) return
  notches.get(doc)?.dispose()
  notches.delete(doc)
  closeDock(doc)
  releaseGlobalToggle(doc)
  releaseColorScheme(doc)
  releaseViewport(doc)
}

/** the look of a pane, applied as a unit so the dock can swap it wholesale */
export interface PaneChrome {
  theme: PaneTheme
  style: PaneStyle
  accent: string
  numbers: boolean
}

/**
 * Theme tokens only; `numbers` needs a Pane and is applied by setChrome.
 * These run on every pane and the notch for each global change, so they only
 * write what differs: a no-op attribute or class write still invalidates style.
 */
function applyChrome(el: HTMLElement, chrome: PaneChrome): void {
  applyThemeClass(el, chrome.theme)
  applyStyleClass(el, chrome.style)
  if (el.style.getPropertyValue('--tiao-accent') === chrome.accent) return
  if (chrome.accent) el.style.setProperty('--tiao-accent', chrome.accent)
  else el.style.removeProperty('--tiao-accent')
}

function applyThemeClass(el: HTMLElement, theme: PaneTheme): void {
  // preference stays on the element so a system change can find who to repaint
  if (el.dataset.tiaoTheme !== theme) el.dataset.tiaoTheme = theme
  const next = THEME_CLASS[resolveTheme(theme, el.ownerDocument)]
  // toggle(cls, force) leaves a class that is already right untouched
  for (const cls of THEME_CLASSES) el.classList.toggle(cls, cls === next)
}

function applyStyleClass(el: HTMLElement, style: PaneStyle): void {
  const next = STYLE_CLASS[style]
  for (const cls of STYLE_CLASSES) el.classList.toggle(cls, cls === next)
}

/** inline --tiao-accent if set, else the value the current theme resolves to */
function resolvedAccent(el: HTMLElement): string {
  const inline = el.style.getPropertyValue('--tiao-accent').trim()
  if (inline) return inline
  const win = el.ownerDocument.defaultView
  const computed = win?.getComputedStyle(el).getPropertyValue('--tiao-accent').trim()
  return computed || DEFAULT_ACCENT
}

/**
 * The sidebar's shared chrome. Docked panes all render with it and keep their
 * own floating chrome aside, so the two views theme independently. Seeded from
 * the first pane the first time the sidebar opens.
 */
function dockChrome(doc: Document): PaneChrome {
  return resolveChrome(readDockState(), panesIn(doc)[0])
}

function applyDockChrome(doc: Document): void {
  const chrome = dockChrome(doc)
  const root = dockRoot(doc)
  if (root) applyChrome(root, chrome)
  for (const p of panesIn(doc)) {
    if (p.docked) p.setChrome(chrome)
  }
  syncNotch(doc)
}

function createDockHost(doc: Document): DockHost {
  const update = (patch: DockState) => {
    writeDockState(patch)
    applyDockChrome(doc)
  }
  return {
    document: doc,
    filter: (query) => {
      for (const p of panesIn(doc)) p.filter(query)
    },
    createPane: (options) => new Pane(options),
    getTheme: () => dockChrome(doc).theme,
    setTheme: (theme) => update({ theme }),
    getStyle: () => dockChrome(doc).style,
    setStyle: (style) => update({ style }),
    getAccent: () => {
      const root = dockRoot(doc)
      return root ? resolvedAccent(root) : dockChrome(doc).accent
    },
    setAccent: (accent) => update({ accent }),
    getNumbers: () => dockChrome(doc).numbers,
    setNumbers: (numbers) => update({ numbers }),
  }
}

export class Pane extends Container {
  readonly element: HTMLElement
  readonly rack: HTMLElement
  private titlebar: HTMLElement
  private titleMain: HTMLElement
  private titleEl: HTMLElement
  private paneBody: HTMLElement
  private searchbar: HTMLElement
  private searchInput: HTMLInputElement
  private _expanded: boolean
  private _draggable: boolean
  private _numbers = false
  /** preferred theme, which may be 'system'; the CSS class is the resolved look */
  private _theme: PaneTheme = 'dark'
  private _anchor: Anchor | null = null
  private _order: number
  private _stack = 0
  private _column = 0
  private margin: number
  private readonly doc: Document
  /** created without a container: owns its own window position and joins the H toggle */
  private readonly floating: boolean
  /** the free position and theme parked while docked; non-null means docked */
  private free: { styles: Record<string, string>; chrome: PaneChrome } | null = null
  /** where this pane's own chrome and geometry persist; null without an id */
  private readonly store: JSONStore<PersistedState> | null
  private options: PaneOptions
  private paneRegistry: PluginRegistry
  /** persisted bound values; null when the pane has no id or storage is off */
  private readonly values: ValueStore | null

  /** look up a live pane by id */
  static get(id: string): Pane | undefined {
    return panes.get(id)
  }

  /** whether floating panes are currently collected in the dock sidebar */
  static get docked(): boolean {
    return dockBody(document) !== null
  }

  /**
   * Move every floating pane into an inline sidebar (page content reflows
   * beside it) or back out to their free positions. Returns the new state.
   */
  static toggleDock(doc: Document = document): boolean {
    batchPanes(() => {
      if (dockBody(doc)) {
        for (const p of panesIn(doc)) p.undock()
        closeDock(doc)
      } else {
        const body = ensureDock(createDockHost(doc))
        for (const p of panesIn(doc)) p.dockInto(body)
        applyDockChrome(doc)
      }
      writeDockState({ docked: dockBody(doc) !== null })
      syncNotch(doc)
    })
    return dockBody(doc) !== null
  }

  /** how big floating panes currently draw */
  static get fontSize(): PaneFontSize {
    return readNotchState().fontSize ?? 'small'
  }

  /** Draw every floating pane at `size`; small → s, normal → m, large → l. */
  static setFontSize(size: PaneFontSize, doc: Document = document): void {
    notchStore.patch({ fontSize: size })
    for (const p of panesIn(doc)) p.applyFontSize(size)
    syncNotch(doc)
  }

  /** how much padding floating panes currently draw */
  static get spacing(): PaneSpacing {
    return readNotchState().spacing ?? 's'
  }

  /** Draw every floating pane at `spacing`; 's' is the default padding. */
  static setSpacing(spacing: PaneSpacing, doc: Document = document): void {
    notchStore.patch({ spacing })
    for (const p of panesIn(doc)) p.spacing = spacing
    syncNotch(doc)
  }

  /** whether floating panes and the notch draw translucent and frosted */
  static get glass(): boolean {
    return readNotchState().glass ?? false
  }

  /**
   * Frost every floating pane and the notch, or draw them opaque (the default:
   * the blur re-runs every frame the page underneath changes).
   */
  static setGlass(glass: boolean, doc: Document = document): void {
    notchStore.patch({ glass })
    for (const p of panesIn(doc)) p.element.classList.toggle('tiao-glass', glass)
    syncNotch(doc)
  }

  /**
   * Hide or show every floating pane in `doc`.
   * If any are visible → hide all; otherwise show all.
   * Returns whether panes are now hidden.
   */
  static toggleAll(doc: Document = document): boolean {
    const list = panesIn(doc)
    if (list.length === 0) return false
    const hide = list.some((p) => !p.hidden)
    batchPanes(() => {
      for (const p of list) p.hidden = hide
      setDockVisible(doc, !hide)
      notchStore.patch({ hidden: hide })
      syncNotch(doc)
    })
    return hide
  }

  /**
   * Restore every bound value in `doc` to the default its code declared and
   * forget the persisted copies. Floating panes also snap back to the
   * position their code declared. Theme and dock state stay as they are.
   */
  static resetValues(doc: Document = document): void {
    // one undo step brings every value back
    historyFor(doc).batch(() => {
      for (const p of trackedPanes(doc)) {
        walkBindings(p, (b) => b.reset())
        p.values?.clear()
        p.resetPosition()
      }
    })
    packAnchored(doc)
  }

  /** whether there is a value edit to step back over in `doc` */
  static canUndo(doc: Document = document): boolean {
    return historyFor(doc).canUndo
  }

  static canRedo(doc: Document = document): boolean {
    return historyFor(doc).canRedo
  }

  /**
   * Step back over the last value edit in `doc` (a global reset or an import
   * counts as one). The last HISTORY_LIMIT (10) edits are kept.
   */
  static undo(doc: Document = document): void {
    historyFor(doc).undo()
  }

  static redo(doc: Document = document): void {
    historyFor(doc).redo()
  }

  /** how many editable rows in `doc` differ from the default their code declared */
  static countOverrides(doc: Document = document): number {
    let count = 0
    for (const p of trackedPanes(doc)) {
      walkBindings(p, (b) => {
        b.counted = b.overridden
        if (b.counted) count++
      })
    }
    return count
  }

  /**
   * Outline every overridden row in the accent for a moment, first opening
   * whatever hides it: hidden or collapsed panes, folders, and tab pages.
   * Returns how many rows flashed.
   */
  static revealOverrides(doc: Document = document): number {
    let total = 0
    let shown = false
    batchPanes(() => {
      for (const p of trackedPanes(doc)) {
        const found: BindingApi<unknown>[] = []
        for (const child of p.children) revealOverridden(child, found)
        const first = found[0]
        if (!first) continue
        total += found.length
        if (p.hidden) {
          p.hidden = false
          shown = true
        }
        p.expanded = true
        for (const b of found) b.flash()
        // after the folders finish opening, so the row is where it will stay
        setTimeout(() => first.element.scrollIntoView?.({ block: 'nearest' }), FOLDER_EXPAND_MS)
      }
      if (shown) {
        setDockVisible(doc, true)
        notchStore.patch({ hidden: false })
      }
    })
    return total
  }

  /** typeface every pane draws with */
  static get font(): PaneFont {
    return readNotchState().font ?? 'system'
  }

  static setFont(font: PaneFont, doc: Document = document): void {
    notchStore.patch({ font })
    applyFont(doc, font)
  }

  /**
   * Every value the id'd panes in `doc` persist, as `pane id -> row path ->
   * value` (the shape storage holds), ready for JSON and importValues.
   */
  static exportValues(doc: Document = document): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {}
    for (const [id, p] of panes) {
      if (p.element.ownerDocument !== doc) continue
      const values: Record<string, unknown> = {}
      walkBindings(p, (b) => {
        if (b.persistPath !== null) values[b.persistPath] = b.value.get()
      })
      if (Object.keys(values).length > 0) out[id] = values
    }
    return out
  }

  /**
   * Apply exportValues output to the live panes in `doc`; rows whose value no
   * longer fits the shape the code declares are skipped. Returns how many landed.
   */
  static importValues(data: unknown, doc: Document = document): number {
    if (!isRecord(data)) return 0
    let applied = 0
    // one undo step takes the whole import back
    historyFor(doc).batch(() => {
      for (const [id, values] of Object.entries(data)) {
        const p = panes.get(id)
        if (!p || p.element.ownerDocument !== doc || !isRecord(values)) continue
        walkBindings(p, (b) => {
          const path = b.persistPath
          if (path === null || !sameShape(values[path], b.defaultValue)) return
          b.value.set(values[path])
          applied++
        })
      }
    })
    return applied
  }

  constructor(options: PaneOptions = {}) {
    ensureBuiltins(globalRegistry)
    const doc = options.document ?? document
    const registry = new PluginRegistry(globalRegistry)
    const host: BladeHost = { document: doc, registry }
    const storageKey = paneStorageKey(options)
    if (storageKey) host.values = createValueStore(storageKey)
    // the same panes trackedPanes() counts: floating or id'd, never a menu's own
    if (!options.container || options.id !== undefined) {
      host.onSettle = (binding, from, to) => historyFor(doc).record(binding, from, to)
    }
    super(host)
    this.values = host.values ?? null
    this.store = storageKey ? jsonStore<PersistedState>(storageKey) : null
    this.options = options
    this.paneRegistry = registry
    this.doc = doc
    this._expanded = options.expanded ?? true
    this.floating = !options.container
    this._draggable = this.floating && (options.draggable ?? true)
    this._order = options.order ?? 0
    this.margin = options.margin ?? 8

    injectStyles(doc)
    watchColorScheme(doc)

    // build the chrome under the pane's document so h()/icon() create
    // elements in the right realm (PaneOptions.document)
    const chrome = withDocument(doc, () => {
      const rack = h('div', 'tiao-rack')
      const gear = h('button', 'tiao-titlebar-btn tiao-pane-gear', gearIcon())
      gear.type = 'button'
      gear.setAttribute('aria-label', 'Pane settings')
      gear.setAttribute('data-tiao-menu-trigger', '')
      const searchBtn = h('button', 'tiao-titlebar-btn tiao-pane-search', searchIcon())
      searchBtn.type = 'button'
      searchBtn.setAttribute('aria-label', 'Search')
      const titleEl = h('span', 'tiao-pane-title', options.title ?? '')
      const collapseButton = h('button', 'tiao-titlebar-main', icon('chevron'), titleEl)
      collapseButton.type = 'button'
      const titlebar = h(
        'div',
        'tiao-titlebar',
        collapseButton,
        h('div', 'tiao-titlebar-actions', searchBtn, gear),
      )
      const searchInput = h('input', 'tiao-search-input')
      searchInput.type = 'search'
      searchInput.placeholder = 'Search'
      const searchbar = h('div', 'tiao-searchbar', searchInput)
      // collapsed to zero height, but still focusable unless inert
      searchbar.toggleAttribute('inert', true)
      const body = h('div', 'tiao-pane-body', h('div', 'tiao-pane-clip', rack))
      const element = h('div', 'tiao-pane', titlebar, searchbar, body)
      return {
        rack,
        gear,
        searchBtn,
        titlebar,
        titleMain: collapseButton,
        titleEl,
        searchInput,
        searchbar,
        body,
        element,
      }
    })
    const { gear, searchBtn } = chrome
    this.disposers.push(
      tooltip(searchBtn, () => 'Search'),
      tooltip(gear, () => 'Settings'),
    )
    this.rack = chrome.rack
    this.titlebar = chrome.titlebar
    this.titleMain = chrome.titleMain
    this.titleEl = chrome.titleEl
    this.paneBody = chrome.body
    this.searchInput = chrome.searchInput
    this.searchbar = chrome.searchbar
    this.element = chrome.element
    // mirrored so docked siblings can be compared straight from the DOM
    this.element.dataset['tiaoOrder'] = String(this._order)

    if (this.floating) {
      this.element.classList.add('tiao-floating')
      this._anchor = options.anchor ?? 'top-right'
    }
    if (options.width !== undefined) this.element.style.width = `${options.width}px`
    if (options.maxHeight !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${options.maxHeight}px`)
    }
    if (options.theme) this.applyTheme(options.theme)
    // the global font size covers floating panes; inline ones keep their own
    const notchState = readNotchState()
    applyFont(doc, notchState.font ?? 'system')
    if (this.floating) this.applyFontSize(notchState.fontSize ?? 'small')
    else if (options.size) this.size = options.size
    if (this.floating) {
      this.spacing = notchState.spacing ?? 's'
      this.element.classList.toggle('tiao-glass', notchState.glass ?? false)
    }

    // restore persisted state before first paint: this pane's own saved chrome
    // wins, then whatever the global settings panel last broadcast
    const persisted = this.loadState()
    if (persisted.w !== undefined) this.element.style.width = `${persisted.w}px`
    if (persisted.hMax !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${persisted.hMax}px`)
    }
    if (persisted.expanded !== undefined) this._expanded = persisted.expanded
    this._theme = persisted.theme ?? notchState.theme ?? 'dark'
    applyThemeClass(this.element, this._theme)
    applyStyleClass(
      this.element,
      normalizeStyle(persisted.style ?? notchState.style ?? options.style),
    )
    const accent = persisted.accent ?? notchState.accent
    if (accent) this.applyTheme({ accent })
    if (persisted.draggable !== undefined && this.floating) this._draggable = persisted.draggable
    this._numbers = persisted.numbers ?? notchState.numbers ?? false
    if (this.floating) {
      if (persisted.x !== undefined && persisted.y !== undefined) {
        this.moveTo(persisted.x, persisted.y)
      } else if (persisted.anchor) {
        this._anchor = persisted.anchor
      }
    }
    this.applyExpanded()
    this.applyDraggable()
    this.hidden = options.hidden ?? (this.floating && (notchState.hidden ?? false))

    // collapse on any titlebar click except the action buttons (and not right after a drag)
    let suppressClick = false
    const onTitlebarClick = (e: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false
        return
      }
      if ((e.target as Element | null)?.closest?.('.tiao-titlebar-btn')) return
      this.expanded = !this.expanded
    }
    this.titlebar.addEventListener('click', onTitlebarClick)
    this.disposers.push(() => this.titlebar.removeEventListener('click', onTitlebarClick))

    // search: icon toggles an input row under the titlebar; typing filters rows
    const onSearchToggle = () => {
      this.searchOpen = !this.searchOpen
    }
    searchBtn.addEventListener('click', onSearchToggle)
    const onSearchInput = () => {
      this.expanded = true
      this.filter(this.searchInput.value)
    }
    this.searchInput.addEventListener('input', onSearchInput)
    const onSearchKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.searchOpen = false
      }
    }
    this.searchInput.addEventListener('keydown', onSearchKey)
    this.disposers.push(() => {
      searchBtn.removeEventListener('click', onSearchToggle)
      this.searchInput.removeEventListener('input', onSearchInput)
      this.searchInput.removeEventListener('keydown', onSearchKey)
    })

    if (this.floating) {
      const bringToFront = () => {
        // a docked pane has no stacking of its own; it would cover the resize strip
        if (!this.movable) return
        if (this.element.style.zIndex !== String(zTop)) {
          this.element.style.zIndex = String(++zTop)
        }
      }
      bringToFront()
      this.element.addEventListener('pointerdown', bringToFront, true)
      this.disposers.push(() => this.element.removeEventListener('pointerdown', bringToFront, true))

      let baseX = 0
      let baseY = 0
      let baseW = 0
      let baseH = 0
      this.disposers.push(
        draggable(this.titlebar, {
          // pointer capture would swallow the action buttons' clicks
          filter: (e) => !(e.target as Element | null)?.closest?.('.tiao-titlebar-btn'),
          onStart: () => {
            const rect = this.element.getBoundingClientRect()
            baseX = rect.left
            baseY = rect.top
            // size is captured once so each move avoids a forced layout read
            baseW = rect.width
            baseH = rect.height
            suppressClick = false
          },
          onMove: (s) => {
            if (!this.movable || !this._draggable || !s.moved) return
            suppressClick = true
            this.setPosition(baseX + s.dx, baseY + s.dy, baseW, baseH)
          },
          onEnd: (s) => {
            if (!this.movable || !this._draggable || !s.moved) return
            // moved can become true on pointerup alone (no prior moved onMove)
            suppressClick = true
            // persist the clamped position applied by moveTo, not the raw drag
            const rect = this.element.getBoundingClientRect()
            this.saveState({ x: rect.left, y: rect.top, anchor: undefined })
            // clear if no click follows (pointerup outside the titlebar)
            setTimeout(() => {
              suppressClick = false
            }, 0)
          },
        }),
      )

      this.installResizeHandles()
      // free-positioned panes must stay inside the window when it shrinks
      watchViewport(doc)
    }

    // settings menu: gear click or right-click anywhere on the pane
    if (options.menu !== false) {
      const menu = createPaneMenu({
        element: this.element,
        document: doc,
        createPane: (o) => new Pane(o),
        getTheme: () => this.theme,
        setTheme: (theme) => {
          this.theme = theme
        },
        getStyle: () => this.style,
        setStyle: (style) => {
          this.style = style
        },
        getAccent: () => this.accent,
        setAccent: (accent) => {
          this.accent = accent
        },
        getNumbers: () => this._numbers,
        setNumbers: (v) => {
          this.numbers = v
        },
        placement: {
          getDraggable: () => this._draggable,
          setDraggable: (v) => {
            this.draggable = v
          },
          getAnchor: () => this._anchor,
          setAnchor: (anchor) => {
            this.anchor = anchor
          },
        },
        onDispose: (fn) => this.disposers.push(fn),
      })
      const onGearClick = () => menu.toggle()
      gear.addEventListener('click', onGearClick)
      // right-click: the title bar opens pane settings, an editable row opens
      // its actions beside the pane
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault()
        const target = e.target as Element | null
        // right-clicking the open menu itself shouldn't toggle it closed
        if (target?.closest?.('.tiao-pane-menu')) return
        if (target && this.titlebar.contains(target)) {
          // docked panes are themed and searched from the sidebar header instead
          if (!this.docked) menu.toggle()
          return
        }
        const binding = bindingAt(target)
        if (binding && !binding.monitor) openRowToolbar(binding)
      }
      this.element.addEventListener('contextmenu', onContextMenu)
      this.disposers.push(() => {
        gear.removeEventListener('click', onGearClick)
        this.element.removeEventListener('contextmenu', onContextMenu)
      })
    }

    // clicking anywhere outside a focused pane input deselects/commits it,
    // even when the click target swallows focus changes (e.g. canvases);
    // the document listener only exists while one of this pane's inputs has focus
    const onDocPointerDown = (e: PointerEvent) => {
      const active = doc.activeElement
      if (!(active instanceof HTMLInputElement) || !this.element.contains(active)) return
      const target = e.target as Node | null
      if (target && (active === target || active.contains(target))) return
      const activeRow = active.closest('.tiao-row')
      const targetRow = target instanceof Element ? target.closest('.tiao-row') : null
      collapseSelection(active)
      markPointerBlur(targetRow === activeRow ? activeRow : null)
      active.blur()
      collapseSelection(active)
    }
    const onInputFocus = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement) {
        doc.addEventListener('pointerdown', onDocPointerDown, true)
      }
    }
    const onInputBlur = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement) {
        doc.removeEventListener('pointerdown', onDocPointerDown, true)
      }
    }
    this.element.addEventListener('focusin', onInputFocus)
    this.element.addEventListener('focusout', onInputBlur)
    this.disposers.push(() => {
      this.element.removeEventListener('focusin', onInputFocus)
      this.element.removeEventListener('focusout', onInputBlur)
      doc.removeEventListener('pointerdown', onDocPointerDown, true)
    })

    // wider custom caret over focused inputs (the native bar is easy to miss)
    this.disposers.push(installCaret(this.element, doc))

    // keep the notch's override count current; monitors only read the app
    this.disposers.push(
      this.on('change', (ev) => {
        if (ev.source === 'monitor') return
        // a drag frame only moves the count when it carries the row across its default
        if (ev.last === false && ev.target.overridden === ev.target.counted) return
        scheduleValueSync(doc)
      }),
      () => scheduleValueSync(doc),
    )

    if (options.toggleKey) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== options.toggleKey) return
        if (isTypingTarget(e.target)) return
        this.hidden = !this.hidden
      }
      doc.addEventListener('keydown', onKey)
      this.disposers.push(() => doc.removeEventListener('keydown', onKey))
    }

    if (this.floating) {
      floatingPanes.add(this)
      ensureGlobalToggle(doc)
      if (options.notch !== false) {
        // a previously docked session re-opens the sidebar before the first mount
        if (readDockState().docked) ensureDock(createDockHost(doc))
        ensureNotch(doc)
      }
      this.disposers.push(() => {
        floatingPanes.delete(this)
        const anchor = this._anchor
        releaseNotch(doc)
        syncNotch(doc)
        if (anchor) packAnchored(doc, anchor)
      })
    }

    const dock = this.floating ? dockBody(doc) : null
    if (dock) {
      this.dockInto(dock)
      // also themes the sidebar shell, which a restored dock has not seen yet
      applyDockChrome(doc)
    } else {
      ;(options.container ?? doc.body).append(this.element)
    }
    // a hidden session folds the sidebar the same way toggleAll does
    if (this.floating && this.hidden) setDockVisible(doc, false)
    // a persisted free position may be off-screen on a smaller window
    this.clampToViewport()
    if (this.floating && this._anchor && !this.docked) packAnchored(doc, this._anchor)
    if (this.floating) this.disposers.push(observePaneSize(this))
    syncNotch(doc)

    const id = options.id
    if (id) {
      panes.set(id, this)
      this.disposers.push(() => {
        if (panes.get(id) === this) panes.delete(id)
      })
    }
  }

  get id(): string | undefined {
    return this.options.id
  }

  get title(): string {
    return this.titleEl.textContent ?? ''
  }
  set title(v: string) {
    this.titleEl.textContent = v
  }

  get expanded(): boolean {
    return this._expanded
  }
  set expanded(v: boolean) {
    if (this._expanded === v) return
    this._expanded = v
    this.applyExpanded()
    this.saveState({ expanded: v })
  }

  /** free to be positioned: floating and not currently parked in the dock */
  private get movable(): boolean {
    return this.floating && this.free === null
  }

  get docked(): boolean {
    return this.free !== null
  }

  override get hidden(): boolean {
    return super.hidden
  }
  override set hidden(v: boolean) {
    if (super.hidden === v) return
    super.hidden = v
    syncNotch(this.doc)
    if (this._anchor) packAnchored(this.doc, this._anchor)
  }

  /** sidebar position, z-index style: lower sorts first, ties keep creation order */
  get order(): number {
    return this._order
  }
  set order(v: number) {
    if (this._order === v) return
    this._order = v
    this.element.dataset['tiaoOrder'] = String(v)
    const body = this.docked ? dockBody(this.doc) : null
    if (body) this.insertDocked(body)
    else if (this._anchor) packAnchored(this.doc, this._anchor)
  }

  get draggable(): boolean {
    return this._draggable
  }
  set draggable(v: boolean) {
    if (!this.floating || this._draggable === v) return
    this._draggable = v
    this.applyDraggable()
    this.saveState({ draggable: v })
  }

  /** section numbering: prepends "1", "1.2", "2.1.1"-style indexes to folder titles */
  get numbers(): boolean {
    return this._numbers
  }
  set numbers(v: boolean) {
    if (this._numbers === v) return
    this._numbers = v
    this.renumber()
    this.saveState({ numbers: v })
  }

  /** re-index folder titles whenever the tree changes while numbering is on */
  override notifyStructure(): void {
    if (this._numbers) this.renumber()
  }

  private renumber(): void {
    const walk = (container: Container, prefix: string) => {
      let n = 0
      for (const child of container.children) {
        if (child instanceof FolderApi) {
          const index = this._numbers ? `${prefix}${++n}` : null
          child.setSectionIndex(index)
          walk(child, index === null ? '' : `${index}.`)
        } else if (child instanceof TabApi) {
          for (const page of child.pages) walk(page, prefix)
        }
      }
    }
    walk(this, '')
  }

  /** current anchor; null when the pane has been dragged to a free position */
  get anchor(): Anchor | null {
    return this._anchor
  }
  set anchor(anchor: Anchor | null) {
    if (!this.movable || anchor === null) return
    const prev = this._anchor
    this._anchor = anchor
    this.saveState({ anchor, x: undefined, y: undefined })
    packAnchored(this.doc, anchor)
    if (prev && prev !== anchor) packAnchored(this.doc, prev)
  }

  get size(): PaneSize {
    if (this.element.classList.contains('tiao-size-s')) return 's'
    if (this.element.classList.contains('tiao-size-l')) return 'l'
    return 'm'
  }
  set size(v: PaneSize) {
    this.element.classList.remove('tiao-size-s', 'tiao-size-l')
    if (v !== 'm') this.element.classList.add(`tiao-size-${v}`)
  }

  get spacing(): PaneSpacing {
    if (this.element.classList.contains('tiao-spacing-m')) return 'm'
    if (this.element.classList.contains('tiao-spacing-l')) return 'l'
    return 's'
  }
  set spacing(v: PaneSpacing) {
    this.element.classList.remove('tiao-spacing-m', 'tiao-spacing-l')
    if (v !== 's') this.element.classList.add(`tiao-spacing-${v}`)
  }

  get theme(): PaneTheme {
    return this._theme
  }
  set theme(v: PaneTheme) {
    this._theme = v
    applyThemeClass(this.element, v)
    this.saveState({ theme: v })
  }

  get style(): PaneStyle {
    for (const [name, cls] of Object.entries(STYLE_CLASS) as [PaneStyle, string | null][]) {
      if (cls && this.element.classList.contains(cls)) return name
    }
    return 'bouba'
  }
  set style(v: PaneStyle) {
    const style = normalizeStyle(v)
    applyStyleClass(this.element, style)
    this.saveState({ style })
  }

  /** current --tiao-accent (inline override, else the themed default) */
  get accent(): string {
    return resolvedAccent(this.element)
  }
  set accent(v: string) {
    this.applyTheme({ accent: v })
    this.saveState({ accent: v })
  }

  get searchOpen(): boolean {
    return this.searchbar.classList.contains('tiao-open')
  }
  set searchOpen(v: boolean) {
    if (this.searchOpen === v) return
    this.searchbar.classList.toggle('tiao-open', v)
    this.searchbar.toggleAttribute('inert', !v)
    this.element.classList.toggle('tiao-search-on', v)
    if (v) {
      this.expanded = true
      this.searchInput.focus()
    } else {
      this.searchInput.value = ''
      this.searchInput.blur()
      this.filter('')
    }
  }

  /** show only items whose label/title matches; '' clears the filter */
  filter(query: string): void {
    const q = query.trim().toLowerCase()
    this.element.classList.toggle('tiao-searching', q !== '')
    for (const child of this.children) child.applySearch(q)
  }

  /** register a plugin for this pane only */
  registerPlugin(plugin: TiaoPlugin): void {
    this.paneRegistry.register(plugin)
  }

  applyTheme(theme: Record<string, string>): void {
    for (const [key, val] of Object.entries(theme)) {
      this.element.style.setProperty(key.startsWith('--') ? key : `--tiao-${key}`, val)
    }
  }

  moveTo(x: number, y: number): void {
    this.setPosition(x, y, this.element.offsetWidth, this.element.offsetHeight)
  }

  /** moveTo with a known size, so drag moves skip the layout read */
  private setPosition(x: number, y: number, w: number, h: number): void {
    const prev = this._anchor
    this._anchor = null
    this._stack = 0
    this._column = 0
    const win = this.doc.defaultView
    if (win && w) x = clamp(x, 0, Math.max(0, win.innerWidth - w))
    if (win && h) y = clamp(y, 0, Math.max(0, win.innerHeight - h))
    const s = this.element.style
    s.left = `${x}px`
    s.top = `${y}px`
    s.right = 'auto'
    s.bottom = 'auto'
    s.transform = 'none'
    if (prev) packAnchored(this.doc, prev)
  }

  /** invisible strips along the left/right/bottom edges; dragging them resizes the pane */
  private installResizeHandles(): void {
    const edges = ['left', 'right', 'bottom', 'bottom-left', 'bottom-right'] as const
    for (const edge of edges) {
      const handle = withDocument(this.doc, () => h('div', `tiao-resize tiao-resize-${edge}`))
      this.element.append(handle)
      const horiz: 'left' | 'right' | null =
        edge === 'bottom' ? null : edge.includes('left') ? 'left' : 'right'
      const vert = edge.startsWith('bottom')
      let baseW = 0
      let baseH = 0
      let baseLeft = 0
      const apply = (dx: number, dy: number, last: boolean) => {
        const patch: PersistedState = {}
        if (horiz) {
          const w = clamp(baseW + (horiz === 'left' ? -dx : dx), MIN_WIDTH, MAX_WIDTH)
          this.element.style.width = `${w}px`
          // free-positioned panes keep the right edge pinned while the left is dragged
          // (anchored panes already pin their edges via anchor positioning)
          if (horiz === 'left' && !this._anchor) {
            this.element.style.left = `${baseLeft + (baseW - w)}px`
          }
          patch.w = w
        }
        if (vert) {
          const hMax = clamp(baseH + dy, MIN_HEIGHT, MAX_HEIGHT)
          this.element.style.setProperty('--tiao-max-height', `${hMax}px`)
          patch.hMax = hMax
        }
        if (last) this.saveState(patch)
      }
      this.disposers.push(
        draggable(handle, {
          onStart: () => {
            const rect = this.element.getBoundingClientRect()
            baseW = rect.width
            baseH = rect.height
            baseLeft = rect.left
          },
          onMove: (s) => {
            if (s.moved) apply(s.dx, s.dy, false)
          },
          onEnd: (s) => {
            if (s.moved) apply(s.dx, s.dy, true)
          },
        }),
      )
    }
  }

  /** internal: the shared ResizeObserver saw this pane change size */
  onSizeChange(): void {
    if (this._anchor && this.movable && !this.hidden) packAnchored(this.doc, this._anchor)
  }

  /** internal: the window resized (coalesced to one frame for every pane) */
  onViewportResize(): void {
    if (this._anchor) packAnchored(this.doc, this._anchor)
    else this.clampToViewport()
  }

  /** re-clamp a free-positioned pane into the viewport (anchored panes track their edges) */
  private clampToViewport(): void {
    if (!this.movable || this._anchor) return
    const win = this.doc.defaultView
    if (!win) return
    const rect = this.element.getBoundingClientRect()
    if (!rect.width) return
    const x = clamp(rect.left, 0, Math.max(0, win.innerWidth - rect.width))
    const y = clamp(rect.top, 0, Math.max(0, win.innerHeight - rect.height))
    if (x !== rect.left || y !== rect.top) this.moveTo(x, y)
  }

  /** snap back to the anchor the constructor declared and forget a saved free position */
  private resetPosition(): void {
    if (!this.floating) return
    this._anchor = this.options.anchor ?? 'top-right'
    this._stack = 0
    this._column = 0
    this.saveState({ x: undefined, y: undefined, anchor: undefined })
  }

  /**
   * internal: pin this pane to its anchor using the current pack offsets.
   * Co-anchored siblings share a column; `_stack` / `_column` come from packAnchored,
   * which also hands over the size it already read so placing doesn't read layout.
   */
  placePacked(stack: number, column: number, size?: PaneBox): void {
    this._stack = stack
    this._column = column
    this.applyAnchor(size)
  }

  private applyAnchor(size?: PaneBox): void {
    const anchor = this._anchor
    if (!anchor) return
    const s = this.element.style
    const inset = this.margin
    const stack = this._stack
    const col = this._column
    // centered axes are solved in whole pixels: translate(-50%) puts an odd
    // size on a half pixel, which blurs every icon on 1x displays
    const win = this.doc.defaultView
    const centerX = () => {
      const width = size?.width ?? this.element.offsetWidth
      return `${Math.round(((win?.innerWidth ?? 0) - width) / 2)}px`
    }
    // a lone pane centers itself; a packed one sits `stack` from the middle
    const centerY = () => {
      const viewH = win?.innerHeight ?? 0
      const height = size?.height ?? this.element.offsetHeight
      const top = stack === 0 ? (viewH - height) / 2 : viewH / 2 + stack
      return `${Math.round(top)}px`
    }
    s.left = 'auto'
    s.right = 'auto'
    s.top = 'auto'
    s.bottom = 'auto'
    s.transform = 'none'
    switch (anchor) {
      case 'top-left':
        s.top = `${inset + stack}px`
        s.left = `${inset + col}px`
        break
      case 'top-center':
        s.top = `${inset + stack}px`
        s.left = centerX()
        break
      case 'top-right':
        s.top = `${inset + stack}px`
        s.right = `${inset + col}px`
        break
      case 'left-center':
        s.left = `${inset + col}px`
        s.top = centerY()
        break
      case 'center':
        s.left = centerX()
        s.top = centerY()
        break
      case 'right-center':
        s.right = `${inset + col}px`
        s.top = centerY()
        break
      case 'bottom-left':
        s.bottom = `${inset + stack}px`
        s.left = `${inset + col}px`
        break
      case 'bottom-center':
        s.bottom = `${inset + stack}px`
        s.left = centerX()
        break
      case 'bottom-right':
        s.bottom = `${inset + stack}px`
        s.right = `${inset + col}px`
        break
      default: {
        const _exhaustive: never = anchor
        void _exhaustive
      }
    }
  }

  private applyDraggable(): void {
    this.element.classList.toggle('tiao-draggable', this._draggable && this.movable)
  }

  /** internal: the look currently applied to this pane */
  get chrome(): PaneChrome {
    return {
      theme: this.theme,
      style: this.style,
      accent: this.element.style.getPropertyValue('--tiao-accent'),
      numbers: this._numbers,
    }
  }

  /** internal: apply chrome visually, leaving this pane's saved state alone */
  setChrome(chrome: PaneChrome): void {
    applyChrome(this.element, chrome)
    if (this._numbers !== chrome.numbers) {
      this._numbers = chrome.numbers
      this.renumber()
    }
  }

  /**
   * internal: take chrome the global settings panel broadcast and save it as
   * this pane's own. While docked the visible look belongs to the sidebar, so
   * the parked floating chrome is patched instead of the element.
   */
  adoptGlobalChrome(patch: Partial<PaneChrome>): void {
    if (patch.theme !== undefined) this.theme = patch.theme
    if (patch.style !== undefined) this.style = patch.style
    if (patch.accent !== undefined) this.accent = patch.accent
    if (patch.numbers !== undefined) this.numbers = patch.numbers
    if (this.free) this.free.chrome = { ...this.free.chrome, ...patch }
  }

  /**
   * internal: park this pane in the dock sidebar, stacked with its siblings.
   * The sidebar's shared chrome lands via applyDockChrome once all panes moved.
   */
  dockInto(container: HTMLElement): void {
    if (!this.floating || this.free) return
    this.searchOpen = false
    const s = this.element.style
    const styles: Record<string, string> = {}
    for (const prop of FREE_PROPS) {
      styles[prop] = s.getPropertyValue(prop)
      s.removeProperty(prop)
    }
    this.free = { styles, chrome: this.chrome }
    this.element.classList.remove('tiao-floating')
    this.element.classList.add('tiao-docked')
    this.applyDraggable()
    this.insertDocked(container)
    if (this._anchor) packAnchored(this.doc, this._anchor)
  }

  /**
   * internal: place this pane among its docked siblings by `order`. Inserting
   * rather than reordering visually keeps the separator rule (which reads DOM
   * adjacency), tab order, and scrolling in step with what is on screen.
   */
  private insertDocked(container: HTMLElement): void {
    const before = [...container.children].find(
      (el) => Number((el as HTMLElement).dataset['tiaoOrder'] ?? 0) > this._order,
    )
    // strictly greater, so an equal order lands after its peers (creation order)
    if (before) container.insertBefore(this.element, before)
    else container.append(this.element)
  }

  /** internal: return this pane to its floating position and its own theme */
  undock(): void {
    const free = this.free
    if (!free) return
    this.free = null
    this.filter('')
    // setChrome only paints; restore the parked preference so 'system' survives
    this._theme = free.chrome.theme
    this.setChrome(free.chrome)
    this.element.classList.remove('tiao-docked')
    this.element.classList.add('tiao-floating')
    for (const [prop, value] of Object.entries(free.styles)) {
      this.element.style.setProperty(prop, value)
    }
    this.doc.body.append(this.element)
    if (this._anchor) packAnchored(this.doc, this._anchor)
    else this.applyAnchor()
    this.applyDraggable()
    this.clampToViewport()
  }

  /** internal: follow the global font size */
  private applyFontSize(size: PaneFontSize): void {
    this.size = paneSizeFor(size)
  }

  private applyExpanded(): void {
    this.element.classList.toggle('tiao-expanded', this._expanded)
    this.titleMain.setAttribute('aria-expanded', String(this._expanded))
    this.paneBody.toggleAttribute('inert', !this._expanded)
    this.paneBody.setAttribute('aria-hidden', String(!this._expanded))
  }

  private loadState(): PersistedState {
    return this.store?.get() ?? {}
  }

  private saveState(patch: PersistedState): void {
    this.store?.patch(patch)
  }
}
