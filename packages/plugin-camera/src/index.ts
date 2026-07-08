import {
  clamp,
  createScrubber,
  draggable,
  h,
  registerPlugin,
  snap,
  type InputPlugin,
  type PluginContext,
} from '@tiao/core'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** how the ring scale maps values to pixels */
export interface RingUnit {
  /** width of one unit in pixels */
  pixels: number
  /** ticks per unit */
  ticks: number
  /** value covered by one unit */
  value: number
}

export type RingSeries = 0 | 1 | 2

const DEFAULT_RING_UNIT: RingUnit = { ticks: 5, pixels: 40, value: 10 }
const WHEEL_TICKS = 10
const WHEEL_PIXELS = 40

function decimalDigits(n: number): number {
  const s = String(n)
  const e = s.indexOf('e-')
  if (e >= 0) return Number(s.slice(e + 2))
  const dot = s.indexOf('.')
  return dot >= 0 ? s.length - dot - 1 : 0
}

/** scale labels get a trailing space when signed so digits stay optically centered */
function createRingFormatter(unit: RingUnit): (v: number) => string {
  const digits = decimalDigits(unit.value)
  return (v) => {
    const text = v.toFixed(digits)
    const ch = text.charAt(0)
    return text + (ch === '-' || ch === '+' ? ' ' : '')
  }
}

interface RingConfig {
  seriesId: string
  unit: RingUnit
  ringFormat: (v: number) => string
  textFormat: (v: number) => string
  tooltipEnabled: boolean
}

/**
 * Scrollable tick-scale ("camera ring") for a number value. Structure and
 * behavior mirror tweakpane's camerakit: an infinite scale of major/minor
 * ticks and labels slides under a fixed center marker; labels fade out
 * toward the edges.
 */
function createRing(ctx: PluginContext<number>, config: RingConfig): HTMLElement {
  const doc = ctx.document
  const { unit, seriesId } = config

  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'tiao-ring-g')
  const offsetEl = h('div', 'tiao-ring-o')
  offsetEl.append(svg)
  const wrapper = h('div', 'tiao-ring-w', offsetEl)
  const tooltip = h('div', 'tiao-ring-tt')
  const el = h('div', `tiao-ring tiao-ring-m${seriesId}`, wrapper, tooltip)

  let tickEls: SVGLineElement[] = []
  let labelEls: HTMLElement[] = []
  let boundsWidth = -1

  const constrain = (v: number): number =>
    clamp(snap(v, ctx.options.step), ctx.options.min ?? -Infinity, ctx.options.max ?? Infinity)

  const rebuildScaleIfNeeded = (bw: number) => {
    if (boundsWidth === bw) return
    boundsWidth = bw
    for (const t of tickEls) t.remove()
    for (const l of labelEls) l.remove()
    tickEls = []
    labelEls = []

    const tpu = unit.ticks
    const uw = unit.pixels
    const halfUnitCount = Math.ceil(bw / 2 / uw) + 1
    const tickCount = (halfUnitCount * 2 + 1) * tpu
    const tickWidth = uw / tpu
    for (let i = 0; i < tickCount; i++) {
      const x = i * tickWidth
      const major = i % tpu === 0
      const line = doc.createElementNS(SVG_NS, 'line')
      line.setAttribute('class', major ? 'tiao-ring-mjt' : 'tiao-ring-mnt')
      line.setAttribute('x1', String(x))
      line.setAttribute('y1', '0')
      line.setAttribute('x2', String(x))
      line.setAttribute('y2', '2')
      svg.append(line)
      tickEls.push(line)
      if (major) {
        const label = h('div', 'tiao-ring-l')
        label.style.left = `${x}px`
        offsetEl.append(label)
        labelEls.push(label)
      }
    }
  }

  const updateScale = (bw: number) => {
    const uv = unit.value
    const uw = unit.pixels
    const v = ctx.value.get()
    const halfUnitCount = Math.ceil(bw / 2 / uw) + 1
    const ov = v - (v % uv) - uv * halfUnitCount
    // labels/ticks fade out as they approach the edges of the visible scale
    const opacity = (tv: number): number =>
      1 - Math.pow(clamp(Math.abs(v - tv) / ((bw / 2) * (uv / uw)), 0, 1), 10)

    labelEls.forEach((label, i) => {
      const lv = ov + i * uv
      label.textContent = config.ringFormat(lv)
      label.style.opacity = String(opacity(lv))
    })
    const tpu = unit.ticks
    tickEls.forEach((tick, i) => {
      tick.style.opacity = String(opacity(ov + (i / tpu) * uv))
    })
  }

  const update = () => {
    const bw = el.getBoundingClientRect().width
    if (bw === 0) return
    const uv = unit.value
    const uw = unit.pixels
    const v = ctx.value.get()
    const halfUnitCount = Math.ceil(bw / 2 / uw) + 1
    const offsetFromCenter = ((v % uv) + uv * halfUnitCount) * (uw / uv)
    offsetEl.style.transform = `translateX(${bw / 2 - offsetFromCenter}px)`
    tooltip.textContent = config.textFormat(v)
    rebuildScaleIfNeeded(bw)
    updateScale(bw)
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
  ro?.observe(el)
  ctx.onDispose(() => ro?.disconnect())

  update()
  ctx.onDispose(ctx.value.subscribe(update))

  // drag anywhere on the scale: 1 unit of pixels = 1 unit of value, inverted
  // so the scale follows the pointer
  let baseValue = 0
  ctx.onDispose(
    draggable(wrapper, {
      onStart: () => {
        baseValue = ctx.value.get()
        if (config.tooltipEnabled) el.classList.add('tiao-ring-dragging')
      },
      onMove: (s) => {
        ctx.value.set(constrain(baseValue - (s.dx / unit.pixels) * unit.value), {
          source: 'ui',
          last: false,
        })
      },
      onEnd: (s) => {
        ctx.value.set(constrain(baseValue - (s.dx / unit.pixels) * unit.value), {
          source: 'ui',
          last: true,
        })
        el.classList.remove('tiao-ring-dragging')
      },
    }),
  )

  return el
}

/** ring (2/3) + editable number field (1/3), the non-wide layout */
function createRingWithText(ctx: PluginContext<number>, config: RingConfig): HTMLElement {
  const ring = createRing(ctx, { ...config, tooltipEnabled: false })
  const format = ctx.options.format as ((v: number) => string) | undefined
  const scrub = createScrubber(
    ctx.value,
    () => ctx.value.get(),
    (v, last) => ctx.value.set(v, { source: 'ui', last }),
    {
      ...(ctx.options.min !== undefined && { min: ctx.options.min }),
      ...(ctx.options.max !== undefined && { max: ctx.options.max }),
      ...(ctx.options.step !== undefined && { step: ctx.options.step }),
      ...(format && { format }),
    },
  )
  ctx.onDispose(scrub.dispose)
  return h('div', 'tiao-ring-row', ring, scrub.element)
}

function textFormatter(ctx: PluginContext<number>): (v: number) => string {
  const custom = ctx.options.format as ((v: number) => string) | undefined
  if (custom) return custom
  const digits = ctx.options.step !== undefined ? decimalDigits(ctx.options.step) : 2
  return (v) => v.toFixed(digits)
}

/**
 * Camera-style ring input (tweakpane camerakit parity). Usage:
 *   registerCameraPlugin()
 *   pane.addBinding(params, 'flen', { view: 'cameraring', series: 0 })
 * Options: series (0|1|2), unit { pixels, ticks, value }, wide, min, max, step.
 */
export const cameraRingPlugin: InputPlugin<number> = {
  id: 'cameraring',
  type: 'input',
  accept(value, options) {
    return options.view === 'cameraring' && typeof value === 'number'
  },
  create(ctx) {
    ensureStyles(ctx.document)
    const series = ([0, 1, 2] as const).includes(ctx.options['series'] as RingSeries)
      ? (ctx.options['series'] as RingSeries)
      : 0
    const unit = isRingUnit(ctx.options['unit']) ? ctx.options['unit'] : DEFAULT_RING_UNIT
    const config: RingConfig = {
      seriesId: String(series),
      unit,
      ringFormat: createRingFormatter(unit),
      textFormat: textFormatter(ctx),
      tooltipEnabled: true,
    }
    const element = ctx.options['wide'] ? createRing(ctx, config) : createRingWithText(ctx, config)
    return { element }
  },
}

/**
 * Camera-style wheel input: a denser, label-free ring for fine adjustments.
 *   pane.addBinding(params, 'fnumber', { view: 'camerawheel', amount: 0.01 })
 * `amount` is the value change per pixel of drag.
 */
export const cameraWheelPlugin: InputPlugin<number> = {
  id: 'camerawheel',
  type: 'input',
  accept(value, options) {
    return options.view === 'camerawheel' && typeof value === 'number'
  },
  create(ctx) {
    ensureStyles(ctx.document)
    const amount =
      typeof ctx.options['amount'] === 'number' ? ctx.options['amount'] : ctx.options.step ?? 1
    const unit: RingUnit = { ticks: WHEEL_TICKS, pixels: WHEEL_PIXELS, value: amount * WHEEL_PIXELS }
    const config: RingConfig = {
      seriesId: 'w',
      unit,
      ringFormat: () => '',
      textFormat: textFormatter(ctx),
      tooltipEnabled: true,
    }
    const element = ctx.options['wide'] ? createRing(ctx, config) : createRingWithText(ctx, config)
    return { element }
  },
}

function isRingUnit(v: unknown): v is RingUnit {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as RingUnit).pixels === 'number' &&
    typeof (v as RingUnit).ticks === 'number' &&
    typeof (v as RingUnit).value === 'number'
  )
}

const CSS = `
.tiao-ring {
  position: relative;
  width: 100%;
  min-width: 0;
}
.tiao-ring-w {
  position: relative;
  height: var(--tiao-row-height);
  border-radius: var(--tiao-radius-sm);
  background: var(--tiao-surface);
  overflow: hidden;
  cursor: ew-resize;
  touch-action: none;
  transition: background 0.12s ease;
}
.tiao-ring-w:hover {
  background: var(--tiao-surface-hover);
}
.tiao-ring-o {
  position: relative;
  height: 100%;
  left: 0;
}
.tiao-ring-g {
  display: block;
  position: absolute;
  width: 100%;
  height: 2px;
  overflow: visible;
}
.tiao-ring-mjt {
  stroke: var(--tiao-fg-muted);
  stroke-width: 2;
  transform-origin: bottom;
}
.tiao-ring-mnt {
  stroke: var(--tiao-fg-muted);
  stroke-width: 1;
  transform-origin: bottom;
}
.tiao-ring-l {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  color: var(--tiao-fg-muted);
  font-family: var(--tiao-font-mono);
  font-size: 9px;
  pointer-events: none;
  white-space: pre;
}
/* baseline through the middle */
.tiao-ring::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  margin: auto;
  height: 2px;
  background: var(--tiao-border);
  pointer-events: none;
}
/* fixed center marker */
.tiao-ring::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  margin: auto;
  background: var(--tiao-accent);
  pointer-events: none;
}

/* series 0: compact ticks under the labels, short center needle */
.tiao-ring-m0::before {
  display: none;
}
.tiao-ring-m0::after {
  bottom: 3px;
  height: 6px;
  width: 2px;
}
.tiao-ring-m0 .tiao-ring-g {
  top: 0;
  bottom: 0;
  margin: auto;
  transform: translateY(4px);
}
.tiao-ring-m0 .tiao-ring-mjt {
  transform: scaleY(3);
}
.tiao-ring-m0 .tiao-ring-mnt {
  transform: scaleY(2);
}
.tiao-ring-m0 .tiao-ring-l {
  line-height: 9px;
  transform: translateX(-50%) scale(0.9);
}

/* series 1: tall bottom-anchored ticks, taller needle */
.tiao-ring-m1::before {
  display: none;
}
.tiao-ring-m1::after {
  bottom: 2px;
  height: 8px;
  width: 2px;
}
.tiao-ring-m1 .tiao-ring-g {
  bottom: 2px;
}
.tiao-ring-m1 .tiao-ring-mjt {
  stroke-width: 1;
  transform: scaleY(4);
}
.tiao-ring-m1 .tiao-ring-mnt {
  transform: scaleY(2);
}
.tiao-ring-m1 .tiao-ring-l {
  line-height: 13px;
}

/* series 2: labels riding a center baseline, dot marker, no ticks */
.tiao-ring-m2::before {
  transform: translateY(4px);
}
.tiao-ring-m2::after {
  border-radius: 2px;
  bottom: 2px;
  height: 4px;
  width: 4px;
}
.tiao-ring-m2 .tiao-ring-g {
  display: none;
}
.tiao-ring-m2 .tiao-ring-l {
  line-height: 13px;
}

/* wheel: dense full-height ticks, no labels or markers */
.tiao-ring-mw::before,
.tiao-ring-mw::after {
  display: none;
}
.tiao-ring-mw .tiao-ring-g {
  bottom: 0;
  opacity: 0.25;
}
.tiao-ring-mw .tiao-ring-mjt,
.tiao-ring-mw .tiao-ring-mnt {
  stroke: var(--tiao-fg-muted);
  stroke-width: 2;
  transform: scaleY(10);
}
.tiao-ring-mw .tiao-ring-l {
  display: none;
}

/* value tooltip while dragging a wide ring */
.tiao-ring-tt {
  position: absolute;
  left: 50%;
  top: -6px;
  transform: translate(-50%, -100%);
  padding: 2px 5px;
  border-radius: var(--tiao-radius-sm);
  background: var(--tiao-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--tiao-border);
  font-family: var(--tiao-font-mono);
  font-size: var(--tiao-font-size-mono);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  visibility: hidden;
  z-index: 10;
}
.tiao-ring-dragging .tiao-ring-tt {
  visibility: visible;
}

/* ring + number field layout */
.tiao-ring-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
}
.tiao-ring-row .tiao-ring {
  flex: 2;
}
.tiao-ring-row .tiao-scrub {
  flex: 1;
  min-width: 0;
}
`

function ensureStyles(doc: Document): void {
  if (doc.querySelector('style[data-tiao-camera]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-tiao-camera', '')
  style.textContent = CSS
  doc.head.append(style)
}

let registered = false

export function registerCameraPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(cameraRingPlugin)
  registerPlugin(cameraWheelPlugin)
}
