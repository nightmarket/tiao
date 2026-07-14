import { Emitter } from './emitter'
import { h, icon, longPress, withDocument } from './dom'
import { onInterval } from './ticker'
import { Value } from './value'
import type { BindingOptions, PluginRegistry } from './plugin'

/** Provided by the root Pane to every descendant. */
export interface BladeHost {
  document: Document
  registry: PluginRegistry
}

/**
 * When a click lands outside a focused pane input, the pane blurs it on
 * pointerdown (see Pane). If that click lands on the same row, its later
 * `click` must not immediately re-activate the input we just deselected.
 */
let lastPointerBlurAt = 0
let lastPointerBlurRow: Element | null = null

/** internal: called by the Pane right before it blurs an input from a pointerdown */
export function markPointerBlur(row: Element | null): void {
  lastPointerBlurAt = Date.now()
  lastPointerBlurRow = row
}

function clickFollowsPointerBlur(row: Element): boolean {
  return lastPointerBlurRow === row && Date.now() - lastPointerBlurAt < 400
}

export interface TiaoChangeEvent<T = unknown> {
  value: T
  last: boolean
  target: BindingApi<T>
  key: string
}

export abstract class Item {
  abstract readonly element: HTMLElement
  private _parent: Container | null = null
  protected disposers: (() => void)[] = []
  private _hidden = false
  private _disabled = false
  private disposed = false

  get parent(): Container | null {
    return this._parent
  }
  set parent(v: Container | null) {
    this._parent = v
  }

  get hidden(): boolean {
    return this._hidden
  }
  set hidden(v: boolean) {
    this._hidden = v
    this.element.classList.toggle('tiao-hidden', v)
  }

  get disabled(): boolean {
    return this._disabled
  }
  set disabled(v: boolean) {
    this._disabled = v
    this.element.classList.toggle('tiao-disabled', v)
  }

  /** register cleanup to run when this item is disposed */
  onDispose(fn: () => void): void {
    this.disposers.push(fn)
  }

  /** internal: hide/show against a search query; returns whether this item matched */
  applySearch(query: string): boolean {
    const match = query === '' || this.searchText().toLowerCase().includes(query)
    this.element.classList.toggle('tiao-search-miss', !match)
    return match
  }

  /** text a search query matches against (labels, titles, ...) */
  protected searchText(): string {
    return ''
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const fn of this.disposers) fn()
    this.disposers = []
    this.element.remove()
    this.parent?.detach(this)
    this.parent = null
  }
}

interface ContainerEvents {
  change: TiaoChangeEvent
  [key: string]: unknown
}

export abstract class Container extends Item {
  /** element that receives children rows */
  abstract readonly rack: HTMLElement
  readonly children: Item[] = []
  protected emitter = new Emitter<ContainerEvents>()

  constructor(protected host: BladeHost) {
    super()
  }

  on(name: 'change', fn: (ev: TiaoChangeEvent) => void): () => void {
    return this.emitter.on(name, fn)
  }

  /** internal: bubble a change event up the tree */
  bubble(ev: TiaoChangeEvent): void {
    this.emitter.emit('change', ev)
    this.parent?.bubble(ev)
  }

  addBinding<O extends object, K extends keyof O & string>(
    target: O,
    key: K,
    options: BindingOptions = {},
  ): BindingApi<O[K]> {
    // all add* methods create under the host document so h()/icon() build
    // elements in the right realm (PaneOptions.document)
    const api = withDocument(
      this.host.document,
      () => new BindingApi<O[K]>(this.host, target as Record<string, O[K]>, key, options),
    )
    this.attach(api)
    return api
  }

  addFolder(params: {
    title: string
    expanded?: boolean
    collapsible?: boolean
    /** tints the folder title; caret and depth line get softer mixes of it */
    color?: string
  }): FolderApi {
    const api = withDocument(this.host.document, () => new FolderApi(this.host, params))
    this.attach(api)
    return api
  }

  addButton(params: { title: string; label?: string }): ButtonApi {
    const api = withDocument(this.host.document, () => new ButtonApi(params))
    this.attach(api)
    return api
  }

  addButtonGroup(params: { label?: string; buttons: Record<string, () => void> }): ButtonGroupApi {
    const api = withDocument(this.host.document, () => new ButtonGroupApi(params))
    this.attach(api)
    return api
  }

  addTab(params: { pages: { title: string }[] }): TabApi {
    const api = withDocument(this.host.document, () => new TabApi(this.host, params))
    this.attach(api)
    return api
  }

  addSeparator(): SeparatorApi {
    const api = withDocument(this.host.document, () => new SeparatorApi())
    this.attach(api)
    return api
  }

  addBlade(params: Record<string, unknown>): BladeApi {
    const api = withDocument(this.host.document, () => new BladeApi(this.host, params))
    this.attach(api)
    return api
  }

  protected attach(item: Item, index?: number): void {
    item.parent = this
    if (index !== undefined && index >= 0 && index < this.children.length) {
      const ref = this.children[index]
      this.children.splice(index, 0, item)
      if (ref) this.rack.insertBefore(item.element, ref.element)
      else this.rack.append(item.element)
    } else {
      this.children.push(item)
      this.rack.append(item.element)
    }
    if (item instanceof FolderApi) item.updateDepth()
    this.notifyStructure()
  }

  /** internal: remove bookkeeping only (called from Item.dispose) */
  detach(item: Item): void {
    const i = this.children.indexOf(item)
    if (i >= 0) this.children.splice(i, 1)
    this.notifyStructure()
  }

  /** internal: bubbles child add/remove to the root (the Pane renumbers sections) */
  notifyStructure(): void {
    this.parent?.notifyStructure()
  }

  /**
   * A container matches when its own title matches (whole subtree stays
   * visible) or when any descendant matches (folder shown, forced open so the
   * hits are reachable).
   */
  override applySearch(query: string): boolean {
    const titleMatch = query === '' || this.searchText().toLowerCase().includes(query)
    let childMatch = false
    for (const child of this.children) {
      if (child.applySearch(titleMatch ? '' : query)) childMatch = true
    }
    const match = titleMatch || childMatch
    this.element.classList.toggle('tiao-search-miss', !match)
    this.element.classList.toggle('tiao-search-open', query !== '' && childMatch && !titleMatch)
    return match
  }

  /** re-read all bindings in this subtree from their targets */
  refresh(): void {
    for (const child of this.children) {
      if (child instanceof BindingApi) child.refresh()
      else if (child instanceof Container) child.refresh()
      else if (child instanceof TabApi) child.refresh()
    }
  }

  override dispose(): void {
    for (const child of [...this.children]) child.dispose()
    this.emitter.clear()
    super.dispose()
  }
}

const DEFAULT_MONITOR_INTERVAL = 66

/** shared meta objects so per-tick polling does not allocate */
const MONITOR_META = { source: 'monitor' } as const
const GRAPH_MONITOR_META = { source: 'monitor', sample: true } as const
const REFRESH_META = { source: 'refresh' } as const

interface BindingEvents<T> {
  change: TiaoChangeEvent<T>
  [key: string]: unknown
}

export class BindingApi<T> extends Item {
  readonly element: HTMLElement
  readonly key: string
  readonly value: Value<T>
  private bindingEmitter = new Emitter<BindingEvents<T>>()
  private labelEl: HTMLElement | null = null
  private labelText: string

  constructor(
    host: BladeHost,
    private target: Record<string, T>,
    key: string,
    options: BindingOptions,
  ) {
    super()
    this.key = key
    const initial = target[key] as T
    const label = options.label ?? key
    this.labelText = label
    this.value = new Value<T>(initial)

    const plugin = options.readonly
      ? host.registry.findMonitor(initial, options)
      : host.registry.findInput(initial, options)
    if (!plugin) {
      throw new Error(`tiao: no ${options.readonly ? 'monitor' : 'input'} plugin accepts key "${key}" (value: ${JSON.stringify(initial)})`)
    }

    const view = plugin.create({
      document: host.document,
      value: this.value as Value<unknown>,
      options,
      label,
      onDispose: (fn) => this.disposers.push(fn),
    })

    if (view.full) {
      this.element = h('div', 'tiao-row tiao-row-full', view.element)
    } else {
      this.labelEl = h('div', 'tiao-label', label)
      this.element = h(
        'div',
        'tiao-row',
        this.labelEl,
        h('div', 'tiao-control', view.element),
      )
    }

    // clicking the row outside the concrete control activates it (focus input, open picker, ...);
    // long-pressing the label starts a scrub/drag when the plugin supports it
    if ((view.activate || view.beginScrub) && !view.full) {
      this.element.classList.add('tiao-row-activate')
      let suppressClick = false
      if (view.beginScrub) {
        this.disposers.push(
          longPress(this.element, {
            filter: (e) => {
              const t = e.target as Node | null
              return !(t && view.element.contains(t))
            },
            onLongPress: (e) => {
              suppressClick = true
              e.preventDefault()
              view.beginScrub?.(e)
            },
            onTap: () => {
              suppressClick = false
            },
          }),
        )
      }
      if (view.activate) {
        const onRowClick = (e: MouseEvent) => {
          if (suppressClick) {
            suppressClick = false
            return
          }
          const target = e.target as Node | null
          if (target && view.element.contains(target)) return
          // this click just deselected this row's input; don't immediately focus it again
          if (clickFollowsPointerBlur(this.element)) return
          view.activate?.()
        }
        this.element.addEventListener('click', onRowClick)
        this.disposers.push(() => this.element.removeEventListener('click', onRowClick))
      }
    }

    if (options.readonly) {
      this.element.classList.add('tiao-row-monitor')
      const interval = options.interval ?? DEFAULT_MONITOR_INTERVAL
      this.disposers.push(
        onInterval(() => {
          const next = this.target[this.key] as T
          const meta =
            options.view === 'graph' && Object.is(this.value.get(), next)
              ? GRAPH_MONITOR_META
              : MONITOR_META
          this.value.set(next, meta)
        }, interval),
      )
    }
    // Monitors emit actual changes too; repeated graph samples only advance
    // the internal timeline and never write back or become public events.
    this.disposers.push(
      this.value.subscribe((v, meta) => {
        // Repeated graph samples advance time without becoming public changes.
        if (meta.sample) return
        if (!options.readonly && meta.source !== 'refresh') this.target[this.key] = v
        const ev: TiaoChangeEvent<T> = {
          value: v,
          last: meta.last ?? true,
          target: this,
          key: this.key,
        }
        this.bindingEmitter.emit('change', ev)
        this.parent?.bubble(ev as TiaoChangeEvent)
      }),
    )
  }

  get label(): string {
    return this.labelEl?.textContent ?? this.labelText
  }
  set label(v: string) {
    this.labelText = v
    if (this.labelEl) this.labelEl.textContent = v
  }

  protected override searchText(): string {
    return `${this.label} ${this.key}`
  }

  on(name: 'change', fn: (ev: TiaoChangeEvent<T>) => void): () => void {
    return this.bindingEmitter.on(name, fn)
  }

  /** re-read the current value from the bound object */
  refresh(): void {
    this.value.set(this.target[this.key] as T, REFRESH_META)
  }

  override dispose(): void {
    this.bindingEmitter.clear()
    super.dispose()
  }
}

interface ButtonEvents {
  click: { target: ButtonApi }
  [key: string]: unknown
}

export class ButtonApi extends Item {
  readonly element: HTMLElement
  private buttonEmitter = new Emitter<ButtonEvents>()
  private buttonEl: HTMLButtonElement
  private labelText: string

  constructor(params: { title: string; label?: string }) {
    super()
    this.labelText = params.label ?? ''
    this.buttonEl = h('button', 'tiao-button', params.title)
    this.buttonEl.type = 'button'
    const onClick = () => {
      if (!this.disabled) this.buttonEmitter.emit('click', { target: this })
    }
    this.buttonEl.addEventListener('click', onClick)
    this.disposers.push(() => this.buttonEl.removeEventListener('click', onClick))

    this.element = params.label
      ? h('div', 'tiao-row', h('div', 'tiao-label', params.label), h('div', 'tiao-control', this.buttonEl))
      : h('div', 'tiao-row tiao-row-full', this.buttonEl)
  }

  get title(): string {
    return this.buttonEl.textContent ?? ''
  }
  set title(v: string) {
    this.buttonEl.textContent = v
  }

  protected override searchText(): string {
    return `${this.title} ${this.labelText}`
  }

  on(name: 'click', fn: (ev: { target: ButtonApi }) => void): () => void {
    return this.buttonEmitter.on(name, fn)
  }

  override dispose(): void {
    this.buttonEmitter.clear()
    super.dispose()
  }
}

/** A row of equally-styled action buttons, each with its own callback. */
export class ButtonGroupApi extends Item {
  readonly element: HTMLElement
  private titles: string[]

  constructor(params: { label?: string; buttons: Record<string, () => void> }) {
    super()
    this.titles = Object.keys(params.buttons)
    const group = h('div', 'tiao-btngroup')
    for (const [title, onClick] of Object.entries(params.buttons)) {
      const btn = h('button', 'tiao-button', title)
      btn.type = 'button'
      const handler = () => {
        if (!this.disabled) onClick()
      }
      btn.addEventListener('click', handler)
      this.disposers.push(() => btn.removeEventListener('click', handler))
      group.append(btn)
    }
    this.element = params.label
      ? h('div', 'tiao-row', h('div', 'tiao-label', params.label), h('div', 'tiao-control', group))
      : h('div', 'tiao-row tiao-row-full', group)
  }

  protected override searchText(): string {
    const label = this.element.querySelector('.tiao-label')?.textContent ?? ''
    return `${label} ${this.titles.join(' ')}`
  }
}

export class SeparatorApi extends Item {
  readonly element: HTMLElement

  constructor() {
    super()
    this.element = h('div', 'tiao-separator')
  }
}

/** Generic blade row backed by a blade plugin (e.g. FPS graph). */
export class BladeApi extends Item {
  readonly element: HTMLElement

  constructor(host: BladeHost, params: Record<string, unknown>) {
    super()
    const plugin = host.registry.findBlade(params)
    if (!plugin) {
      throw new Error(`tiao: no blade plugin accepts view "${String(params['view'])}"`)
    }
    const view = plugin.create({
      document: host.document,
      params,
      onDispose: (fn) => this.disposers.push(fn),
    })
    this.element = h('div', `tiao-row${view.full ? ' tiao-row-full' : ''}`, view.element)
  }
}

export class FolderApi extends Container {
  readonly element: HTMLElement
  readonly rack: HTMLElement
  private _expanded: boolean
  private headerEl: HTMLButtonElement

  private collapsible: boolean

  constructor(
    host: BladeHost,
    params: { title: string; expanded?: boolean; collapsible?: boolean; color?: string },
  ) {
    super(host)
    this.collapsible = params.collapsible ?? true
    this._expanded = this.collapsible ? params.expanded ?? true : true
    this.rack = h('div', 'tiao-rack')
    this.headerEl = h(
      'button',
      'tiao-folder-header',
      icon('triangle'),
      h('span', 'tiao-folder-heading', h('span', 'tiao-folder-title', params.title)),
    )
    this.headerEl.type = 'button'
    // the depth line doubles as a collapse control (keyboard users have the header)
    const lineEl = h('button', 'tiao-folder-line')
    lineEl.type = 'button'
    lineEl.tabIndex = -1
    lineEl.setAttribute('aria-hidden', 'true')
    const body = h('div', 'tiao-folder-body', h('div', 'tiao-folder-clip', this.rack), lineEl)
    this.element = h('div', 'tiao-folder', this.headerEl, body)
    if (params.color) {
      this.element.classList.add('tiao-folder-colored')
      this.element.style.setProperty('--tiao-folder-color', params.color)
    }
    this.applyExpanded()

    if (this.collapsible) {
      const onClick = () => {
        this.expanded = !this.expanded
      }
      this.headerEl.addEventListener('click', onClick)
      lineEl.addEventListener('click', onClick)
      this.disposers.push(() => {
        this.headerEl.removeEventListener('click', onClick)
        lineEl.removeEventListener('click', onClick)
      })
    } else {
      this.element.classList.add('tiao-folder-static')
      this.headerEl.tabIndex = -1
    }
  }

  get title(): string {
    return this.headerEl.querySelector('.tiao-folder-title')?.textContent ?? ''
  }
  set title(v: string) {
    const el = this.headerEl.querySelector('.tiao-folder-title')
    if (el) el.textContent = v
  }

  /** internal: show/clear the section number before the title (pane "Numbers" setting) */
  setSectionIndex(index: string | null): void {
    const heading = this.headerEl.querySelector('.tiao-folder-heading')
    let el = heading?.querySelector('.tiao-folder-index')
    if (index === null) {
      el?.remove()
      return
    }
    if (!el) {
      el = h('span', 'tiao-folder-index')
      heading?.querySelector('.tiao-folder-title')?.before(el)
    }
    el.textContent = index
  }

  get expanded(): boolean {
    return this._expanded
  }
  set expanded(v: boolean) {
    if (!this.collapsible || this._expanded === v) return
    this._expanded = v
    this.applyExpanded()
  }

  protected override searchText(): string {
    return this.title
  }

  /** internal: exposes the folder nesting depth to CSS so control columns
      stay aligned across indent levels (see .tiao-label) */
  updateDepth(): void {
    let depth = 1
    for (let p = this.parent; p; p = p.parent) {
      if (p instanceof FolderApi) depth++
    }
    this.rack.style.setProperty('--tiao-depth', String(depth))
    for (const child of this.children) {
      if (child instanceof FolderApi) child.updateDepth()
    }
  }

  private applyExpanded(): void {
    this.element.classList.toggle('tiao-expanded', this._expanded)
    this.headerEl.setAttribute('aria-expanded', String(this._expanded))
  }
}

export class TabPageApi extends Container {
  readonly element: HTMLElement
  readonly rack: HTMLElement

  constructor(host: BladeHost, readonly title: string) {
    super(host)
    this.rack = h('div', 'tiao-rack')
    this.element = h('div', 'tiao-tab-page', this.rack)
  }

  protected override searchText(): string {
    return this.title
  }
}

export class TabApi extends Item {
  readonly element: HTMLElement
  readonly pages: TabPageApi[]
  private buttons: HTMLButtonElement[] = []
  private _selectedIndex = 0

  constructor(host: BladeHost, params: { pages: { title: string }[] }) {
    super()
    const nav = h('div', 'tiao-tab-nav')
    nav.setAttribute('role', 'tablist')
    this.pages = params.pages.map((p, i) => {
      const page = new TabPageApi(host, p.title)
      page.parent = null
      const btn = h('button', 'tiao-tab-button', p.title)
      btn.type = 'button'
      btn.setAttribute('role', 'tab')
      const onClick = () => {
        this.selectedIndex = i
      }
      btn.addEventListener('click', onClick)
      this.disposers.push(() => btn.removeEventListener('click', onClick))
      this.buttons.push(btn)
      nav.append(btn)
      return page
    })
    this.element = h('div', 'tiao-tab', nav, ...this.pages.map((p) => p.element))
    this.applySelection()
  }

  /** tab pages bubble through the tab's parent container */
  override set parent(c: Container | null) {
    super.parent = c
    for (const p of this.pages) p.parent = c
  }
  override get parent(): Container | null {
    return super.parent
  }

  get selectedIndex(): number {
    return this._selectedIndex
  }
  set selectedIndex(i: number) {
    this._selectedIndex = i
    this.applySelection()
  }

  refresh(): void {
    for (const p of this.pages) p.refresh()
  }

  /** the tab strip stays visible while any page holds a match */
  override applySearch(query: string): boolean {
    let match = false
    for (const p of this.pages) if (p.applySearch(query)) match = true
    this.element.classList.toggle('tiao-search-miss', !match)
    return match
  }

  private applySelection(): void {
    this.pages.forEach((p, i) => {
      p.element.classList.toggle('tiao-selected', i === this._selectedIndex)
    })
    this.buttons.forEach((b, i) => {
      b.classList.toggle('tiao-selected', i === this._selectedIndex)
      b.setAttribute('aria-selected', String(i === this._selectedIndex))
    })
  }

  override dispose(): void {
    for (const p of this.pages) p.dispose()
    super.dispose()
  }
}
