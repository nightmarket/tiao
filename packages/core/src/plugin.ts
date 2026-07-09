import type { Value } from './value'

/** Options bag accepted by addBinding. Known keys are typed; plugins may read extras. */
export interface BindingOptions {
  label?: string
  /** force a specific view/plugin id, e.g. 'graph', 'radiogrid' */
  view?: string
  min?: number
  max?: number
  step?: number
  options?: Record<string, unknown> | readonly { text: string; value: unknown }[]
  readonly?: boolean
  /** monitor poll interval in ms (default 66) */
  interval?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- callable with the plugin's value type
  format?: (value: any) => string
  [key: string]: unknown
}

export interface PluginContext<T> {
  document: Document
  value: Value<T>
  options: BindingOptions
  /** row label (plugins with full-row layouts render it themselves) */
  label: string
  /** register cleanup to run when the binding is disposed */
  onDispose(fn: () => void): void
}

export interface PluginView {
  element: HTMLElement
  /** when true the view owns the entire row (renders its own label) */
  full?: boolean
  /** invoked when the row (label area) is clicked, e.g. focus the input */
  activate?: () => void
  /** long-press on the row label starts a scrub/drag gesture when provided */
  beginScrub?: (ev: PointerEvent) => void
}

export interface InputPlugin<T = unknown> {
  id: string
  type: 'input'
  /** return true to claim this (value, options) pair */
  accept(value: unknown, options: BindingOptions): boolean
  create(ctx: PluginContext<T>): PluginView
}

export interface MonitorPlugin<T = unknown> {
  id: string
  type: 'monitor'
  accept(value: unknown, options: BindingOptions): boolean
  create(ctx: PluginContext<T>): PluginView
}

export interface BladePluginContext {
  document: Document
  params: Record<string, unknown>
  onDispose(fn: () => void): void
}

/** Standalone rows not bound to an object property (e.g. FPS graph). */
export interface BladePlugin {
  id: string
  type: 'blade'
  accept(params: Record<string, unknown>): boolean
  create(ctx: BladePluginContext): PluginView
}

/* eslint-disable @typescript-eslint/no-explicit-any -- registry stores type-erased plugins */
export type TiaoPlugin = InputPlugin<any> | MonitorPlugin<any> | BladePlugin

export class PluginRegistry {
  private plugins: TiaoPlugin[] = []

  constructor(private parent?: PluginRegistry) {}

  register(plugin: TiaoPlugin): void {
    // registered later wins, so user plugins override builtins
    this.plugins.unshift(plugin)
  }

  findInput(value: unknown, options: BindingOptions): InputPlugin<unknown> | undefined {
    return this.find('input', options.view, (p) =>
      (p as InputPlugin<unknown>).accept(value, options),
    ) as InputPlugin<unknown> | undefined
  }

  findMonitor(value: unknown, options: BindingOptions): MonitorPlugin<unknown> | undefined {
    return this.find('monitor', options.view, (p) =>
      (p as MonitorPlugin<unknown>).accept(value, options),
    ) as MonitorPlugin<unknown> | undefined
  }

  findBlade(params: Record<string, unknown>): BladePlugin | undefined {
    const view = typeof params['view'] === 'string' ? params['view'] : undefined
    return this.find('blade', view, (p) => (p as BladePlugin).accept(params)) as
      | BladePlugin
      | undefined
  }

  private find(
    type: TiaoPlugin['type'],
    view: string | undefined,
    accepts: (p: TiaoPlugin) => boolean,
  ): TiaoPlugin | undefined {
    for (const p of this.plugins) {
      if (p.type !== type) continue
      if (view !== undefined && p.id !== view) continue
      if (accepts(p)) return p
    }
    return this.parent?.find(type, view, accepts)
  }
}

/** Global registry shared by all panes; per-pane registries chain to it. */
export const globalRegistry = new PluginRegistry()

export function registerPlugin(plugin: TiaoPlugin): void {
  globalRegistry.register(plugin)
}
