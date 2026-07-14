import { h } from '../dom'
import { formatNumber } from '../util'
import type { MonitorPlugin, PluginContext } from '../plugin'

/** Readonly text display for any value; bufferSize > 1 turns it into a log. */
export const textMonitorPlugin: MonitorPlugin<unknown> = {
  id: 'text',
  type: 'monitor',
  accept() {
    return true
  },
  create(ctx) {
    const format = ctx.options.format ?? defaultFormat
    const bufferSize = typeof ctx.options['bufferSize'] === 'number' ? ctx.options['bufferSize'] : 1
    if (bufferSize > 1) return { element: createLog(ctx, bufferSize, format) }

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

const DEFAULT_LOG_ROWS = 3

/**
 * Mini scrollable console (tweakpane bufferSize behavior): keeps the last
 * `bufferSize` values as lines, newest at the bottom, pinned to the tail
 * unless the user scrolled up to read history.
 */
function createLog(
  ctx: PluginContext<unknown>,
  bufferSize: number,
  format: (v: unknown) => string,
): HTMLElement {
  const rows = typeof ctx.options['rows'] === 'number' ? ctx.options['rows'] : DEFAULT_LOG_ROWS
  const el = h('div', 'tiao-monitor-log')
  el.style.setProperty('--tiao-log-rows', String(rows))

  const push = (v: unknown) => {
    const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    el.append(h('div', 'tiao-monitor-log-line', format(v)))
    while (el.childElementCount > bufferSize) el.firstElementChild?.remove()
    if (stick) el.scrollTop = el.scrollHeight
  }
  push(ctx.value.get())
  ctx.onDispose(ctx.value.subscribe(push))
  return el
}

function defaultFormat(v: unknown): string {
  if (typeof v === 'number') return formatNumber(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v) ?? String(v)
}

const DEFAULT_BUFFER = 128

/** Rolling line graph for numeric values. Always full-width; optional `label` sits bottom-left. */
export const graphMonitorPlugin: MonitorPlugin<number> = {
  id: 'graph',
  type: 'monitor',
  accept(value, options) {
    return typeof value === 'number' && options.view === 'graph'
  },
  create(ctx) {
    return { element: createGraph(ctx), full: true }
  },
}

export function createGraph(
  ctx: Pick<PluginContext<number>, 'value' | 'options' | 'onDispose'>,
): HTMLElement {
  const requestedBuffer = ctx.options['bufferSize']
  const bufferSize =
    typeof requestedBuffer === 'number' && Number.isFinite(requestedBuffer)
      ? Math.max(2, Math.floor(requestedBuffer))
      : DEFAULT_BUFFER
  const buffer: number[] = []
  const canvas = h('canvas', 'tiao-graph-canvas')
  const numberEl = h('span', 'tiao-graph-number')
  // unit (e.g. "s", "FPS") renders after the number in a subtler color
  const unit = typeof ctx.options['unit'] === 'string' ? ctx.options['unit'] : ''
  const valueEl = h('span', 'tiao-graph-value', numberEl, unit ? h('span', 'tiao-graph-unit', unit) : null)
  // only an explicit options.label — not the binding key fallback — becomes the overlay
  const label = typeof ctx.options.label === 'string' && ctx.options.label ? ctx.options.label : ''
  const labelEl = label ? h('span', 'tiao-graph-label', label) : null
  const el = h('div', 'tiao-graph', canvas, valueEl, labelEl)
  let labelText = label

  const explicitMin = ctx.options.min
  const explicitMax = ctx.options.max
  const format = ctx.options.format ?? ((v: number) => formatNumber(v))

  let width = 0
  let height = 0
  let dirty = false
  // getComputedStyle returns a live declaration; resolve it once, read per draw
  let computed: CSSStyleDeclaration | null = null
  let c2d: CanvasRenderingContext2D | null = null
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    // zero size means collapsed/hidden: stop drawing until visible again
    if (rect.width === 0) {
      width = 0
      return
    }
    width = Math.round(rect.width * dpr)
    height = Math.round(rect.height * dpr)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    if (dirty) draw()
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  ro?.observe(canvas)
  ctx.onDispose(() => ro?.disconnect())

  const draw = () => {
    if (width === 0 || buffer.length === 0) {
      dirty = true
      return
    }
    c2d ??= canvas.getContext('2d')
    if (!c2d) return
    const c = c2d
    dirty = false
    const hasMin = typeof explicitMin === 'number' && Number.isFinite(explicitMin)
    const hasMax = typeof explicitMax === 'number' && Number.isFinite(explicitMax)
    let min = hasMin ? explicitMin : Infinity
    let max = hasMax ? explicitMax : -Infinity
    for (const v of buffer) {
      if (!hasMin && v < min) min = v
      if (!hasMax && v > max) max = v
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return
    // stats.js graphs use zero as their baseline. Keep zero in automatically
    // derived ranges so area height represents value instead of window variance.
    if (!hasMin && min > 0) min = 0
    if (!hasMax && max < 0) max = 0
    if (min === max) {
      if (hasMin && !hasMax) max += 1
      else if (!hasMin && hasMax) min -= 1
      else {
        min -= 1
        max += 1
      }
    } else if (min > max) {
      const lower = max
      max = min
      min = lower
    }
    c.clearRect(0, 0, width, height)
    computed ??= getComputedStyle(el)
    c.fillStyle =
      computed.getPropertyValue('--tiao-graph-accent').trim() ||
      computed.getPropertyValue('--tiao-graph-stroke').trim() ||
      computed.color
    const configuredOpacity = Number.parseFloat(
      computed.getPropertyValue('--tiao-graph-fill-opacity'),
    )
    c.globalAlpha = Number.isFinite(configuredOpacity)
      ? Math.min(1, Math.max(0, configuredOpacity))
      : 0.28
    c.beginPath()
    const step = width / Math.max(bufferSize - 1, 1)
    const firstX = width - (buffer.length - 1) * step
    const yFor = (v: number) => {
      const ratio = Math.min(1, Math.max(0, (v - min) / (max - min)))
      return (1 - ratio) * height
    }
    if (buffer.length === 1) {
      const left = Math.max(0, width - Math.max(step, dpr))
      c.moveTo(left, yFor(buffer[0]!))
      c.lineTo(width, yFor(buffer[0]!))
      c.lineTo(width, height)
      c.lineTo(left, height)
    } else {
      buffer.forEach((v, i) => {
        const x = firstX + i * step
        const y = yFor(v)
        if (i === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      })
      c.lineTo(width, height)
      c.lineTo(Math.max(0, firstX), height)
    }
    c.closePath()
    c.fill()
    c.globalAlpha = 1
  }

  // Label shows the observed range over the plotted window, e.g. "FPS (80-140)".
  // The buffer *is* the window — the parenthesized range always describes exactly
  // what's on screen; the monitor interval determines its elapsed duration.
  const updateLabel = () => {
    if (!labelEl || buffer.length === 0) return
    let lo = buffer[0]!
    let hi = lo
    for (const v of buffer) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const loText = format(lo)
    const hiText = format(hi)
    const next = loText === hiText ? `${label} (${loText})` : `${label} (${loText}-${hiText})`
    if (next !== labelText) {
      labelText = next
      labelEl.textContent = next
    }
  }

  ctx.onDispose(
    ctx.value.subscribe((v) => {
      numberEl.textContent = format(v)
      // Keep a transient invalid reading from poisoning the rolling scale.
      if (!Number.isFinite(v)) return
      buffer.push(v)
      // at most one over per sample; shift avoids splice's discard-array allocation
      while (buffer.length > bufferSize) buffer.shift()
      updateLabel()
      draw()
    }),
  )

  return el
}
