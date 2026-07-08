import { h } from '../dom'
import { formatNumber } from '../util'
import type { MonitorPlugin, PluginContext } from '../plugin'

/** Readonly text display for any value. */
export const textMonitorPlugin: MonitorPlugin<unknown> = {
  id: 'text',
  type: 'monitor',
  accept() {
    return true
  },
  create(ctx) {
    const format = (ctx.options.format as ((v: unknown) => string) | undefined) ?? defaultFormat
    const el = h('div', 'tiao-monitor-text', format(ctx.value.get()))
    ctx.onDispose(
      ctx.value.subscribe((v) => {
        const text = format(v)
        if (el.textContent !== text) el.textContent = text
      }),
    )
    return { element: el }
  },
}

function defaultFormat(v: unknown): string {
  if (typeof v === 'number') return formatNumber(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v) ?? String(v)
}

const DEFAULT_BUFFER = 128

/** Rolling line graph for numeric values. */
export const graphMonitorPlugin: MonitorPlugin<number> = {
  id: 'graph',
  type: 'monitor',
  accept(value, options) {
    return typeof value === 'number' && options.view === 'graph'
  },
  create(ctx) {
    return { element: createGraph(ctx), full: false }
  },
}

export function createGraph(ctx: PluginContext<number>): HTMLElement {
  const bufferSize = (ctx.options['bufferSize'] as number | undefined) ?? DEFAULT_BUFFER
  const buffer: number[] = []
  const canvas = h('canvas', 'tiao-graph-canvas')
  const valueEl = h('span', 'tiao-graph-value')
  const el = h('div', 'tiao-graph', canvas, valueEl)

  const explicitMin = ctx.options.min
  const explicitMax = ctx.options.max
  const format = (ctx.options.format as ((v: number) => string) | undefined) ?? ((v) => formatNumber(v))

  let width = 0
  let height = 0
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    width = Math.round(rect.width * dpr)
    height = Math.round(rect.height * dpr)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  ro?.observe(canvas)
  ctx.onDispose(() => ro?.disconnect())

  const draw = () => {
    const c = canvas.getContext('2d')
    if (!c || width === 0 || buffer.length < 2) return
    let min = typeof explicitMin === 'number' ? explicitMin : Infinity
    let max = typeof explicitMax === 'number' ? explicitMax : -Infinity
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      for (const v of buffer) {
        if (typeof explicitMin !== 'number' && v < min) min = v
        if (typeof explicitMax !== 'number' && v > max) max = v
      }
    }
    if (min === max) {
      min -= 1
      max += 1
    }
    c.clearRect(0, 0, width, height)
    const style = getComputedStyle(el)
    c.strokeStyle = style.getPropertyValue('--tiao-graph-stroke').trim() || style.color
    c.lineWidth = 1.5 * dpr
    c.lineJoin = 'round'
    c.beginPath()
    const pad = 2 * dpr
    buffer.forEach((v, i) => {
      const x = (i / (bufferSize - 1)) * width
      const y = pad + (1 - (v - min) / (max - min)) * (height - pad * 2)
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    })
    c.stroke()
  }

  ctx.onDispose(
    ctx.value.subscribe((v) => {
      buffer.push(v)
      if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize)
      valueEl.textContent = format(v)
      draw()
    }),
  )

  return el
}
