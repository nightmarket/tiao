import { Container, FolderApi, TabApi, markPointerBlur, type BladeHost } from './blade'
import { ensureBuiltins } from './controls/index'
import { installCaret } from './controls/caret'
import { collapseSelection, draggable, gearIcon, h, icon, searchIcon } from './dom'
import { createPaneMenu } from './pane-menu'
import { PluginRegistry, globalRegistry, type TiaoPlugin } from './plugin'
import { injectStyles } from './styles'
import { clamp } from './util'

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
  width?: number
  document?: Document
  /** internal: set false to omit the settings menu (used by the menu's own pane) */
  menu?: boolean
}

/** explicit `undefined` clears a key on save (JSON.stringify drops it) */
interface PersistedState {
  x?: number | undefined
  y?: number | undefined
  expanded?: boolean | undefined
  anchor?: Anchor | undefined
  draggable?: boolean | undefined
  theme?: PaneTheme | undefined
  accent?: string | undefined
  /** width / max-height set by edge-resizing */
  w?: number | undefined
  hMax?: number | undefined
  /** section numbering on folder titles */
  numbers?: boolean | undefined
}

export type PaneTheme = 'light' | 'dark'

export type PaneSize = 's' | 'm' | 'l'

/** default --tiao-accent, used when the computed style is unavailable (e.g. jsdom) */
const DEFAULT_ACCENT = '#3478f6'

/** edge-resize bounds */
const MIN_WIDTH = 200
const MAX_WIDTH = 640
const MIN_HEIGHT = 120
const MAX_HEIGHT = 2000

const panes = new Map<string, Pane>()

/** shared stacking counter so the last-interacted floating pane wins */
let zTop = 9999

export class Pane extends Container {
  readonly element: HTMLElement
  readonly rack: HTMLElement
  private titlebar: HTMLElement
  private searchbar: HTMLElement
  private searchInput: HTMLInputElement
  private _expanded: boolean
  private _draggable: boolean
  private _numbers = false
  private _anchor: Anchor | null = null
  private margin: number
  private readonly doc: Document
  private readonly floating: boolean
  private options: PaneOptions
  private paneRegistry: PluginRegistry

  /** look up a live pane by id */
  static get(id: string): Pane | undefined {
    return panes.get(id)
  }

  constructor(options: PaneOptions = {}) {
    ensureBuiltins(globalRegistry)
    const doc = options.document ?? document
    const registry = new PluginRegistry(globalRegistry)
    const host: BladeHost = { document: doc, registry }
    super(host)
    this.options = options
    this.paneRegistry = registry
    this.doc = doc
    this._expanded = options.expanded ?? true
    this.floating = !options.container
    this._draggable = this.floating && (options.draggable ?? true)
    this.margin = options.margin ?? 8

    injectStyles(doc)

    this.rack = h('div', 'tiao-rack')
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
    this.titlebar = h(
      'div',
      'tiao-titlebar',
      collapseButton,
      h('div', 'tiao-titlebar-actions', searchBtn, gear),
    )
    this.searchInput = h('input', 'tiao-search-input')
    this.searchInput.type = 'search'
    this.searchInput.placeholder = 'Search'
    this.searchbar = h('div', 'tiao-searchbar', this.searchInput)
    const body = h('div', 'tiao-pane-body', h('div', 'tiao-pane-clip', this.rack))
    this.element = h('div', 'tiao-pane', this.titlebar, this.searchbar, body)

    if (this.floating) {
      this.element.classList.add('tiao-floating')
      this._anchor = options.anchor ?? 'top-right'
    }
    if (options.width !== undefined) this.element.style.width = `${options.width}px`
    if (options.maxHeight !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${options.maxHeight}px`)
    }
    if (options.theme) this.applyTheme(options.theme)
    if (options.size) this.size = options.size

    // restore persisted state before first paint
    const persisted = this.loadState()
    if (persisted?.w !== undefined) this.element.style.width = `${persisted.w}px`
    if (persisted?.hMax !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${persisted.hMax}px`)
    }
    if (persisted?.expanded !== undefined) this._expanded = persisted.expanded
    if (persisted?.theme) this.applyThemeMode(persisted.theme)
    if (persisted?.accent) this.applyTheme({ accent: persisted.accent })
    if (persisted?.draggable !== undefined && this.floating) this._draggable = persisted.draggable
    if (persisted?.numbers !== undefined) this._numbers = persisted.numbers
    if (this.floating) {
      if (persisted?.x !== undefined && persisted?.y !== undefined) {
        this.moveTo(persisted.x, persisted.y)
      } else {
        if (persisted?.anchor) this._anchor = persisted.anchor
        this.applyAnchor()
      }
    }
    this.applyExpanded()
    this.applyDraggable()
    this.hidden = options.hidden ?? false

    // collapse on any titlebar click except the action buttons (and not right after a drag)
    let dragged = false
    const onTitlebarClick = (e: MouseEvent) => {
      if (dragged) return
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
            dragged = false
          },
          onMove: (s) => {
            if (!this._draggable || !s.moved) return
            dragged = true
            this.setPosition(baseX + s.dx, baseY + s.dy, baseW, baseH)
          },
          onEnd: (s) => {
            if (this._draggable && s.moved) {
              // persist the clamped position applied by moveTo, not the raw drag
              const rect = this.element.getBoundingClientRect()
              this.saveState({ x: rect.left, y: rect.top, anchor: undefined })
            }
            // let the click handler observe `dragged`, then reset
            setTimeout(() => {
              dragged = false
            }, 0)
          },
        }),
      )
    }

    if (this.floating) this.installResizeHandles()

    // settings menu: gear click or right-click anywhere on the pane
    if (options.menu !== false) {
      const menu = createPaneMenu({
        element: this.element,
        document: doc,
        createPane: (o) => new Pane(o),
        getDraggable: () => this._draggable,
        setDraggable: (v) => {
          this.draggable = v
        },
        getAnchor: () => this._anchor,
        setAnchor: (anchor) => {
          this.anchor = anchor
        },
        getTheme: () => this.theme,
        setTheme: (theme) => {
          this.theme = theme
        },
        getAccent: () => this.accent,
        setAccent: (accent) => {
          this.accent = accent
        },
        getNumbers: () => this._numbers,
        setNumbers: (v) => {
          this.numbers = v
        },
        onDispose: (fn) => this.disposers.push(fn),
      })
      const onGearClick = () => menu.toggle()
      gear.addEventListener('click', onGearClick)
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault()
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

    // free-positioned panes must stay inside the window when it shrinks
    if (this.floating) {
      const win = doc.defaultView
      if (win) {
        const onResize = () => this.clampToViewport()
        win.addEventListener('resize', onResize)
        this.disposers.push(() => win.removeEventListener('resize', onResize))
      }
    }

    if (options.toggleKey) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== options.toggleKey) return
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        this.hidden = !this.hidden
      }
      doc.addEventListener('keydown', onKey)
      this.disposers.push(() => doc.removeEventListener('keydown', onKey))
    }

    ;(options.container ?? doc.body).append(this.element)
    // a persisted free position may be off-screen on a smaller window
    this.clampToViewport()

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
    if (!this.floating || anchor === null) return
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
    return this.element.classList.contains('tiao-theme-dark') ? 'dark' : 'light'
  }
  set theme(v: PaneTheme) {
    this.applyThemeMode(v)
    this.saveState({ theme: v })
  }

  /** current --tiao-accent (inline override, else the themed default) */
  get accent(): string {
    const inline = this.element.style.getPropertyValue('--tiao-accent').trim()
    if (inline) return inline
    const win = this.doc.defaultView
    const computed = win?.getComputedStyle(this.element).getPropertyValue('--tiao-accent').trim()
    return computed || DEFAULT_ACCENT
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
      const handle = h('div', `tiao-resize tiao-resize-${edge}`)
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
    if (!this.floating || this._anchor) return
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

  private applyThemeMode(theme: PaneTheme): void {
    this.element.classList.toggle('tiao-theme-dark', theme === 'dark')
  }

  private applyDraggable(): void {
    this.element.classList.toggle('tiao-draggable', this._draggable)
  }

  private applyExpanded(): void {
    this.element.classList.toggle('tiao-expanded', this._expanded)
    this.titlebar
      .querySelector('.tiao-titlebar-main')
      ?.setAttribute('aria-expanded', String(this._expanded))
  }

  private storageKey(): string | null {
    if (!this.options.id || this.options.storage === false) return null
    return `tiao:${this.options.id}`
  }

  private loadState(): PersistedState | null {
    const key = this.storageKey()
    if (!key) return null
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as PersistedState) : null
    } catch {
      return null
    }
  }

  private saveState(patch: PersistedState): void {
    const key = this.storageKey()
    if (!key) return
    try {
      // JSON.stringify drops keys explicitly set to undefined, clearing them
      localStorage.setItem(key, JSON.stringify({ ...this.loadState(), ...patch }))
    } catch {
      /* storage unavailable */
    }
  }
}
