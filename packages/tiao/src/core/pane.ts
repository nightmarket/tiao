import {
  type BindingApi,
  type BladeHost,
  bindingAt,
  Container,
  FolderApi,
  markPointerBlur,
  revealItem,
  revealOverridden,
  sectionTitles,
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
  setDockDrawer,
  setDockVisible,
  setDrawerOpen,
  writeDockState,
} from './dock'
import { collapseSelection, draggable, gearIcon, h, icon, searchIcon, withDocument } from './dom'
import { createDrawerControls, type DrawerControls } from './drawer-controls'
import { loadGeist } from './fonts'
import { ValueHistory } from './history'
import { createNotch, type Notch, type NotchHost } from './notch'
import { createPaneMenu, type PaneMenuToggle } from './pane-menu'
import { createPinBoard, type PinBoard } from './pins'
import { globalRegistry, PluginRegistry, type TiaoPlugin } from './plugin'
import { openRowToolbar } from './row-toolbar'
import { createSearch, createSearchShortcut, type Search, type SearchEntry } from './search'
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
  /** the tiao this pane joins (see Pane.namespace); panes without one share the window's */
  namespace?: string | Namespace
  anchor?: Anchor
  /** offset in px from the anchored edge(s) */
  margin?: number
  /** sidebar position, z-index style: lower sorts first, ties keep creation order */
  order?: number
  /**
   * floating panes are draggable by default (toggleable from the pane menu); inline ones
   * opt in and move by their title bar within their container
   */
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
 * Typeface for every pane, set from the notch. `geist` (the default) is Geist
 * and Geist Mono, which ship with tiao. `areal` asks for ABC Areal Superfamily
 * Variable, which tiao cannot ship (it is licensed): the page declares the
 * @font-face, or the system has it installed. Without either, text falls back
 * to the system stack.
 */
export type PaneFont = 'geist' | 'system' | 'areal'

const DEFAULT_FONT: PaneFont = 'geist'

/** default --tiao-accent, used when the computed style is unavailable (e.g. jsdom) */
const DEFAULT_ACCENT = '#facc15'

/** floating panes and the notch start frosted */
const DEFAULT_GLASS = true

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

/** one global-toggle listener per document, and its removal */
const globalToggleInstalled = new WeakMap<Document, () => void>()

/** shared stacking counter so the last-interacted floating pane wins */
let zTop = 9999

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

function ensureGlobalToggle(doc: Document): void {
  if (globalToggleInstalled.has(doc)) return
  const isSearchShortcut = createSearchShortcut()
  // H hides the namespace under the pointer, so its last position is kept
  let pointed: EventTarget | null = null
  const onPointer = (e: PointerEvent) => {
    pointed = e.target
  }
  const onKey = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return
    if (isSearchShortcut(e)) {
      e.preventDefault()
      searchFor(doc).open()
      return
    }
    if (e.key !== 'h' && e.key !== 'H') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    Pane.toggleAll(spaceAt(doc, pointed))
  }
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('pointermove', onPointer, { passive: true })
  globalToggleInstalled.set(doc, () => {
    doc.removeEventListener('keydown', onKey)
    doc.removeEventListener('pointermove', onPointer)
  })
}

function releaseGlobalToggle(doc: Document): void {
  globalToggleInstalled.get(doc)?.()
  globalToggleInstalled.delete(doc)
}

/** the namespace a pane joins when it names none: it floats over the window */
const DEFAULT_NAMESPACE = 'default'

/**
 * A separate tiao on the page, with its own floating panes, notch, undo
 * history, changed count, and theme. The default namespace floats over the
 * window. Any other can be rooted in an element (Pane.namespace): its panes
 * then float inside that element, anchored to its corners and scrolling with
 * it, and its notch and pinned cards ride the element's top and bottom edges.
 * Search and the page-wide settings (font, size, spacing, glass, hover
 * controls) are shared by every namespace in a document.
 */
export interface Namespace {
  readonly name: string
  readonly document: Document
  /** where its panes float, or null for the window */
  readonly root: HTMLElement | null
  /** whether its notch follows the Hiding setting on the root, rather than staying shown */
  readonly hiding: boolean
}

interface Space extends Namespace {
  root: HTMLElement | null
  hiding: boolean
  /** re-lays its panes when the root changes size */
  observer: ResizeObserver | null
}

const spaces = new WeakMap<Document, Map<string, Space>>()

function spaceFor(doc: Document, name: string = DEFAULT_NAMESPACE): Space {
  let named = spaces.get(doc)
  if (!named) {
    named = new Map()
    spaces.set(doc, named)
  }
  let space = named.get(name)
  if (!space) {
    space = { name, document: doc, root: null, hiding: false, observer: null }
    named.set(name, space)
  }
  return space
}

/** a Document means its default namespace */
function toSpace(scope: Document | Namespace): Namespace {
  return 'documentElement' in scope ? spaceFor(scope) : spaceFor(scope.document, scope.name)
}

function isDefault(space: Namespace): boolean {
  return space.name === DEFAULT_NAMESPACE
}

/** the window docks into a sidebar beside the page, a rooted namespace into one inside its element */
function hasDock(space: Namespace): boolean {
  return isDefault(space) || space.root !== null
}

/** the rooted namespace whose element holds `target`, else the window's */
function spaceAt(doc: Document, target: EventTarget | null): Namespace {
  if (target instanceof Node) {
    for (const space of spaces.get(doc)?.values() ?? []) {
      if (space.root?.contains(target)) return space
    }
  }
  return spaceFor(doc)
}

/** one notch bar per namespace, mounted with its first floating pane */
const notches = new WeakMap<Namespace, Notch>()

/** namespaces where a pane asked for the notch, so a wide screen can bring it back */
const notchWanted = new WeakSet<Namespace>()

/** one search across every pane per document, built on first use */
const searches = new WeakMap<Document, Search>()

function searchFor(doc: Document): Search {
  let search = searches.get(doc)
  if (!search) {
    search = createSearch({
      document: doc,
      entries: () => {
        const entries: SearchEntry[] = []
        for (const p of trackedPanes(doc)) {
          walkBindings(p, (binding) => {
            const path = [p.title, ...sectionTitles(binding.parent)].filter(Boolean)
            entries.push({ binding, path })
          })
        }
        return entries
      },
      reveal: (binding) => Pane.reveal(binding, doc),
      theme: (el) => applyChrome(el, globalChrome(spaceFor(doc))),
    })
    searches.set(doc, search)
  }
  return search
}

/** one stack of pinned values per namespace, in its root when it has one */
const pinBoards = new WeakMap<Namespace, PinBoard>()

/** pinned cards wear their namespace's look and the page's glass, like its notch */
function pinBoardFor(space: Namespace): PinBoard {
  let board = pinBoards.get(space)
  if (!board) {
    board = createPinBoard(
      space.document,
      () => space.root,
      (card) => {
        applyChrome(card, globalChrome(space))
        card.classList.toggle('tiao-glass', readNotchState().glass ?? DEFAULT_GLASS)
      },
    )
    pinBoards.set(space, board)
  }
  return board
}

/** viewport width below which floating panes collect into the bottom drawer */
const MOBILE_QUERY = '(max-width: 767.98px)'

/**
 * One breakpoint listener per document. While the screen is small there is no
 * notch and no floating pane: only the drawer and the controls that open it.
 */
interface MobileWatch {
  mql: MediaQueryList
  onChange: () => void
  /** non-null exactly while the drawer layout is applied */
  controls: DrawerControls | null
}
const mobileWatches = new WeakMap<Document, MobileWatch>()

/** follow the breakpoint from here on; returns whether the screen is small now */
function watchMobile(doc: Document): boolean {
  const existing = mobileWatches.get(doc)
  if (existing) return existing.mql.matches
  const mql = doc.defaultView?.matchMedia?.(MOBILE_QUERY)
  if (!mql) return false
  const onChange = () => applyMobile(doc, mql.matches)
  mql.addEventListener('change', onChange)
  mobileWatches.set(doc, { mql, onChange, controls: null })
  return mql.matches
}

function releaseMobile(doc: Document): void {
  const watch = mobileWatches.get(doc)
  if (!watch) return
  watch.mql.removeEventListener('change', watch.onChange)
  watch.controls?.dispose()
  mobileWatches.delete(doc)
}

/**
 * Cross the breakpoint. A small screen drops every notch and gathers every
 * floating pane, rooted ones too, into the drawer; a wide one hands each pane
 * back to the layout it had, floating or docked, since the drawer never writes
 * the sidebar state.
 */
function applyMobile(doc: Document, mobile: boolean): void {
  const watch = mobileWatches.get(doc)
  if (!watch || (watch.controls !== null) === mobile) return
  const windowSpace = spaceFor(doc)
  const rooted = [...(spaces.get(doc)?.values() ?? [])].filter((space) => space.root !== null)
  // the closed drawer stands in for hiding every pane, so the saved flag sits out
  const hidden = readNotchState().hidden ?? false
  batchPanes(() => {
    if (mobile) {
      for (const space of spaces.get(doc)?.values() ?? []) {
        notches.get(space)?.dispose()
        notches.delete(space)
      }
      // rooted sidebars give their panes up to the drawer, which takes every one
      for (const space of rooted) {
        for (const p of panesOf(space)) p.undock()
        closeDock(space)
      }
      const dock = ensureDock(createDockHost(windowSpace))
      setDockDrawer(windowSpace, true)
      setDockVisible(windowSpace, true)
      for (const p of panesIn(doc)) {
        if (hidden) p.hidden = false
        p.dockInto(dock.body)
      }
      watch.controls = createDrawerControls({
        document: doc,
        drawer: dock.root,
        setOpen: (open) => setDrawerOpen(windowSpace, open),
        ...valueActions(windowSpace),
      })
      applyDockChrome(windowSpace)
      return
    }
    watch.controls?.dispose()
    watch.controls = null
    // the window's sidebar only holds its own panes; rooted ones go home, or into their own
    for (const p of panesIn(doc)) if (p.namespace !== windowSpace) p.undock()
    if (notchWanted.has(windowSpace) && readDockState(windowSpace).docked) {
      setDockDrawer(windowSpace, false)
    } else {
      for (const p of panesOf(windowSpace)) p.undock()
      closeDock(windowSpace)
    }
    for (const space of rooted) {
      if (notchWanted.has(space) && readDockState(space).docked) dockPanes(space)
    }
    if (hidden) {
      for (const p of panesOf(windowSpace)) p.hidden = true
      setDockVisible(windowSpace, false)
    }
    for (const space of spaces.get(doc)?.values() ?? []) {
      if (notchWanted.has(space)) ensureNotch(space)
      syncNotch(space)
    }
  })
}

/**
 * Point out `rows`, whose folders and tabs are already open: show and expand
 * their pane, flash them, and scroll to the first. Returns whether the pane had
 * been hidden.
 */
function presentRows(p: Pane, rows: BindingApi<unknown>[]): boolean {
  const wasHidden = p.hidden
  if (wasHidden) p.hidden = false
  p.expanded = true
  for (const b of rows) b.flash()
  // after the folders finish opening, so the row is where it will stay
  setTimeout(() => rows[0]?.element.scrollIntoView?.({ block: 'nearest' }), FOLDER_EXPAND_MS)
  return wasHidden
}

/** the drawer controls wear the drawer's theme and the global glass setting */
function syncDrawerControls(doc: Document): void {
  const controls = mobileWatches.get(doc)?.controls
  if (!controls) return
  const chrome = dockChrome(spaceFor(doc))
  const glass = readNotchState().glass ?? DEFAULT_GLASS
  for (const el of controls.buttons) {
    applyChrome(el, chrome)
    el.classList.toggle('tiao-glass', glass)
  }
}

/** the value edits the notch and the drawer controls both step over and reset */
function valueActions(space: Namespace): Pick<NotchHost, 'history' | 'reset'> {
  return {
    reset: () => {
      Pane.resetValues(space)
    },
    history: {
      canUndo: () => Pane.canUndo(space),
      canRedo: () => Pane.canRedo(space),
      undo: () => Pane.undo(space),
      redo: () => Pane.redo(space),
    },
  }
}

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
  /** rows show just their values until hovered */
  hoverControls?: boolean | undefined
}

const notchStore = jsonStore<NotchState>('tiao:notch')

function readNotchState(): NotchState {
  return notchStore.get()
}

/** the part of the notch state each namespace keeps for itself */
type ChromeState = Pick<NotchState, 'theme' | 'style' | 'accent' | 'numbers'>

/** where a namespace's theme, style, accent, and numbering persist; the window's share tiao:notch */
const chromeStores = new Map<string, JSONStore<ChromeState>>()

function chromeStore(space: Namespace): JSONStore<ChromeState> {
  if (isDefault(space)) return notchStore
  let store = chromeStores.get(space.name)
  if (!store) {
    store = jsonStore<ChromeState>(`tiao:notch:${space.name}`)
    chromeStores.set(space.name, store)
  }
  return store
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
  if (font === 'geist') void loadGeist(doc)
}

/** on the root element like the font, so the panes, the sidebar, and the drawer all follow it */
function applyHoverControls(doc: Document, on: boolean): void {
  doc.documentElement.toggleAttribute('data-tiao-hover-controls', on)
}

function hoverControlsToggle(doc: Document): PaneMenuToggle {
  return {
    get: () => Pane.hoverControls,
    set: (v) => Pane.setHoverControls(v, doc),
  }
}

/** the panes search covers: floating plus every id'd one, in every namespace */
function trackedPanes(doc: Document): Pane[] {
  // inline panes without an id (the settings menu's own pane) drive the
  // chrome rather than the app, so their rows don't count
  return [...new Set([...floatingPanes, ...panes.values()])].filter(
    (p) => p.element.ownerDocument === doc,
  )
}

/** the panes a namespace's notch counts, reveals, and resets */
function trackedOf(space: Namespace): Pane[] {
  return trackedPanes(space.document).filter((p) => p.namespace === space)
}

/** value changes arrive per drag frame; refresh the notch once per burst */
const valuesPending = new WeakSet<Namespace>()

function scheduleValueSync(space: Namespace): void {
  if (valuesPending.has(space)) return
  valuesPending.add(space)
  queueMicrotask(() => {
    valuesPending.delete(space)
    notches.get(space)?.syncValues()
    if (isDefault(space)) mobileWatches.get(space.document)?.controls?.syncValues()
  })
}

/** undo/redo across every tracked pane in a namespace */
const histories = new WeakMap<Namespace, ValueHistory>()

function historyFor(space: Namespace): ValueHistory {
  let history = histories.get(space)
  if (!history) {
    history = new ValueHistory(() => scheduleValueSync(space))
    histories.set(space, history)
  }
  return history
}

/** every floating pane in the document, whatever its namespace */
function panesIn(doc: Document): Pane[] {
  const list: Pane[] = []
  for (const p of floatingPanes) {
    if (p.element.ownerDocument === doc) list.push(p)
  }
  return list
}

function panesOf(space: Namespace): Pane[] {
  const list: Pane[] = []
  for (const p of floatingPanes) {
    if (p.namespace === space) list.push(p)
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
/** anchors to re-pack per namespace; null re-packs all of them */
const queuedPacks = new Map<Namespace, Set<Anchor> | null>()
const queuedNotchSyncs = new Set<Namespace>()

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
  for (const [space, anchors] of packs) packAnchored(space, anchors ?? undefined)
  for (const space of syncs) syncNotch(space)
}

/** the box a namespace's panes float in: its root's padding box, or the viewport */
function spaceSize(space: Namespace): { width: number; height: number } {
  if (space.root) return { width: space.root.clientWidth, height: space.root.clientHeight }
  const win = space.document.defaultView
  return { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 }
}

/**
 * Lay out every movable, visible, still-anchored pane in `space` so siblings
 * that share an anchor sit along that edge instead of occupying one spot.
 */
function packAnchored(space: Namespace, only?: Anchor | ReadonlySet<Anchor>): void {
  if (batchDepth > 0) {
    const queued = queuedPacks.get(space)
    if (queued === null) return
    if (only === undefined) queuedPacks.set(space, null)
    else {
      const set = queued ?? new Set<Anchor>()
      if (typeof only === 'string') set.add(only)
      else for (const a of only) set.add(a)
      queuedPacks.set(space, set)
    }
    return
  }
  if (packing) return
  packing = true
  try {
    const groups = new Map<Anchor, Pane[]>()
    for (const p of panesOf(space)) {
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
    const viewH = spaceSize(space).height
    // every size is read before any pane moves, so layout is computed once
    // rather than once per pane
    const sized: { anchor: Anchor; list: Pane[]; sizes: PaneBox[] }[] = []
    for (const [anchor, list] of groups) {
      // order, then creation (panesOf walks the insertion-ordered floating set)
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

function ensureNotch(space: Namespace): void {
  const doc = space.document
  watchColorScheme(doc)
  if (notches.has(space)) return
  const notch = createNotch({
    document: doc,
    getHidden: () => {
      const list = panesOf(space)
      return list.length > 0 && list.every((p) => p.hidden)
    },
    toggleHidden: () => {
      Pane.toggleAll(space)
    },
    dockable: hasDock(space),
    getDocked: () => dockBody(space) !== null,
    toggleDocked: () => {
      Pane.toggleDock(space)
    },
    ...valueActions(space),
    exportValues: () => Pane.exportValues(space),
    importValues: (data) => Pane.importValues(data, space),
    countOverrides: () => Pane.countOverrides(space),
    revealOverrides: () => {
      Pane.revealOverrides(space)
    },
    openSearch: () => searchFor(doc).open(),
    font: {
      get: () => Pane.font,
      set: (v) => Pane.setFont(v, doc),
    },
    createPane: (options) => new Pane(options),
    getTheme: () => globalChrome(space).theme,
    setTheme: (theme) => setGlobalChrome(space, { theme }),
    getStyle: () => globalChrome(space).style,
    setStyle: (style) => setGlobalChrome(space, { style }),
    getAccent: () => {
      const first = panesOf(space)[0]
      return first ? resolvedAccent(first.element) : globalChrome(space).accent
    },
    setAccent: (accent) => setGlobalChrome(space, { accent }),
    getNumbers: () => globalChrome(space).numbers,
    setNumbers: (numbers) => setGlobalChrome(space, { numbers }),
    hoverControls: hoverControlsToggle(doc),
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
        syncNotches(doc)
      },
    },
    glass: {
      get: () => Pane.glass,
      set: (v) => Pane.setGlass(v, doc),
    },
  })
  notch.setScope(space.root, space.hiding)
  notches.set(space, notch)
}

/** the panes a namespace's settings restyle live: its floating ones, plus inline ones in its root */
function globalPanes(space: Namespace): Pane[] {
  const { root } = space
  if (!root) return panesOf(space)
  const inline = trackedPanes(space.document).filter(
    (p) => !floatingPanes.has(p) && root.contains(p.element),
  )
  return [...panesOf(space), ...inline]
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
 * The look a namespace's settings panel shows: what it last broadcast, or its
 * primary pane's own chrome until something is set.
 */
function globalChrome(space: Namespace): PaneChrome {
  return resolveChrome(chromeStore(space).get(), panesOf(space)[0])
}

/**
 * Broadcast part of the chrome to every pane in a namespace, in both views.
 * Each pane saves it as its own, so a later per-pane tweak still sticks, and
 * the stored copy seeds panes mounted after this.
 */
function setGlobalChrome(space: Namespace, patch: Partial<PaneChrome>): void {
  chromeStore(space).patch(patch)
  if (hasDock(space)) writeDockState(space, patch)
  batchPanes(() => {
    for (const p of globalPanes(space)) p.adoptGlobalChrome(patch)
    if (hasDock(space)) applyDockChrome(space)
    syncNotch(space)
  })
}

function syncNotch(space: Namespace): void {
  if (batchDepth > 0) {
    queuedNotchSyncs.add(space)
    return
  }
  pinBoards.get(space)?.sync()
  const notch = notches.get(space)
  if (!notch) return
  // the notch re-declares the theme and size tokens, so it tracks the look
  // and scale the floating panes wear
  const el = notch.element
  const state = readNotchState()
  applyChrome(el, globalChrome(space))
  el.classList.toggle('tiao-glass', state.glass ?? DEFAULT_GLASS)
  const size = paneSizeFor(state.fontSize ?? 'small')
  const spacing = state.spacing ?? 's'
  el.classList.toggle('tiao-size-s', size === 's')
  el.classList.toggle('tiao-size-l', size === 'l')
  el.classList.toggle('tiao-spacing-m', spacing === 'm')
  el.classList.toggle('tiao-spacing-l', spacing === 'l')
  notch.sync()
}

/** the page-wide settings changed: every namespace's notch follows */
function syncNotches(doc: Document): void {
  for (const space of spaces.get(doc)?.values() ?? []) syncNotch(space)
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

/**
 * Tear a namespace's notch down once its last floating pane is gone, and the
 * document's shared machinery (dock, drawer, search, keys) once every one is.
 */
function releaseNotch(space: Namespace): void {
  if (panesOf(space).length > 0) return
  notches.get(space)?.dispose()
  notches.delete(space)
  notchWanted.delete(space)
  if (!isDefault(space)) closeDock(space)
  const doc = space.document
  if (panesIn(doc).length > 0) return
  releaseMobile(doc)
  closeDock(spaceFor(doc))
  releaseGlobalToggle(doc)
  searches.get(doc)?.dispose()
  searches.delete(doc)
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
  const current = THEME_CLASSES.find((cls) => el.classList.contains(cls)) ?? null
  if (current === next) return
  if (el.isConnected) pauseTransitions(el.ownerDocument)
  // toggle(cls, force) leaves a class that is already right untouched
  for (const cls of THEME_CLASSES) el.classList.toggle(cls, cls === next)
}

const pausedTransitions = new WeakSet<Document>()

/**
 * Hold every transition in tiao's UI until a frame has painted in the new
 * theme, so eased colors land with the rest instead of fading in after them.
 */
function pauseTransitions(doc: Document): void {
  const win = doc.defaultView
  if (!win || pausedTransitions.has(doc)) return
  pausedTransitions.add(doc)
  const root = doc.documentElement
  root.classList.add('tiao-theme-changing')
  win.requestAnimationFrame(() =>
    win.requestAnimationFrame(() => {
      root.classList.remove('tiao-theme-changing')
      pausedTransitions.delete(doc)
    }),
  )
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

/** whose sidebar holds `p` while it's docked: on a small screen the drawer takes every pane */
function dockOf(p: Pane): Namespace {
  const doc = p.namespace.document
  return mobileWatches.get(doc)?.controls ? spaceFor(doc) : p.namespace
}

function dockedIn(space: Namespace): Pane[] {
  return panesIn(space.document).filter((p) => p.docked && dockOf(p) === space)
}

/** collect a namespace's floating panes into its sidebar */
function dockPanes(space: Namespace): void {
  const { body } = ensureDock(createDockHost(space))
  for (const p of panesOf(space)) p.dockInto(body)
  applyDockChrome(space)
}

/**
 * The sidebar's shared chrome. Docked panes all render with it and keep their
 * own floating chrome aside, so the two views theme independently. Seeded from
 * the namespace's first pane the first time the sidebar opens.
 */
function dockChrome(space: Namespace): PaneChrome {
  return resolveChrome(readDockState(space), panesOf(space)[0] ?? panesIn(space.document)[0])
}

function applyDockChrome(space: Namespace): void {
  const chrome = dockChrome(space)
  const root = dockRoot(space)
  if (root) applyChrome(root, chrome)
  for (const p of dockedIn(space)) p.setChrome(chrome)
  if (isDefault(space)) syncDrawerControls(space.document)
  syncNotch(space)
}

function createDockHost(space: Namespace): DockHost {
  const doc = space.document
  const update = (patch: DockState) => {
    writeDockState(space, patch)
    applyDockChrome(space)
  }
  return {
    scope: space,
    document: doc,
    filter: (query) => {
      for (const p of dockedIn(space)) p.filter(query)
    },
    createPane: (options) => new Pane(options),
    getTheme: () => dockChrome(space).theme,
    setTheme: (theme) => update({ theme }),
    getStyle: () => dockChrome(space).style,
    setStyle: (style) => update({ style }),
    getAccent: () => {
      const root = dockRoot(space)
      return root ? resolvedAccent(root) : dockChrome(space).accent
    },
    setAccent: (accent) => update({ accent }),
    getNumbers: () => dockChrome(space).numbers,
    setNumbers: (numbers) => update({ numbers }),
    hoverControls: hoverControlsToggle(doc),
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
  /** how far a dragged inline pane sits from where its container lays it out */
  private inlineOffset = { x: 0, y: 0 }
  private _numbers = false
  /** preferred theme, which may be 'system'; the CSS class is the resolved look */
  private _theme: PaneTheme = 'dark'
  private _anchor: Anchor | null = null
  private _order: number
  private _stack = 0
  private _column = 0
  private margin: number
  private readonly doc: Document
  /** the tiao this pane belongs to: its notch, undo, chrome, and where it floats */
  readonly namespace: Namespace
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

  /** whether the window's floating panes are currently collected in the dock sidebar */
  static get docked(): boolean {
    return dockBody(spaceFor(document)) !== null
  }

  /**
   * Move a namespace's floating panes (a Document means its window namespace)
   * into a sidebar or back out to their free positions. The window's sidebar
   * reflows the page beside it; a rooted namespace's docks inside its element.
   * Returns the new state.
   */
  static toggleDock(scope: Document | Namespace = document): boolean {
    const space = toSpace(scope)
    if (!hasDock(space)) return false
    // a small screen keeps every pane in the drawer; flip what a wide one restores
    if (mobileWatches.get(space.document)?.controls) {
      const docked = !readDockState(space).docked
      writeDockState(space, { docked })
      return docked
    }
    batchPanes(() => {
      if (dockBody(space)) {
        for (const p of panesOf(space)) p.undock()
        closeDock(space)
      } else {
        dockPanes(space)
      }
      writeDockState(space, { docked: dockBody(space) !== null })
      syncNotch(space)
    })
    return dockBody(space) !== null
  }

  /** how big floating panes currently draw */
  static get fontSize(): PaneFontSize {
    return readNotchState().fontSize ?? 'small'
  }

  /** Draw every floating pane at `size`; small → s, normal → m, large → l. */
  static setFontSize(size: PaneFontSize, doc: Document = document): void {
    notchStore.patch({ fontSize: size })
    for (const p of panesIn(doc)) p.applyFontSize(size)
    syncNotches(doc)
  }

  /** how much padding floating panes currently draw */
  static get spacing(): PaneSpacing {
    return readNotchState().spacing ?? 's'
  }

  /** Draw every floating pane at `spacing`; 's' is the default padding. */
  static setSpacing(spacing: PaneSpacing, doc: Document = document): void {
    notchStore.patch({ spacing })
    for (const p of panesIn(doc)) p.spacing = spacing
    syncNotches(doc)
  }

  /** whether floating panes and the notch draw translucent and frosted */
  static get glass(): boolean {
    return readNotchState().glass ?? DEFAULT_GLASS
  }

  /**
   * Frost every floating pane and the notch (the default), or draw them opaque,
   * which saves the blur that re-runs every frame the page underneath changes.
   */
  static setGlass(glass: boolean, doc: Document = document): void {
    notchStore.patch({ glass })
    for (const p of panesIn(doc)) p.element.classList.toggle('tiao-glass', glass)
    syncDrawerControls(doc)
    syncNotches(doc)
  }

  /**
   * Root the namespace `name` in `element`: its panes float inside the element
   * instead of over the window, anchored to the element's corners and clamped
   * to it, so they scroll with the page; its notch rides the element's top edge
   * and stays shown, or with `hiding` follows the Hiding setting and retreats
   * until the pointer nears that edge; and its theme, style, accent, and
   * numbering also reach the inline panes inside it. The element must be
   * positioned (not `position: static`). Call it before mounting the
   * namespace's panes, and the returned function after disposing them.
   */
  static namespace(
    name: string,
    {
      root,
      document: doc = document,
      hiding = false,
    }: { root: HTMLElement; document?: Document; hiding?: boolean },
  ): () => void {
    const space = spaceFor(doc, name)
    space.root = root
    space.hiding = hiding
    space.observer?.disconnect()
    space.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            batchPanes(() => {
              for (const p of panesOf(space)) p.onViewportResize()
            })
          })
    space.observer?.observe(root)
    notches.get(space)?.setScope(root, hiding)
    return () => {
      if (space.root !== root) return
      space.observer?.disconnect()
      space.observer = null
      space.root = null
      space.hiding = false
      notches.get(space)?.setScope(null, false)
    }
  }

  /**
   * Hide or show every floating pane in a namespace (a Document means its
   * window namespace). If any are visible, hide all; otherwise show all.
   * Returns whether panes are now hidden.
   */
  static toggleAll(scope: Document | Namespace = document): boolean {
    const space = toSpace(scope)
    const doc = space.document
    const list = panesOf(space)
    if (list.length === 0) return false
    // on a small screen the closed drawer is the hidden state
    const controls = mobileWatches.get(doc)?.controls
    if (controls) return !controls.toggle()
    const hide = list.some((p) => !p.hidden)
    batchPanes(() => {
      for (const p of list) p.hidden = hide
      setDockVisible(space, !hide)
      // the saved hidden flag belongs to the window
      if (isDefault(space)) notchStore.patch({ hidden: hide })
      syncNotch(space)
    })
    return hide
  }

  /**
   * Restore every bound value in `doc` to the default its code declared and
   * forget the persisted copies. Floating panes also snap back to the
   * position their code declared. Theme and dock state stay as they are.
   */
  static resetValues(scope: Document | Namespace = document): void {
    const space = toSpace(scope)
    // one undo step brings every value back
    historyFor(space).batch(() => {
      for (const p of trackedOf(space)) {
        walkBindings(p, (b) => b.reset())
        p.values?.clear()
        p.resetPosition()
      }
    })
    packAnchored(space)
  }

  /** whether there is a value edit to step back over in a namespace */
  static canUndo(scope: Document | Namespace = document): boolean {
    return historyFor(toSpace(scope)).canUndo
  }

  static canRedo(scope: Document | Namespace = document): boolean {
    return historyFor(toSpace(scope)).canRedo
  }

  /**
   * Step back over the last value edit in `doc` (a global reset or an import
   * counts as one). The last HISTORY_LIMIT (10) edits are kept.
   */
  static undo(scope: Document | Namespace = document): void {
    historyFor(toSpace(scope)).undo()
  }

  static redo(scope: Document | Namespace = document): void {
    historyFor(toSpace(scope)).redo()
  }

  /** how many editable rows in `doc` differ from the default their code declared */
  static countOverrides(scope: Document | Namespace = document): number {
    let count = 0
    for (const p of trackedOf(toSpace(scope))) {
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
  static revealOverrides(scope: Document | Namespace = document): number {
    const space = toSpace(scope)
    let total = 0
    let shown = false
    batchPanes(() => {
      for (const p of trackedOf(space)) {
        const found: BindingApi<unknown>[] = []
        for (const child of p.children) revealOverridden(child, found)
        if (found.length === 0) continue
        total += found.length
        if (presentRows(p, found)) shown = true
      }
      if (!shown) return
      setDockVisible(space, true)
      if (isDefault(space)) notchStore.patch({ hidden: false })
    })
    return total
  }

  /**
   * Outline `binding`'s row in the accent for a moment, first opening whatever
   * hides it: a hidden or collapsed pane, folders, and tab pages. Returns
   * whether a pane in `doc` holds it.
   */
  static reveal(binding: BindingApi<unknown>, doc: Document = document): boolean {
    const pane = trackedPanes(doc).find((p) => revealItem(p, binding))
    if (!pane) return false
    batchPanes(() => {
      if (!presentRows(pane, [binding])) return
      setDockVisible(dockOf(pane), true)
      notchStore.patch({ hidden: false })
    })
    return true
  }

  /** typeface every pane draws with */
  static get font(): PaneFont {
    return readNotchState().font ?? DEFAULT_FONT
  }

  static setFont(font: PaneFont, doc: Document = document): void {
    notchStore.patch({ font })
    if (font !== 'geist') {
      applyFont(doc, font)
      return
    }
    // panes already on screen keep their face until Geist is in, rather than hide while it loads
    void loadGeist(doc).then(() => {
      if (Pane.font === 'geist') applyFont(doc, font)
    })
  }

  /** whether rows show just their values until hovered */
  static get hoverControls(): boolean {
    return readNotchState().hoverControls ?? false
  }

  /**
   * Show every row as just its value until the pointer comes over it, when
   * slider tracks, scrub grips, dropdown carets, and field backgrounds return.
   * Screens that can't hover always show them.
   */
  static setHoverControls(hoverControls: boolean, doc: Document = document): void {
    notchStore.patch({ hoverControls })
    applyHoverControls(doc, hoverControls)
  }

  /**
   * Every value the id'd panes in `doc` persist, as `pane id -> row path ->
   * value` (the shape storage holds), ready for JSON and importValues.
   */
  static exportValues(
    scope: Document | Namespace = document,
  ): Record<string, Record<string, unknown>> {
    const space = toSpace(scope)
    const out: Record<string, Record<string, unknown>> = {}
    for (const [id, p] of panes) {
      if (p.namespace !== space) continue
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
  static importValues(data: unknown, scope: Document | Namespace = document): number {
    const space = toSpace(scope)
    if (!isRecord(data)) return 0
    let applied = 0
    // one undo step takes the whole import back
    historyFor(space).batch(() => {
      for (const [id, values] of Object.entries(data)) {
        const p = panes.get(id)
        if (!p || p.namespace !== space || !isRecord(values)) continue
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
    const space =
      typeof options.namespace === 'object'
        ? toSpace(options.namespace)
        : spaceFor(doc, options.namespace)
    const registry = new PluginRegistry(globalRegistry)
    const host: BladeHost = { document: doc, registry, pins: pinBoardFor(space) }
    const storageKey = paneStorageKey(options)
    if (storageKey) {
      host.values = createValueStore(storageKey)
      host.pinStore = jsonStore(`${storageKey}:pins`)
    }
    // the same panes trackedPanes() counts: floating or id'd, never a menu's own
    if (!options.container || options.id !== undefined) {
      host.onSettle = (binding, from, to) => historyFor(space).record(binding, from, to)
    }
    super(host)
    this.values = host.values ?? null
    this.store = storageKey ? jsonStore<PersistedState>(storageKey) : null
    this.options = options
    this.paneRegistry = registry
    this.doc = doc
    this.namespace = space
    this._expanded = options.expanded ?? true
    this.floating = !options.container
    this._draggable = options.draggable ?? this.floating
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
      this.element.classList.toggle('tiao-rooted', space.root !== null)
      this._anchor = options.anchor ?? 'top-right'
    }
    if (options.width !== undefined) this.element.style.width = `${options.width}px`
    if (options.maxHeight !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${options.maxHeight}px`)
    }
    if (options.theme) this.applyTheme(options.theme)
    // the global font size covers floating panes; inline ones keep their own
    const notchState = readNotchState()
    applyFont(doc, notchState.font ?? DEFAULT_FONT)
    applyHoverControls(doc, notchState.hoverControls ?? false)
    if (this.floating) this.applyFontSize(notchState.fontSize ?? 'small')
    else if (options.size) this.size = options.size
    if (this.floating) {
      this.spacing = notchState.spacing ?? 's'
      this.element.classList.toggle('tiao-glass', notchState.glass ?? DEFAULT_GLASS)
    }

    // restore persisted state before first paint: this pane's own saved chrome
    // wins, then whatever the global settings panel last broadcast
    const persisted = this.loadState()
    if (persisted.w !== undefined) this.element.style.width = `${persisted.w}px`
    if (persisted.hMax !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${persisted.hMax}px`)
    }
    if (persisted.expanded !== undefined) this._expanded = persisted.expanded
    const spaceChrome = chromeStore(space).get()
    this._theme = persisted.theme ?? spaceChrome.theme ?? 'dark'
    applyThemeClass(this.element, this._theme)
    applyStyleClass(
      this.element,
      normalizeStyle(persisted.style ?? spaceChrome.style ?? options.style),
    )
    const accent = persisted.accent ?? spaceChrome.accent
    if (accent) this.applyTheme({ accent })
    if (persisted.draggable !== undefined) this._draggable = persisted.draggable
    this._numbers = persisted.numbers ?? spaceChrome.numbers ?? false
    if (this.floating) {
      if (persisted.x !== undefined && persisted.y !== undefined) {
        this.moveTo(persisted.x, persisted.y)
      } else if (persisted.anchor) {
        this._anchor = persisted.anchor
      }
    }
    this.applyExpanded()
    this.applyDraggable()
    const mobile = this.floating && watchMobile(doc)
    this.hidden =
      options.hidden ??
      (this.floating && !mobile && isDefault(space) && (notchState.hidden ?? false))

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

    // floating panes move in the window; inline ones shift by `translate`, inside their container
    let baseX = 0
    let baseY = 0
    let baseW = 0
    let baseH = 0
    let inlineBounds = { left: 0, right: 0, top: 0, bottom: 0 }
    const canDrag = () => this._draggable && (!this.floating || this.movable)
    this.disposers.push(
      draggable(this.titlebar, {
        // pointer capture would swallow the action buttons' clicks
        filter: (e) =>
          (this.floating || this._draggable) &&
          !(e.target as Element | null)?.closest?.('.tiao-titlebar-btn'),
        onStart: () => {
          const rect = this.element.getBoundingClientRect()
          suppressClick = false
          if (this.floating) {
            const origin = this.origin()
            baseX = rect.left - origin.x
            baseY = rect.top - origin.y
            // size is captured once so each move avoids a forced layout read
            baseW = rect.width
            baseH = rect.height
            return
          }
          baseX = this.inlineOffset.x
          baseY = this.inlineOffset.y
          // how far the pane can shift each way and still sit inside its container
          const box = (options.container ?? this.element).getBoundingClientRect()
          inlineBounds = {
            left: box.left - rect.left + baseX,
            right: box.right - rect.right + baseX,
            top: box.top - rect.top + baseY,
            bottom: box.bottom - rect.bottom + baseY,
          }
        },
        onMove: (s) => {
          if (!canDrag() || !s.moved) return
          suppressClick = true
          if (this.floating) {
            this.setPosition(baseX + s.dx, baseY + s.dy, baseW, baseH)
            return
          }
          const { left, right, top, bottom } = inlineBounds
          this.inlineOffset = {
            x: clamp(baseX + s.dx, left, Math.max(left, right)),
            y: clamp(baseY + s.dy, top, Math.max(top, bottom)),
          }
          this.element.style.translate = `${this.inlineOffset.x}px ${this.inlineOffset.y}px`
        },
        onEnd: (s) => {
          if (!canDrag() || !s.moved) return
          // moved can become true on pointerup alone (no prior moved onMove)
          suppressClick = true
          if (this.floating) {
            // persist the clamped position applied by moveTo, not the raw drag
            const rect = this.element.getBoundingClientRect()
            const origin = this.origin()
            this.saveState({ x: rect.left - origin.x, y: rect.top - origin.y, anchor: undefined })
          }
          // clear if no click follows (pointerup outside the titlebar)
          setTimeout(() => {
            suppressClick = false
          }, 0)
        },
      }),
    )

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
        hoverControls: hoverControlsToggle(doc),
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
        if (binding && !binding.monitor) openRowToolbar(binding, binding.element)
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
        scheduleValueSync(space)
      }),
      () => scheduleValueSync(space),
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
      if (options.notch !== false) notchWanted.add(space)
      if (mobile) {
        applyMobile(doc, true)
      } else if (options.notch !== false) {
        // a previously docked session re-opens the sidebar before the first mount
        if (hasDock(space) && readDockState(space).docked) ensureDock(createDockHost(space))
        ensureNotch(space)
      }
      this.disposers.push(() => {
        floatingPanes.delete(this)
        const anchor = this._anchor
        releaseNotch(space)
        syncNotch(space)
        if (anchor) packAnchored(space, anchor)
      })
    }

    const dock = this.floating ? dockBody(dockOf(this)) : null
    if (dock) {
      this.dockInto(dock)
      // also themes the sidebar shell, which a restored dock has not seen yet
      applyDockChrome(dockOf(this))
    } else {
      ;(options.container ?? space.root ?? doc.body).append(this.element)
    }
    // a hidden session folds the sidebar the same way toggleAll does
    if (this.floating && this.hidden && !mobile) setDockVisible(space, false)
    // a persisted free position may be off-screen on a smaller window
    this.clampToViewport()
    if (this.floating && this._anchor && !this.docked) packAnchored(space, this._anchor)
    if (this.floating) this.disposers.push(observePaneSize(this))
    syncNotch(space)

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
    syncNotch(this.namespace)
    if (this._anchor) packAnchored(this.namespace, this._anchor)
  }

  /** sidebar position, z-index style: lower sorts first, ties keep creation order */
  get order(): number {
    return this._order
  }
  set order(v: number) {
    if (this._order === v) return
    this._order = v
    this.element.dataset['tiaoOrder'] = String(v)
    const body = this.docked ? dockBody(dockOf(this)) : null
    if (body) this.insertDocked(body)
    else if (this._anchor) packAnchored(this.namespace, this._anchor)
  }

  get draggable(): boolean {
    return this._draggable
  }
  set draggable(v: boolean) {
    if (this._draggable === v) return
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
    packAnchored(this.namespace, anchor)
    if (prev && prev !== anchor) packAnchored(this.namespace, prev)
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
    const box = spaceSize(this.namespace)
    if (w) x = clamp(x, 0, Math.max(0, box.width - w))
    if (h) y = clamp(y, 0, Math.max(0, box.height - h))
    const s = this.element.style
    s.left = `${x}px`
    s.top = `${y}px`
    s.right = 'auto'
    s.bottom = 'auto'
    s.transform = 'none'
    if (prev) packAnchored(this.namespace, prev)
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
            baseLeft = rect.left - this.origin().x
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
    if (this._anchor && this.movable && !this.hidden) packAnchored(this.namespace, this._anchor)
  }

  /** internal: the window resized (coalesced to one frame for every pane) */
  onViewportResize(): void {
    if (this._anchor) packAnchored(this.namespace, this._anchor)
    else this.clampToViewport()
  }

  /** re-clamp a free-positioned pane into the box it floats in (anchored panes track their edges) */
  private clampToViewport(): void {
    if (!this.movable || this._anchor) return
    const rect = this.element.getBoundingClientRect()
    if (!rect.width) return
    const origin = this.origin()
    const left = rect.left - origin.x
    const top = rect.top - origin.y
    const box = spaceSize(this.namespace)
    const x = clamp(left, 0, Math.max(0, box.width - rect.width))
    const y = clamp(top, 0, Math.max(0, box.height - rect.height))
    if (x !== left || y !== top) this.moveTo(x, y)
  }

  /** the top left of the box this pane floats in, in viewport coordinates */
  private origin(): { x: number; y: number } {
    const root = this.namespace.root
    if (!root) return { x: 0, y: 0 }
    const rect = root.getBoundingClientRect()
    return { x: rect.left + root.clientLeft, y: rect.top + root.clientTop }
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
    const box = spaceSize(this.namespace)
    const centerX = () => {
      const width = size?.width ?? this.element.offsetWidth
      return `${Math.round((box.width - width) / 2)}px`
    }
    // a lone pane centers itself; a packed one sits `stack` from the middle
    const centerY = () => {
      const viewH = box.height
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
    this.element.classList.toggle(
      'tiao-draggable',
      this._draggable && (!this.floating || this.movable),
    )
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
    if (this._anchor) packAnchored(this.namespace, this._anchor)
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
    ;(this.namespace.root ?? this.doc.body).append(this.element)
    if (this._anchor) packAnchored(this.namespace, this._anchor)
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
