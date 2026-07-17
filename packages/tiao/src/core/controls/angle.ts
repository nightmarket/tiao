import { h, startDrag } from '../dom'
import { clamp, formatNumber, snap } from '../util'
import { createStickyOverlay } from './popup'
import { createOverlayTooltip, createScrubber } from './scrubber'
import type { InputPlugin, PluginContext, PluginView } from '../plugin'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TAU = Math.PI * 2
const DIAL_SIZE = 72
/** screen angle: 0 at 12 o'clock, clockwise */
const toScreen = (rad: number) => rad - Math.PI / 2

/**
 * Angle input: mini dial preview + number field. Opt in with `{ view: 'angle' }`.
 * Degrees by default (`unit: 'rad'` for radians). Click the dial for a sticky
 * transparent picker centered on the icon (hover follows, mousedown commits);
 * long-press for a free pointer-angle drag.
 */
export const angleInputPlugin: InputPlugin<number> = {
  id: 'angle',
  type: 'input',
  accept(value, options) {
    return typeof value === 'number' && options.view === 'angle'
  },
  create(ctx) {
    return createAngleRow(ctx)
  },
}

function createAngleRow(ctx: PluginContext<number>): PluginView {
  const { value, options } = ctx
  const unit = options.unit === 'rad' ? 'rad' : 'deg'
  const step =
    typeof options.step === 'number' ? options.step : unit === 'deg' ? 1 : Math.PI / 180
  const min = typeof options.min === 'number' ? options.min : undefined
  const max = typeof options.max === 'number' ? options.max : undefined
  const toRad = (v: number) => (unit === 'deg' ? (v * Math.PI) / 180 : v)
  const fromRad = (rad: number) => (unit === 'deg' ? (rad * 180) / Math.PI : rad)
  const format =
    options.format ??
    ((v: number) => `${formatNumber(v, step)}${unit === 'deg' ? '°' : ''}`)

  const constrain = (v: number) => {
    const snapped = snap(v, step)
    return clamp(snapped, min ?? -Infinity, max ?? Infinity)
  }

  const setFromPointer = (
    originX: number,
    originY: number,
    clientX: number,
    clientY: number,
    last: boolean,
  ) => {
    const dx = clientX - originX
    const dy = clientY - originY
    if (dx === 0 && dy === 0) return
    let rad = Math.atan2(dx, -dy) // 0 at 12 o'clock, clockwise
    if (rad < 0) rad += TAU
    value.set(constrain(fromRad(rad)), { source: 'ui', last })
  }

  // --- mini dial preview ---
  const needle = ctx.document.createElementNS(SVG_NS, 'line')
  needle.setAttribute('class', 'tiao-angle-knob-needle')
  needle.setAttribute('x1', '8')
  needle.setAttribute('y1', '8')
  const knobSvg = ctx.document.createElementNS(SVG_NS, 'svg')
  knobSvg.setAttribute('viewBox', '0 0 16 16')
  knobSvg.setAttribute('class', 'tiao-angle-knob-svg')
  knobSvg.setAttribute('aria-hidden', 'true')
  knobSvg.append(needle)
  const knob = h('button', 'tiao-angle-knob', knobSvg)
  knob.type = 'button'
  knob.title = 'Angle'

  const renderKnob = (v: number) => {
    const a = toScreen(toRad(v))
    const r = 5.5
    needle.setAttribute('x2', String(8 + Math.cos(a) * r))
    needle.setAttribute('y2', String(8 + Math.sin(a) * r))
  }
  renderKnob(value.get())

  const scrub = createScrubber(
    value,
    () => value.get(),
    (v, last) => value.set(constrain(v), { source: 'ui', last }),
    {
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      step,
      format,
      guide: false,
    },
  )
  scrub.element.classList.add('tiao-angle-field')
  const grip = scrub.element.querySelector('.tiao-scrub-grip') as HTMLElement
  grip.style.display = 'none'
  ctx.onDispose(scrub.dispose)

  const root = h('div', 'tiao-angle', knob, scrub.element)
  const doc = ctx.document

  // --- shared transparent dial overlay (click sticky + long-press drag) ---
  const dial = createAngleDial(doc, DIAL_SIZE)
  const overlay = h('div', 'tiao-scrub-overlay tiao-angle-overlay', dial.element)
  dial.element.style.transform = 'translate(-50%, -50%)'
  const tooltip = createOverlayTooltip(overlay)
  let originX = 0
  let originY = 0

  const centerOnKnob = () => {
    const rect = knob.getBoundingClientRect()
    originX = rect.left + rect.width / 2
    originY = rect.top + rect.height / 2
    overlay.style.left = `${originX}px`
    overlay.style.top = `${originY}px`
  }

  // stroke/arrow direction flips only when the pointer crosses the 0° seam
  // (not on every CW/CCW wiggle). Default is clockwise from zero.
  let lastPointerRad: number | null = null
  let ccw = false

  const syncDial = () => dial.render(toRad(value.get()), ccw)

  const pointerRad = (clientX: number, clientY: number): number | null => {
    const dx = clientX - originX
    const dy = clientY - originY
    if (dx === 0 && dy === 0) return null
    let rad = Math.atan2(dx, -dy)
    if (rad < 0) rad += TAU
    return rad
  }

  const noteDirection = (rad: number) => {
    if (lastPointerRad !== null) {
      const raw = rad - lastPointerRad
      // |raw| > π means the short path wrapped across 0°/360°
      if (Math.abs(raw) > Math.PI) {
        let d = raw
        while (d > Math.PI) d -= TAU
        while (d < -Math.PI) d += TAU
        ccw = d < 0
      }
    }
    lastPointerRad = rad
  }

  const applyPointer = (clientX: number, clientY: number, last: boolean) => {
    const rad = pointerRad(clientX, clientY)
    if (rad !== null) noteDirection(rad)
    setFromPointer(originX, originY, clientX, clientY, last)
    syncDial()
    tooltip.place(originX, originY, clientX, clientY, format(value.get()))
  }

  const beginAngleDrag = (ev: PointerEvent) => {
    dialOverlay.open({ sticky: false, follow: false })
    startDrag(ev, {
      onStart: (e) => {
        e.preventDefault()
        applyPointer(e.clientX, e.clientY, false)
      },
      onMove: (s) => applyPointer(s.x, s.y, false),
      onEnd: (s) => {
        applyPointer(s.x, s.y, true)
        dialOverlay.close()
      },
    })
  }

  const dialOverlay = createStickyOverlay({
    document: doc,
    trigger: knob,
    root,
    overlay,
    dragClass: 'tiao-angle-dragging',
    // always center on the icon, regardless of where the press started; sticky
    // mode follows moves only — icon click is at the origin, don't jump the angle
    center: centerOnKnob,
    apply: applyPointer,
    onLongPress: beginAngleDrag,
    onOpen: () => {
      lastPointerRad = toRad(value.get())
      ccw = false
      tooltip.hide()
    },
    onClose: () => {
      lastPointerRad = null
      ccw = false
      tooltip.hide()
    },
    render: syncDial,
    onDispose: ctx.onDispose,
  })

  ctx.onDispose(
    value.subscribe((v) => {
      renderKnob(v)
      if (dialOverlay.isOpen()) syncDial()
    }),
  )

  return {
    element: root,
    activate: () => dialOverlay.toggleSticky(),
    beginScrub: beginAngleDrag,
  }
}

interface AngleDial {
  element: HTMLElement
  /** `ccw` flips the solid arc + arrow after crossing 0° counter-clockwise */
  render(rad: number, ccw?: boolean): void
}

function createAngleDial(doc: Document, size: number): AngleDial {
  const radius = size * 0.42
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'tiao-angle-dial-svg')
  svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')

  const ringDot = doc.createElementNS(SVG_NS, 'path')
  ringDot.setAttribute('class', 'tiao-angle-ring-dot')
  const ringSolid = doc.createElementNS(SVG_NS, 'path')
  ringSolid.setAttribute('class', 'tiao-angle-ring-solid')
  const zero = doc.createElementNS(SVG_NS, 'line')
  zero.setAttribute('class', 'tiao-angle-zero')
  const ray = doc.createElementNS(SVG_NS, 'line')
  ray.setAttribute('class', 'tiao-angle-ray')
  const arrow = doc.createElementNS(SVG_NS, 'path')
  arrow.setAttribute('class', 'tiao-angle-arrow')
  const hub = doc.createElementNS(SVG_NS, 'circle')
  hub.setAttribute('class', 'tiao-angle-hub')
  hub.setAttribute('r', '2.5')
  hub.setAttribute('cx', '0')
  hub.setAttribute('cy', '0')
  svg.append(ringDot, ringSolid, zero, ray, arrow, hub)

  const element = h('div', 'tiao-angle-dial', svg)

  /** arc along the shorter/longer path in the requested direction (SVG sweep) */
  const arcPath = (from: number, to: number, r: number, clockwise: boolean): string => {
    let delta = clockwise ? to - from : from - to
    while (delta < 0) delta += TAU
    while (delta >= TAU) delta -= TAU
    if (delta < 1e-4) return ''
    const x0 = Math.cos(from) * r
    const y0 = Math.sin(from) * r
    const x1 = Math.cos(to) * r
    const y1 = Math.sin(to) * r
    const large = delta > Math.PI ? 1 : 0
    const sweep = clockwise ? 1 : 0
    return `M ${x0},${y0} A ${r},${r} 0 ${large} ${sweep} ${x1},${y1}`
  }

  const render = (rad: number, ccw = false) => {
    const a = toScreen(rad)
    const zeroA = toScreen(0)
    const tipX = Math.cos(a) * radius
    const tipY = Math.sin(a) * radius
    const zx = Math.cos(zeroA) * radius
    const zy = Math.sin(zeroA) * radius
    const clockwise = !ccw

    ringSolid.setAttribute('d', arcPath(zeroA, a, radius, clockwise) || `M ${zx},${zy}`)
    ringDot.setAttribute(
      'd',
      arcPath(a, zeroA, radius, clockwise) ||
        `M ${zx},${zy} A ${radius},${radius} 0 1 ${clockwise ? 1 : 0} ${zx - 0.01},${zy}`,
    )
    zero.setAttribute('x1', '0')
    zero.setAttribute('y1', '0')
    zero.setAttribute('x2', String(zx))
    zero.setAttribute('y2', String(zy))
    ray.setAttribute('x1', '0')
    ray.setAttribute('y1', '0')
    ray.setAttribute('x2', String(tipX))
    ray.setAttribute('y2', String(tipY))

    // tangent along the motion direction (CW or CCW)
    const tx = clockwise ? -Math.sin(a) : Math.sin(a)
    const ty = clockwise ? Math.cos(a) : -Math.cos(a)
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    const ah = 5
    const aw = 3.5
    const tipAx = tipX + tx
    const tipAy = tipY + ty
    arrow.setAttribute(
      'd',
      `M ${tipAx - tx * ah + nx * aw},${tipAy - ty * ah + ny * aw} L ${tipAx},${tipAy} L ${tipAx - tx * ah - nx * aw},${tipAy - ty * ah - ny * aw}`,
    )
  }
  render(0)

  return { element, render }
}
