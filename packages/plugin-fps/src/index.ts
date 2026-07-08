import {
  createGraph,
  h,
  onTick,
  registerPlugin,
  Value,
  type BladePlugin,
  type Container,
} from '@tiao/core'

const DEFAULT_SAMPLE_MS = 250

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

    let frames = 0
    let windowStart = typeof performance !== 'undefined' ? performance.now() : 0
    ctx.onDispose(
      onTick((t) => {
        frames++
        const elapsed = t - windowStart
        if (elapsed < sampleMs) return
        value.set((frames * 1000) / elapsed)
        frames = 0
        windowStart = t
      }),
    )

    const graph = createGraph({
      document: ctx.document,
      value,
      options: {
        min: 0,
        max,
        unit: 'FPS',
        format: (v: number) => String(Math.round(v)),
        ...(bufferSize !== undefined && { bufferSize }),
      },
      label: 'fps',
      onDispose: ctx.onDispose,
    })
    // labeled: standard two-column row; label-less: full-width graph
    const label = typeof ctx.params['label'] === 'string' ? ctx.params['label'] : null
    const element = label
      ? h('div', 'tiao-fps', h('div', 'tiao-label', label), h('div', 'tiao-control', graph))
      : graph
    return { element, full: true }
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
