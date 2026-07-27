import {
  Container,
  FolderApi,
  TabApi,
  markPointerBlur,
  walkBindings,
  type BladeHost,
} from './blade'
import { ensureBuiltins } from './controls/index'
import { installCaret } from './controls/caret'
import {
  closeDock,
  dockBody,
  dockRoot,
  ensureDock,
  readDockState,
  setDockVisible,
  writeDockState,
  type DockHost,
  type DockState,
} from './dock'
import { collapseSelection, draggable, gearIcon, h, icon, searchIcon, withDocument } from './dom'
import { createNotch, type Notch } from './notch'
import { createPaneMenu } from './pane-menu'
import { PluginRegistry, globalRegistry, type TiaoPlugin } from './plugin'
import { injectStyles } from './styles'
import { clamp, jsonStore, type JSONStore } from './util'
import { createValueStore, type ValueStore } from './values'

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
  /** surface style: bouba (rounded glass) or kiki (sharp / flat) */
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

/** Surface style (shape/elevation) — orthogonal to PaneTheme colors. */
export type PaneStyle = 'bouba' | 'kiki'

const STYLE_CLASS: Record<PaneStyle, string | null> = {
  bouba: null,
  kiki: 'tiao-style-kiki',
}

/** Map legacy persisted ids onto the bouba/kiki axis. */
function normalizeStyle(v: string | undefined | null): PaneStyle {
  if (v === 'kiki' || v === 'arena') return 'kiki'
  return 'bouba' // includes 'default', 'bouba', missing
}

export type PaneSize = 's' | 'm' | 'l'

/**
 * How big every floating pane draws, set once for all of them from the notch.
 * 'small' is each pane's own declared size — the default this library ships.
 */
export type PaneFontSize = 'small' | 'normal'

/** default --tiao-accent, used when the computed style is unavailable (e.g. jsdom) */
const DEFAULT_ACCENT = '#facc15'

/** inline styles a floating pane owns; parked and restored around docking */
const FREE_PROPS = ['left', 'top', 'right', 'bottom', 'transform', 'width', 'z-index']

/** edge-resize bounds */
const MIN_WIDTH = 200
const MAX_WIDTH = 640
const MIN_HEIGHT = 120
const MAX_HEIGHT = 2000

const panes = new Map<string, Pane>()

/** all live floating panes (for the global H toggle) */
const floatingPanes = new Set<Pane>()

/** one global-toggle listener per document */
const globalToggleInstalled = new WeakSet<Document>()

/** shared stacking counter so the last-interacted floating pane wins */
let zTop = 9999

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

function ensureGlobalToggle(doc: Document): void {
  if (globalToggleInstalled.has(doc)) return
  globalToggleInstalled.add(doc)
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'h' && e.key !== 'H') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isTypingTarget(e.target)) return
    Pane.toggleAll(doc)
  })
}

/** one notch bar per document, mounted with the first floating pane */
const notches = new WeakMap<Document, Notch>()

/**
 * Notch state shared by every pane in the page. The chrome keys are the global
 * settings panel's last broadcast: live panes take them immediately, and panes
 * mounted later inherit them unless they carry saved chrome of their own.
 */
interface NotchState {
  fontSize?: PaneFontSize | undefined
  /** the notch vanishes until the pointer comes near the top edge */
  hiding?: boolean | undefined
  theme?: PaneTheme | undefined
  style?: PaneStyle | undefined
  accent?: string | undefined
  numbers?: boolean | undefined
}

const notchStore = jsonStore<NotchState>('tiao:notch')

function readNotchState(): NotchState {
  return notchStore.get()
}

function panesIn(doc: Document): Pane[] {
  return [...floatingPanes].filter((p) => p.element.ownerDocument === doc)
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
      hiding: {
        get: () => readNotchState().hiding ?? true,
        set: (hiding) => {
          notchStore.patch({ hiding })
          syncNotch(doc)
        },
      },
    }),
  )
}

/**
 * The look the global settings panel shows: what it last broadcast, or the
 * primary pane's own chrome until something is set.
 */
function globalChrome(doc: Document): PaneChrome {
  const saved = readNotchState()
  const first = panesIn(doc)[0]
  return {
    theme: saved.theme ?? first?.theme ?? 'dark',
    style: normalizeStyle(saved.style ?? first?.style),
    accent: saved.accent ?? first?.chrome.accent ?? '',
    numbers: saved.numbers ?? first?.numbers ?? false,
  }
}

/**
 * Broadcast part of the chrome to every pane in both views. Each pane saves it
 * as its own, so a later per-pane tweak still sticks, and the stored copy seeds
 * panes mounted after this.
 */
function setGlobalChrome(doc: Document, patch: Partial<PaneChrome>): void {
  notchStore.patch(patch)
  writeDockState(patch)
  for (const p of panesIn(doc)) p.adoptGlobalChrome(patch)
  applyDockChrome(doc)
  syncNotch(doc)
}

function syncNotch(doc: Document): void {
  const notch = notches.get(doc)
  if (!notch) return
  // the notch re-declares the theme tokens, so it tracks the look the panes wear
  applyChrome(notch.element, globalChrome(doc))
  notch.sync()
}

/** tear the notch and dock down once the last floating pane is gone */
function releaseNotch(doc: Document): void {
  if (panesIn(doc).length > 0) return
  notches.get(doc)?.dispose()
  notches.delete(doc)
  closeDock(doc)
}

/** the look of a pane, applied as a unit so the dock can swap it wholesale */
export interface PaneChrome {
  theme: PaneTheme
  style: PaneStyle
  accent: string
  numbers: boolean
}

/** theme tokens only; `numbers` needs a Pane and is applied by setChrome */
function applyChrome(el: HTMLElement, chrome: PaneChrome): void {
  applyThemeClass(el, chrome.theme)
  applyStyleClass(el, chrome.style)
  if (chrome.accent) el.style.setProperty('--tiao-accent', chrome.accent)
  else el.style.removeProperty('--tiao-accent')
}

function applyThemeClass(el: HTMLElement, theme: PaneTheme): void {
  // preference stays on the element so a system change can find who to repaint
  el.dataset.tiaoTheme = theme
  const resolved = resolveTheme(theme, el.ownerDocument)
  for (const cls of Object.values(THEME_CLASS)) {
    if (cls) el.classList.remove(cls)
  }
  const next = THEME_CLASS[resolved]
  if (next) el.classList.add(next)
}

function applyStyleClass(el: HTMLElement, style: PaneStyle): void {
  for (const cls of Object.values(STYLE_CLASS)) {
    if (cls) el.classList.remove(cls)
  }
  const next = STYLE_CLASS[style]
  if (next) el.classList.add(next)
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
  const saved = readDockState()
  const first = panesIn(doc)[0]
  return {
    theme: saved.theme ?? first?.theme ?? 'dark',
    style: normalizeStyle(saved.style ?? first?.style),
    accent: saved.accent ?? first?.chrome.accent ?? '',
    numbers: saved.numbers ?? first?.numbers ?? false,
  }
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
  private searchbar: HTMLElement
  private searchInput: HTMLInputElement
  private _expanded: boolean
  private _draggable: boolean
  private _numbers = false
  /** preferred theme, which may be 'system'; the CSS class is the resolved look */
  private _theme: PaneTheme = 'dark'
  private _anchor: Anchor | null = null
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
    if (dockBody(doc)) {
      for (const p of panesIn(doc)) p.undock()
      closeDock(doc)
    } else {
      const body = ensureDock(createDockHost(doc))
      for (const p of panesIn(doc)) p.dockInto(body)
      applyDockChrome(doc)
    }
    const docked = dockBody(doc) !== null
    writeDockState({ docked })
    syncNotch(doc)
    return docked
  }

  /** how big floating panes currently draw */
  static get fontSize(): PaneFontSize {
    return readNotchState().fontSize ?? 'small'
  }

  /** Draw every floating pane at `size`; 'small' restores each declared size. */
  static setFontSize(size: PaneFontSize, doc: Document = document): void {
    notchStore.patch({ fontSize: size })
    for (const p of panesIn(doc)) p.applyFontSize(size)
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
    for (const p of list) p.hidden = hide
    setDockVisible(doc, !hide)
    syncNotch(doc)
    return hide
  }

  /**
   * Restore every bound value in `doc` to the default its code declared and
   * forget the persisted copies. Layout, theme, and dock state stay as they are.
   */
  static resetValues(doc: Document = document): void {
    // floating panes plus every id'd pane: inline panes without an id (the
    // settings menu's own pane) drive the chrome and must keep their values
    for (const p of new Set([...floatingPanes, ...panes.values()])) {
      if (p.element.ownerDocument !== doc) continue
      walkBindings(p, (b) => b.reset())
      p.values?.clear()
    }
  }

  constructor(options: PaneOptions = {}) {
    ensureBuiltins(globalRegistry)
    const doc = options.document ?? document
    const registry = new PluginRegistry(globalRegistry)
    const host: BladeHost = { document: doc, registry }
    const storageKey = paneStorageKey(options)
    if (storageKey) host.values = createValueStore(storageKey)
    super(host)
    this.values = host.values ?? null
    this.store = storageKey ? jsonStore<PersistedState>(storageKey) : null
    this.options = options
    this.paneRegistry = registry
    this.doc = doc
    this._expanded = options.expanded ?? true
    this.floating = !options.container
    this._draggable = this.floating && (options.draggable ?? true)
    this.margin = options.margin ?? 8

    injectStyles(doc)
    watchColorScheme(doc)

    // build the chrome under the pane's document so h()/icon() create
    // elements in the right realm (PaneOptions.document)
    const chrome = withDocument(doc, () => {
      const rack = h('div', 'tiao-rack')
      const gear = h('button', 'tiao-titlebar-btn tiao-pane-gear', gearIcon())
      gear.type = 'button'
      gear.title = 'Pane settings'
      gear.setAttribute('data-tiao-menu-trigger', '')
      const searchBtn = h('button', 'tiao-titlebar-btn tiao-pane-search', searchIcon())
      searchBtn.type = 'button'
      searchBtn.title = 'Search'
      const collapseButton = h(
        'button',
        'tiao-titlebar-main',
        icon('triangle'),
        h('span', 'tiao-pane-title', options.title ?? ''),
      )
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
      const body = h('div', 'tiao-pane-body', h('div', 'tiao-pane-clip', rack))
      const element = h('div', 'tiao-pane', titlebar, searchbar, body)
      return { rack, gear, searchBtn, titlebar, searchInput, searchbar, element }
    })
    const { gear, searchBtn } = chrome
    this.rack = chrome.rack
    this.titlebar = chrome.titlebar
    this.searchInput = chrome.searchInput
    this.searchbar = chrome.searchbar
    this.element = chrome.element

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
    if (this.floating) this.applyFontSize(notchState.fontSize ?? 'small')
    else if (options.size) this.size = options.size

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
      } else {
        if (persisted.anchor) this._anchor = persisted.anchor
        this.applyAnchor()
      }
    }
    this.applyExpanded()
    this.applyDraggable()
    this.hidden = options.hidden ?? false

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
      this.disposers.push(() =>
        this.element.removeEventListener('pointerdown', bringToFront, true),
      )

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
      const win = doc.defaultView
      if (win) {
        const onResize = () => this.clampToViewport()
        win.addEventListener('resize', onResize)
        this.disposers.push(() => win.removeEventListener('resize', onResize))
      }
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
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault()
        // docked panes are themed and searched from the sidebar header instead
        if (this.docked) return
        // right-clicking the open menu itself shouldn't toggle it closed
        if ((e.target as Element | null)?.closest?.('.tiao-pane-menu')) return
        menu.toggle()
      }
      this.element.addEventListener('contextmenu', onContextMenu)
      this.disposers.push(() => {
        gear.removeEventListener('click', onGearClick)
        this.element.removeEventListener('contextmenu', onContextMenu)
      })
    }

    // clicking anywhere outside a focused pane input deselects/commits it,
    // even when the click target swallows focus changes (e.g. canvases)
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
    doc.addEventListener('pointerdown', onDocPointerDown, true)
    this.disposers.push(() => doc.removeEventListener('pointerdown', onDocPointerDown, true))

    // wider custom caret over focused inputs (the native bar is easy to miss)
    this.disposers.push(installCaret(this.element, doc))

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
        releaseNotch(doc)
        syncNotch(doc)
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
    // a persisted free position may be off-screen on a smaller window
    this.clampToViewport()
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
    return this.titlebar.querySelector('.tiao-pane-title')?.textContent ?? ''
  }
  set title(v: string) {
    const el = this.titlebar.querySelector('.tiao-pane-title')
    if (el) el.textContent = v
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
    this._anchor = anchor
    this.applyAnchor()
    this.saveState({ anchor, x: undefined, y: undefined })
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
    this._anchor = null
    const win = this.doc.defaultView
    if (win && w) x = clamp(x, 0, Math.max(0, win.innerWidth - w))
    if (win && h) y = clamp(y, 0, Math.max(0, win.innerHeight - h))
    const s = this.element.style
    s.left = `${x}px`
    s.top = `${y}px`
    s.right = 'auto'
    s.bottom = 'auto'
    s.transform = 'none'
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

  private applyAnchor(): void {
    const anchor = this._anchor
    if (!anchor) return
    const s = this.element.style
    const m = `${this.margin}px`
    s.left = 'auto'
    s.right = 'auto'
    s.top = 'auto'
    s.bottom = 'auto'
    s.transform = 'none'
    switch (anchor) {
      case 'top-left':
        s.top = m
        s.left = m
        break
      case 'top-center':
        s.top = m
        s.left = '50%'
        s.transform = 'translateX(-50%)'
        break
      case 'top-right':
        s.top = m
        s.right = m
        break
      case 'left-center':
        s.left = m
        s.top = '50%'
        s.transform = 'translateY(-50%)'
        break
      case 'center':
        s.left = '50%'
        s.top = '50%'
        s.transform = 'translate(-50%, -50%)'
        break
      case 'right-center':
        s.right = m
        s.top = '50%'
        s.transform = 'translateY(-50%)'
        break
      case 'bottom-left':
        s.bottom = m
        s.left = m
        break
      case 'bottom-center':
        s.bottom = m
        s.left = '50%'
        s.transform = 'translateX(-50%)'
        break
      case 'bottom-right':
        s.bottom = m
        s.right = m
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
    container.append(this.element)
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
    this.applyAnchor()
    this.applyDraggable()
    this.clampToViewport()
  }

  /** internal: follow the global font size, falling back to the declared `size` */
  private applyFontSize(size: PaneFontSize): void {
    this.size = size === 'normal' ? 'l' : this.options.size ?? 'm'
  }

  private applyExpanded(): void {
    this.element.classList.toggle('tiao-expanded', this._expanded)
    this.titlebar
      .querySelector('.tiao-titlebar-main')
      ?.setAttribute('aria-expanded', String(this._expanded))
  }

  private loadState(): PersistedState {
    return this.store?.get() ?? {}
  }

  private saveState(patch: PersistedState): void {
    this.store?.patch(patch)
  }
}
