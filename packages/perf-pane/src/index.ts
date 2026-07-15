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
 * fps / cpu / gpu / heap graphs, plus flat three.js counters.
 * Pass a three.js renderer and everything available lights up; rows without a
 * data source are skipped.
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
  const fpsOpts = { ...graph, label: 'FPS', max: options.maxFps ?? 144, unit: 'FPS', format: round }
  const cpuOpts = { ...graph, label: 'CPU', unit: 'ms', format: ms }
  const gpuOpts = { ...graph, label: 'GPU', unit: 'ms', format: ms }
  const heapOpts = { ...graph, label: 'JS heap', unit: 'MB', format: mb }

  container.addBinding(stats, 'fps', fpsOpts)
  container.addBinding(stats, 'cpu', cpuOpts)
  if (capabilities.gpu) container.addBinding(stats, 'gpu', gpuOpts)
  if (capabilities.jsHeap) container.addBinding(stats, 'jsHeap', heapOpts)
  if (capabilities.gpuMemory) {
    container.addBinding(stats, 'gpuMemory', {
      ...graph,
      label: 'GPU mem',
      unit: 'MB',
      format: mb,
    })
  }

  if (capabilities.counts) {
    container.addBinding(stats, 'calls', { readonly: true, format: int })
    container.addBinding(stats, 'frameCalls', {
      readonly: true,
      format: int,
      label: 'Render calls',
    })
    container.addBinding(stats, 'triangles', { readonly: true, format: int })
    container.addBinding(stats, 'lines', { readonly: true, format: int })
    container.addBinding(stats, 'points', { readonly: true, format: int })
    container.addBinding(stats, 'geometries', { readonly: true, format: int })
    container.addBinding(stats, 'textures', { readonly: true, format: int })
  }
  if (capabilities.shaders) {
    container.addBinding(stats, 'shaders', { readonly: true, format: int })
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
