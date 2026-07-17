import { ControlStore } from './store'
import { isButton, isButtonGroup, isInputDef, isMonitor, itemValue, type Schema } from './types'
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

export interface Registration {
  folderPath: string[]
  schema: Schema
  active: boolean
  /** true once ensureFolder ran, so unregister only releases what it acquired */
  materialized: boolean
  disposers: (() => void)[]
  bindings: Map<string, { binding: BindingApi<unknown>; target: Record<string, unknown>; name: string }>
}

export const DEFAULT_PANE_ID = 'tiao-default'

const managers = new Map<string, PaneManager>()

export function getManager(id: string): PaneManager {
  let m = managers.get(id)
  if (!m) {
    m = new PaneManager(id)
    managers.set(id, m)
  }
  return m
}

export function keyFor(folderPath: string[], name: string): string {
  return [...folderPath, name].join('.')
}

export class PaneManager {
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

  register(folderPath: string[], schema: Schema): Registration {
    const reg: Registration = {
      folderPath,
      schema,
      active: true,
      materialized: false,
      disposers: [],
      bindings: new Map(),
    }
    this.registrations.add(reg)
    void loadCore().then((core) => {
      if (reg.active) this.materialize(reg, core)
    })
    return reg
  }

  unregister(reg: Registration): void {
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

  private materialize(reg: Registration, core: CoreModule): void {
    const container = this.ensureFolder(core, reg.folderPath)
    reg.materialized = true

    for (const [name, item] of Object.entries(reg.schema)) {
      const key = keyFor(reg.folderPath, name)

      if (isButton(item)) {
        const btn = container.addButton({ title: item.title || name })
        btn.on('click', item.onClick)
        reg.disposers.push(() => btn.dispose())
        continue
      }

      if (isButtonGroup(item)) {
        const group = container.addButtonGroup({
          label: item.label ?? name,
          buttons: item.buttons,
        })
        reg.disposers.push(() => group.dispose())
        continue
      }

      if (isMonitor(item)) {
        const target: Record<string, unknown> = {}
        Object.defineProperty(target, name, { get: item.get })
        const binding = container.addBinding(target, name, item.options)
        reg.disposers.push(() => binding.dispose())
        continue
      }

      const initial = this.store.has(key) ? this.store.get(key) : itemValue(item)
      const options = isInputDef(item) ? { ...item, label: item.label ?? name } : { label: name }
      const target: Record<string, unknown> = { [name]: initial }
      const binding = container.addBinding(target, name, options)
      binding.on('change', (ev) => this.store.set(key, ev.value))
      // seed the store so first render after hydration matches the pane
      this.store.set(key, initial)
      reg.bindings.set(key, { binding, target, name })
      reg.disposers.push(() => binding.dispose())
    }
  }
}

export { loadCore }
