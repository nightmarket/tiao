import {
  createGraph,
  onFpsSample,
  registerPlugin,
  Value,
  type BladePlugin,
  type Container,
} from '@tiao/core'

const DEFAULT_SAMPLE_MS = 250
const SAMPLE_META = { source: 'monitor', sample: true } as const

/**
 * FPS graph blade. Usage:
 *   registerFpsPlugin()
 *   pane.addBlade({ view: 'fps' })
 * or the convenience wrapper: addFpsGraph(pane)
 */
export const fpsPlugin: BladePlugin = {
  id: 'fps',
  type: 'blade',
  accept(params) {
    return params['view'] === 'fps'
  },
  create(ctx) {
    const sampleMs = typeof ctx.params['interval'] === 'number' ? ctx.params['interval'] : DEFAULT_SAMPLE_MS
    const max = typeof ctx.params['max'] === 'number' ? ctx.params['max'] : 120
    const bufferSize = typeof ctx.params['bufferSize'] === 'number' ? ctx.params['bufferSize'] : undefined
    const value = new Value(0)
    ctx.onDispose(onFpsSample(sampleMs, (fps) => value.set(fps, SAMPLE_META)))

    const label = typeof ctx.params['label'] === 'string' ? ctx.params['label'] : undefined
    const graph = createGraph({
      value,
      options: {
        min: 0,
        max,
        unit: 'FPS',
        format: (v: number) => String(Math.round(v)),
        ...(label !== undefined && { label }),
        ...(bufferSize !== undefined && { bufferSize }),
      },
      onDispose: ctx.onDispose,
    })
    return { element: graph, full: true }
  },
}

let registered = false

export function registerFpsPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(fpsPlugin)
}

export function addFpsGraph(
  container: Container,
  params: { label?: string; interval?: number; max?: number; bufferSize?: number } = {},
) {
  registerFpsPlugin()
  return container.addBlade({ view: 'fps', ...params })
}
