import { Container, type BladeHost } from './blade'
import { ensureBuiltins } from './controls/index'
import { draggable, gearIcon, h, icon } from './dom'
import { createPaneMenu } from './pane-menu'
import { PluginRegistry, globalRegistry, type TiaoPlugin } from './plugin'
import { injectStyles } from './styles'

export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'left-center'
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
  width?: number
  document?: Document
}

/** explicit `undefined` clears a key on save (JSON.stringify drops it) */
interface PersistedState {
  x?: number | undefined
  y?: number | undefined
  expanded?: boolean | undefined
  anchor?: Anchor | undefined
  draggable?: boolean | undefined
}

const panes = new Map<string, Pane>()

/** shared stacking counter so the last-interacted floating pane wins */
let zTop = 9999

export class Pane extends Container {
  readonly element: HTMLElement
  readonly rack: HTMLElement
  private titlebar: HTMLElement
  private _expanded: boolean
  private _draggable: boolean
  private _anchor: Anchor | null = null
  private margin: number
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
    this._expanded = options.expanded ?? true
    this.floating = !options.container
    this._draggable = this.floating && (options.draggable ?? true)
    this.margin = options.margin ?? 8

    injectStyles(doc)

    this.rack = h('div', 'tiao-rack')
    const gear = h('button', 'tiao-pane-gear', gearIcon())
    gear.type = 'button'
    gear.title = 'Pane settings'
    gear.setAttribute('data-tiao-menu-trigger', '')
    const collapseButton = h(
      'button',
      'tiao-titlebar-main',
      h('span', 'tiao-pane-title', options.title ?? ''),
      icon('chevron'),
    )
    collapseButton.type = 'button'
    this.titlebar = h('div', 'tiao-titlebar', gear, collapseButton)
    const body = h('div', 'tiao-pane-body', h('div', 'tiao-pane-clip', this.rack))
    this.element = h('div', 'tiao-pane', this.titlebar, body)

    if (this.floating) {
      this.element.classList.add('tiao-floating')
      this._anchor = options.anchor ?? 'top-right'
    }
    if (options.width !== undefined) this.element.style.width = `${options.width}px`
    if (options.maxHeight !== undefined) {
      this.element.style.setProperty('--tiao-max-height', `${options.maxHeight}px`)
    }
    if (options.theme) this.applyTheme(options.theme)

    // restore persisted state before first paint
    const persisted = this.loadState()
    if (persisted?.expanded !== undefined) this._expanded = persisted.expanded
    if (persisted?.draggable !== undefined && this.floating) this._draggable = persisted.draggable
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

    // collapse on any titlebar click except the gear (and not right after a drag)
    let dragged = false
    const onTitlebarClick = (e: MouseEvent) => {
      if (dragged) return
      if ((e.target as Element | null)?.closest?.('[data-tiao-menu-trigger]')) return
      this.expanded = !this.expanded
    }
    this.titlebar.addEventListener('click', onTitlebarClick)
    this.disposers.push(() => this.titlebar.removeEventListener('click', onTitlebarClick))

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
      this.disposers.push(
        draggable(this.titlebar, {
          // pointer capture would swallow the gear's click
          filter: (e) => !(e.target as Element | null)?.closest?.('[data-tiao-menu-trigger]'),
          onStart: () => {
            const rect = this.element.getBoundingClientRect()
            baseX = rect.left
            baseY = rect.top
            dragged = false
          },
          onMove: (s) => {
            if (!this._draggable || !s.moved) return
            dragged = true
            this.moveTo(baseX + s.dx, baseY + s.dy)
          },
          onEnd: (s) => {
            if (this._draggable && s.moved) {
              this.saveState({ x: baseX + s.dx, y: baseY + s.dy, anchor: undefined })
            }
            // let the click handler observe `dragged`, then reset
            setTimeout(() => {
              dragged = false
            }, 0)
          },
        }),
      )
    }

    // settings menu: gear click or right-click anywhere on the pane
    const menu = createPaneMenu({
      element: this.element,
      document: doc,
      getDraggable: () => this._draggable,
      setDraggable: (v) => {
        this.draggable = v
      },
      getAnchor: () => this._anchor,
      setAnchor: (anchor) => {
        this.anchor = anchor
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

    if (options.id) {
      panes.set(options.id, this)
      this.disposers.push(() => {
        if (panes.get(options.id as string) === this) panes.delete(options.id as string)
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
    this._anchor = null
    const s = this.element.style
    s.left = `${x}px`
    s.top = `${y}px`
    s.right = 'auto'
    s.bottom = 'auto'
    s.transform = 'none'
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
