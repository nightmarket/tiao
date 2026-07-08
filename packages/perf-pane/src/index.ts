import { Pane, type Anchor, type Container, type PaneOptions } from '@tiao/core'
import { createPerfMonitor, type PerfMonitor, type PerfMonitorOptions } from './monitor'

export interface PerfMonitorUiOptions {
  /** fps graph ceiling (default 120) */
  maxFps?: number
}

export interface PerfPaneOptions extends PerfMonitorOptions, PerfMonitorUiOptions {
  id?: string
  title?: string
  anchor?: Anchor
  /** extra pane options merged in */
  pane?: Partial<PaneOptions>
}

export interface PerfPaneApi {
  pane: Pane
  perf: PerfMonitor
  dispose(): void
}

/**
 * Pre-configured pane (top-right by default) that monitors a canvas app:
 * fps / cpu ms / gpu ms graphs, three.js draw-call and geometry counts, and
 * heap graphs for leak hunting. Pass a three.js renderer and everything
 * available lights up; rows without a data source are skipped.
 */
export function createPerfPane(options: PerfPaneOptions = {}): PerfPaneApi {
  const perf = createPerfMonitor(options)
  const pane = new Pane({
    id: options.id ?? 'tiao-perf',
    title: options.title ?? 'Performance',
    anchor: options.anchor ?? 'top-right',
    ...options.pane,
  })
  addPerfMonitors(pane, perf, options)
  return {
    pane,
    perf,
    dispose() {
      pane.dispose()
      perf.dispose()
    },
  }
}

const round = (v: number) => String(Math.round(v))
const ms = (v: number) => v.toFixed(2)
const int = (v: number) => Math.round(v).toLocaleString('en-US')
const mb = (v: number) => v.toFixed(1)

/**
 * Adds the perf rows to an existing pane/folder — use this instead of
 * createPerfPane to fold the monitors into a pane you already have.
 */
export function addPerfMonitors(
  container: Container,
  perf: PerfMonitor,
  options: PerfMonitorUiOptions = {},
): void {
  const { stats, capabilities, interval } = perf
  const graph = { readonly: true, view: 'graph', interval, min: 0 } as const

  container.addBinding(stats, 'fps', { ...graph, label: 'FPS', max: options.maxFps ?? 120, unit: 'FPS', format: round })
  container.addBinding(stats, 'cpu', { ...graph, label: 'CPU', unit: 'ms', format: ms })
  if (capabilities.gpu) {
    container.addBinding(stats, 'gpu', { ...graph, label: 'GPU', unit: 'ms', format: ms })
  }

  if (capabilities.counts) {
    const render = container.addFolder({ title: 'Render' })
    render.addBinding(stats, 'calls', { readonly: true, format: int })
    render.addBinding(stats, 'triangles', { readonly: true, format: int })
    render.addBinding(stats, 'lines', { readonly: true, format: int })
    render.addBinding(stats, 'points', { readonly: true, format: int })
  }

  if (capabilities.counts || capabilities.shaders || capabilities.jsHeap || capabilities.gpuMemory) {
    const memory = container.addFolder({ title: 'Memory' })
    if (capabilities.counts) {
      memory.addBinding(stats, 'geometries', { readonly: true, format: int })
      memory.addBinding(stats, 'textures', { readonly: true, format: int })
    }
    if (capabilities.shaders) {
      memory.addBinding(stats, 'shaders', { readonly: true, format: int })
    }
    if (capabilities.jsHeap) {
      memory.addBinding(stats, 'jsHeap', { ...graph, label: 'JS heap', unit: 'MB', format: mb })
    }
    if (capabilities.gpuMemory) {
      memory.addBinding(stats, 'gpuMemory', { ...graph, label: 'GPU mem', unit: 'MB', format: mb })
    }
  }
}

export { createPerfMonitor } from './monitor'
export type {
  PerfCapabilities,
  PerfMonitor,
  PerfMonitorOptions,
  PerfStats,
  RendererInfoLike,
  RendererLike,
} from './monitor'
