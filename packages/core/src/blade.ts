import { Emitter } from './emitter'
import { h, icon } from './dom'
import { onInterval } from './ticker'
import { Value } from './value'
import type { BindingOptions, PluginRegistry } from './plugin'

/** Provided by the root Pane to every descendant. */
export interface BladeHost {
  document: Document
  registry: PluginRegistry
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
    const api = new BindingApi<O[K]>(this.host, target as Record<string, O[K]>, key, options)
    this.attach(api)
    return api
  }

  addFolder(params: { title: string; expanded?: boolean; collapsible?: boolean }): FolderApi {
    const api = new FolderApi(this.host, params)
    this.attach(api)
    return api
  }

  addButton(params: { title: string; label?: string }): ButtonApi {
    const api = new ButtonApi(this.host, params)
    this.attach(api)
    return api
  }

  addTab(params: { pages: { title: string }[] }): TabApi {
    const api = new TabApi(this.host, params)
    this.attach(api)
    return api
  }

  addSeparator(): SeparatorApi {
    const api = new SeparatorApi(this.host)
    this.attach(api)
    return api
  }

  addBlade(params: Record<string, unknown>): BladeApi {
    const api = new BladeApi(this.host, params)
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
  }

  /** internal: remove bookkeeping only (called from Item.dispose) */
  detach(item: Item): void {
    const i = this.children.indexOf(item)
    if (i >= 0) this.children.splice(i, 1)
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

    // clicking the label area activates the control (focus input, open picker, ...)
    if (view.activate && !view.full) {
      this.element.classList.add('tiao-row-activate')
      const onRowClick = (e: MouseEvent) => {
        if ((e.target as Element | null)?.closest?.('.tiao-control')) return
        view.activate?.()
      }
      this.element.addEventListener('click', onRowClick)
      this.disposers.push(() => this.element.removeEventListener('click', onRowClick))
    }

    if (options.readonly) {
      this.element.classList.add('tiao-row-monitor')
      const interval = options.interval ?? DEFAULT_MONITOR_INTERVAL
      this.disposers.push(
        onInterval(() => {
          this.value.set(this.target[this.key] as T, { source: 'monitor' })
        }, interval),
      )
    } else {
      this.disposers.push(
        this.value.subscribe((v, meta) => {
          if (meta.source !== 'refresh') this.target[this.key] = v
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
  }

  get label(): string {
    return this.labelEl?.textContent ?? this.key
  }
  set label(v: string) {
    if (this.labelEl) this.labelEl.textContent = v
  }

  on(name: 'change', fn: (ev: TiaoChangeEvent<T>) => void): () => void {
    return this.bindingEmitter.on(name, fn)
  }

  /** re-read the current value from the bound object */
  refresh(): void {
    this.value.set(this.target[this.key] as T, { source: 'refresh' })
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

  constructor(host: BladeHost, params: { title: string; label?: string }) {
    super()
    void host
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

  on(name: 'click', fn: (ev: { target: ButtonApi }) => void): () => void {
    return this.buttonEmitter.on(name, fn)
  }

  override dispose(): void {
    this.buttonEmitter.clear()
    super.dispose()
  }
}

export class SeparatorApi extends Item {
  readonly element: HTMLElement

  constructor(host: BladeHost) {
    super()
    void host
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

  constructor(host: BladeHost, params: { title: string; expanded?: boolean; collapsible?: boolean }) {
    super(host)
    this.collapsible = params.collapsible ?? true
    this._expanded = this.collapsible ? params.expanded ?? true : true
    this.rack = h('div', 'tiao-rack')
    this.headerEl = h(
      'button',
      'tiao-folder-header',
      h('span', 'tiao-folder-index'),
      h('span', 'tiao-folder-title', params.title),
      icon('chevron'),
    )
    this.headerEl.type = 'button'
    const body = h('div', 'tiao-folder-body', h('div', 'tiao-folder-clip', this.rack))
    this.element = h('div', 'tiao-folder', this.headerEl, body)
    this.applyExpanded()

    if (this.collapsible) {
      const onClick = () => {
        this.expanded = !this.expanded
      }
      this.headerEl.addEventListener('click', onClick)
      this.disposers.push(() => this.headerEl.removeEventListener('click', onClick))
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

  get expanded(): boolean {
    return this._expanded
  }
  set expanded(v: boolean) {
    if (!this.collapsible || this._expanded === v) return
    this._expanded = v
    this.applyExpanded()
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
