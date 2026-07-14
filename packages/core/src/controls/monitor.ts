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
  const bufferSize = (ctx.options['bufferSize'] as number | undefined) ?? DEFAULT_BUFFER
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
    if (width === 0 || buffer.length < 2) {
      dirty = true
      return
    }
    c2d ??= canvas.getContext('2d')
    if (!c2d) return
    const c = c2d
    dirty = false
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
    computed ??= getComputedStyle(el)
    c.strokeStyle = computed.getPropertyValue('--tiao-graph-stroke').trim() || computed.color
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

  // Label shows the observed range over the plotted window, e.g. "FPS (80-140)".
  // The buffer *is* the window — the parenthesized range always describes exactly
  // what's on screen (bufferSize samples ≈ 32s at the default 250ms poll).
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
      buffer.push(v)
      // at most one over per sample; shift avoids splice's discard-array allocation
      while (buffer.length > bufferSize) buffer.shift()
      numberEl.textContent = format(v)
      updateLabel()
      draw()
    }),
  )

  return el
}
