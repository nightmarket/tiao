import { DEFAULT_PANE_ID, keyFor } from './controls'
import { ControlStore } from './store'
import {
  isButton,
  isButtonGroup,
  isInputDef,
  isMonitor,
  isTabs,
  itemValue,
  type Schema,
  type ShowIf,
  type ShowIfGet,
  type UseControlsOptions,
} from './types'
import type { BindingApi, Container, FolderApi, Pane, PaneOptions } from '../core'

type CoreModule = typeof import('../core')

let corePromise: Promise<CoreModule> | null = null

function loadCore(): Promise<CoreModule> {
  // dynamic so bundlers code-split the whole UI out of prod bundles
  corePromise ??= import('../core')
  return corePromise
}

interface FolderRef {
  api: FolderApi
  count: number
}

interface Registration {
  folderPath: string[]
  schema: Schema
  showIf?: ShowIf | undefined
  active: boolean
  /** true once ensureFolder ran, so unregister only releases what it acquired */
  materialized: boolean
  disposers: (() => void)[]
  bindings: Map<string, { binding: BindingApi<unknown>; target: Record<string, unknown>; name: string }>
}

/**
 * Everything a manager exposes outside this module. `getManager` is typed to
 * this rather than to `PaneManager` so the production entry's inert stand-in
 * (src/react/production.ts) can satisfy the same contract — a member added
 * here without a production counterpart is a compile error, not a crash that
 * only shows up in a shipped build.
 */
export interface ManagerApi {
  readonly id: string
  readonly store: ControlStore
  configure(options: PaneOptions): void
  onPane(fn: (pane: Pane) => void): () => void
  getPane(): Pane | null
  setValue(key: string, value: unknown): void
  /** mount a schema into the pane; the returned disposer releases it */
  register(folderPath: string[], schema: Schema, options?: UseControlsOptions): () => void
}

const managers = new Map<string, PaneManager>()

export function getManager(id: string): ManagerApi {
  let m = managers.get(id)
  if (!m) {
    m = new PaneManager(id)
    managers.set(id, m)
  }
  return m
}

export class PaneManager implements ManagerApi {
  readonly store = new ControlStore()
  private pane: Pane | null = null
  private paneOptions: PaneOptions = {}
  private folders = new Map<string, FolderRef>()
  private registrations = new Set<Registration>()
  private paneListeners = new Set<(pane: Pane) => void>()

  constructor(readonly id: string) {}

  configure(options: PaneOptions): void {
    this.paneOptions = { ...this.paneOptions, ...options }
    if (this.pane) {
      if (options.title !== undefined) this.pane.title = options.title
      if (options.theme) this.pane.applyTheme(options.theme)
    }
  }

  /** invoked once the pane exists (or immediately if it already does) */
  onPane(fn: (pane: Pane) => void): () => void {
    if (this.pane) fn(this.pane)
    this.paneListeners.add(fn)
    return () => this.paneListeners.delete(fn)
  }

  getPane(): Pane | null {
    return this.pane
  }

  register(folderPath: string[], schema: Schema, options?: UseControlsOptions): () => void {
    const reg: Registration = {
      folderPath,
      schema,
      showIf: options?.showIf,
      active: true,
      materialized: false,
      disposers: [],
      bindings: new Map(),
    }
    this.registrations.add(reg)
    void loadCore().then((core) => {
      if (reg.active) this.materialize(reg, core)
    })
    return () => this.unregister(reg)
  }

  private unregister(reg: Registration): void {
    reg.active = false
    this.registrations.delete(reg)
    for (const fn of reg.disposers) fn()
    reg.disposers = []
    reg.bindings.clear()
    if (reg.materialized) this.releaseFolders(reg.folderPath)
    if (this.registrations.size === 0 && this.pane) {
      this.pane.dispose()
      this.pane = null
      this.folders.clear()
    }
  }

  /** programmatic update: store + live binding (if mounted) */
  setValue(key: string, value: unknown): void {
    this.store.set(key, value)
    for (const reg of this.registrations) {
      const entry = reg.bindings.get(key)
      if (entry) {
        entry.target[entry.name] = value
        entry.binding.refresh()
      }
    }
  }

  private ensurePane(core: CoreModule): Pane {
    if (!this.pane) {
      const title = this.id === DEFAULT_PANE_ID ? 'Debug' : this.id
      const options: PaneOptions = { title, ...this.paneOptions, id: this.id }
      this.pane = new core.Pane(options)
      for (const fn of this.paneListeners) fn(this.pane)
    }
    return this.pane
  }

  private ensureFolder(core: CoreModule, path: string[]): Container {
    let parent: Container = this.ensurePane(core)
    for (let i = 0; i < path.length; i++) {
      const joined = path.slice(0, i + 1).join('.')
      let ref = this.folders.get(joined)
      if (!ref) {
        ref = { api: parent.addFolder({ title: path[i] as string }), count: 0 }
        this.folders.set(joined, ref)
      }
      ref.count++
      parent = ref.api
    }
    return parent
  }

  private releaseFolders(path: string[]): void {
    for (let i = path.length; i > 0; i--) {
      const joined = path.slice(0, i).join('.')
      const ref = this.folders.get(joined)
      if (!ref) continue
      ref.count--
      if (ref.count <= 0) {
        ref.api.dispose()
        this.folders.delete(joined)
      }
    }
  }

  private readValue(folderPath: string[], name: string): unknown {
    const key = name.includes('.') ? name : keyFor(folderPath, name)
    if (this.store.has(key)) return this.store.get(key)
    for (const reg of this.registrations) {
      const entry = reg.bindings.get(key)
      if (entry) return entry.target[entry.name]
    }
    return undefined
  }

  private materialize(reg: Registration, core: CoreModule): void {
    const container = this.ensureFolder(core, reg.folderPath)
    reg.materialized = true
    const get: ShowIfGet = (name) => this.readValue(reg.folderPath, name)
    if (reg.showIf && reg.folderPath.length > 0) {
      const leaf = this.folders.get(reg.folderPath.join('.'))?.api
      leaf?.setShowIf(() => reg.showIf!(get))
    }
    this.mountSchema(reg, container, reg.schema, get)
  }

  private mountSchema(
    reg: Registration,
    container: Container,
    schema: Schema,
    get: ShowIfGet,
  ): void {
    for (const [name, item] of Object.entries(schema)) {
      const key = keyFor(reg.folderPath, name)

      if (isTabs(item)) {
        const titles = Object.keys(item.pages)
        const tab = container.addTab({ pages: titles.map((title) => ({ title })) })
        titles.forEach((title, i) => {
          const page = tab.pages[i]
          const pageSchema = item.pages[title]
          if (page && pageSchema) this.mountSchema(reg, page, pageSchema, get)
        })
        reg.disposers.push(() => tab.dispose())
        continue
      }

      if (isButton(item)) {
        const btn = container.addButton({
          title: item.title || name,
          hidden: item.hidden,
          disabled: item.disabled,
          showIf: item.showIf ? () => item.showIf!(get) : undefined,
        })
        btn.on('click', item.onClick)
        reg.disposers.push(() => btn.dispose())
        continue
      }

      if (isButtonGroup(item)) {
        const group = container.addButtonGroup({
          label: item.label ?? name,
          buttons: item.buttons,
          hidden: item.hidden,
          disabled: item.disabled,
          showIf: item.showIf ? () => item.showIf!(get) : undefined,
        })
        reg.disposers.push(() => group.dispose())
        continue
      }

      if (isMonitor(item)) {
        const target: Record<string, unknown> = {}
        Object.defineProperty(target, name, { get: item.get })
        const binding = container.addBinding(target, name, {
          ...item.options,
          hidden: item.hidden,
          disabled: item.disabled,
          showIf: item.showIf ? () => item.showIf!(get) : undefined,
        })
        reg.disposers.push(() => binding.dispose())
        continue
      }

      const initial = this.store.has(key) ? this.store.get(key) : itemValue(item)
      const options = inputBindingOptions(item, name, get)
      const target: Record<string, unknown> = { [name]: initial }
      const binding = container.addBinding(target, name, options)
      binding.on('change', (ev) => this.store.set(key, ev.value))
      // addBinding may restore a persisted value into the target, and that
      // restore predates the change listener above — adopt it. When nothing
      // was restored, skip the write: the hook already falls back to the same
      // default, and seeding it would re-render every subscriber for nothing.
      if (!Object.is(target[name], initial)) this.store.set(key, target[name])
      reg.bindings.set(key, { binding, target, name })
      reg.disposers.push(() => binding.dispose())
    }
  }
}

function inputBindingOptions(item: Schema[string], name: string, get: ShowIfGet) {
  if (!isInputDef(item)) return { label: name }
  const { value: _value, showIf, ...rest } = item
  return {
    ...rest,
    label: item.label ?? name,
    showIf: showIf ? () => showIf(get) : undefined,
  }
}

export { loadCore }
