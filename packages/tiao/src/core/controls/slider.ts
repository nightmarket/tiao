import { spring } from 'motion'
import { animate } from 'motion/mini'
import { h, setEwCursor, setRowActive, startDrag } from '../dom'
import { SPRINGS } from '../styles'
import { arrowKeyStep, clamp, mapRange } from '../util'

/** Track + fill + handle overlay. Fill range is `--tiao-fill-start/end` on the track. */
export function createSliderTrack(): HTMLElement {
  return h('div', 'tiao-slider', h('div', 'tiao-slider-fill'), h('div', 'tiao-slider-handles'))
}

const fillRange = new WeakMap<HTMLElement, [number, number]>()

/** Percent span of the filled band; handlebars clamp against these in CSS. */
export function setSliderFillRange(track: HTMLElement, startPct: number, endPct: number): void {
  const prev = fillRange.get(track)
  if (prev && prev[0] === startPct && prev[1] === endPct) return
  fillRange.set(track, [startPct, endPct])
  track.style.setProperty('--tiao-fill-start', `${startPct}%`)
  track.style.setProperty('--tiao-fill-end', `${endPct}%`)
}

/** space kept between a handlebar and the readout digits beside it */
const READOUT_GAP = 4
/** extra clearance before a dodged readout hops home, so it can't flicker at the boundary */
const READOUT_HYSTERESIS = 4

/** a registered length (styles.css), so WAAPI interpolates it */
const HOP_OFFSET = '--tiao-readout-offset'
const DODGE_SPRING = { type: spring, visualDuration: SPRINGS.dodge[0], bounce: SPRINGS.dodge[1] }

/** track geometry in px, as .tiao-slider and the readout field lay it out */
export interface ReadoutGeometry {
  trackWidth: number
  /** --tiao-handle-inset / --tiao-handle-size */
  handleInset: number
  handleSize: number
  /** the field's padding on the edge its digits align to */
  padding: number
}

/**
 * Where a readout sits relative to its handlebar. `end` readouts rest
 * right-aligned at the track's right end (the single slider, an interval's
 * max); `start` ones rest at the left (an interval's min, a pinned slider's
 * label). `handle` is the fill edge whose bar it keeps clear of, the one on
 * its own side unless given. When the handle comes within READOUT_GAP of the
 * text, the readout dodges to the handle's far side and rides there; it goes
 * home once the handle is clear again. Returns the horizontal shift from the
 * rest position, in whole px.
 */
export function readoutOffset(
  geo: ReadoutGeometry,
  handlePct: number,
  textWidth: number,
  side: 'start' | 'end',
  wasDodged: boolean,
  handle: 'start' | 'end' = side,
): { dodged: boolean; shift: number } {
  const { trackWidth: w, handleInset: inset, handleSize: size, padding: pad } = geo
  const x = (handlePct / 100) * w
  // the bar's left edge, clamped exactly like .tiao-slider-handles does
  const bar =
    handle === 'end'
      ? clamp(x - inset - size, inset, w - inset - size)
      : clamp(x + inset, inset, w - inset - size)
  const clearance = side === 'end' ? w - pad - textWidth - (bar + size) : bar - (pad + textWidth)
  const dodged = clearance < READOUT_GAP + (wasDodged ? READOUT_HYSTERESIS : 0)
  if (!dodged) return { dodged, shift: 0 }
  // the far side, if the digits fit there; a track too short to hold them stays put
  if (side === 'end') {
    const shift = bar - READOUT_GAP - (w - pad)
    return w - pad + shift - textWidth >= 0 ? { dodged, shift: Math.round(shift) } : NO_DODGE
  }
  const shift = bar + size + READOUT_GAP - pad
  return pad + shift + textWidth <= w ? { dodged, shift: Math.round(shift) } : NO_DODGE
}

const NO_DODGE = { dodged: false, shift: 0 }

/**
 * One digit's width per readout type, keyed by the resolved font. Every
 * slider in a pane shares a type, so the layout-forcing probe runs once per
 * font rather than once per slider.
 */
const digitWidths = new Map<string, number>()

function digitWidth(doc: Document, cs: CSSStyleDeclaration): number {
  const key = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily} ${cs.fontVariationSettings} ${cs.letterSpacing}`
  const cached = digitWidths.get(key)
  if (cached !== undefined) return cached
  // a DOM probe rather than canvas, which can't apply the variation axes a
  // face like ABC Areal Mono relies on
  const probe = doc.createElement('span')
  probe.textContent = '0000000000'
  const ps = probe.style
  ps.position = 'absolute'
  ps.visibility = 'hidden'
  ps.whiteSpace = 'pre'
  ps.fontStyle = cs.fontStyle
  ps.fontWeight = cs.fontWeight
  ps.fontSize = cs.fontSize
  ps.fontFamily = cs.fontFamily
  ps.fontVariationSettings = cs.fontVariationSettings
  ps.fontVariantNumeric = cs.fontVariantNumeric
  ps.letterSpacing = cs.letterSpacing
  doc.body.append(probe)
  const width = probe.getBoundingClientRect().width / 10
  probe.remove()
  if (width > 0) digitWidths.set(key, width)
  return width
}

/** one observer for every slider track, each with a readout or two; entries carry the width, so no layout reads */
const trackWidthListeners = new WeakMap<Element, Set<(width: number) => void>>()
let trackObserver: ResizeObserver | null | undefined

function observeTrackWidth(track: HTMLElement, onWidth: (width: number) => void): () => void {
  if (trackObserver === undefined) {
    trackObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              for (const fn of trackWidthListeners.get(e.target) ?? []) fn(e.contentRect.width)
            }
          })
  }
  const observer = trackObserver
  if (!observer) return () => {}
  let listeners = trackWidthListeners.get(track)
  if (!listeners) {
    listeners = new Set()
    trackWidthListeners.set(track, listeners)
    observer.observe(track)
  }
  listeners.add(onWidth)
  return () => {
    listeners.delete(onWidth)
    if (listeners.size) return
    observer.unobserve(track)
    trackWidthListeners.delete(track)
  }
}

/**
 * Keep a fill slider's readout clear of its handlebar (see readoutOffset). The
 * track width comes from a shared ResizeObserver and the rest of the geometry
 * from computed style, re-read when the pointer comes over the control (a
 * theme or font may have changed), so each value change costs a multiply and
 * a custom property write (`--tiao-readout-shift`, which styles.css turns into
 * a translate). Returns the per-render update, fed the handle's fill percentage.
 */
export function dodgeReadout(opts: {
  /** control root; hovering it refreshes the cached measurements */
  el: HTMLElement
  track: HTMLElement
  /** the absolutely placed element that moves */
  readout: HTMLElement
  /** the text in it: a field, measured by its digits as they change, or a fixed label, measured once */
  text: HTMLElement
  side: 'start' | 'end'
  handle?: 'start' | 'end'
  onDispose(fn: () => void): void
}): (handlePct: number) => void {
  const { el, track, readout, text, side, handle } = opts
  let trackWidth = 0
  let geo: ReadoutGeometry | null = null
  /** a field's digit width (readouts are monospace, so its text is length × this), or a label's whole width */
  let advance = 0
  let dodged = false
  let shift = 0
  let lastPct = -1
  /** the first placement lands without a hop, so nothing slides in on load */
  let placed = false

  const readStyle = (): ReadoutGeometry | null => {
    const win = track.ownerDocument.defaultView
    if (!win) return null
    const trackCs = win.getComputedStyle(track)
    const textCs = win.getComputedStyle(text)
    const padding =
      Number.parseFloat(side === 'end' ? textCs.paddingRight : textCs.paddingLeft) || 0
    advance =
      text instanceof HTMLInputElement
        ? digitWidth(track.ownerDocument, textCs)
        : text.getBoundingClientRect().width - padding
    return {
      trackWidth,
      handleInset: Number.parseFloat(trackCs.getPropertyValue('--tiao-handle-inset')) || 0,
      handleSize: Number.parseFloat(trackCs.getPropertyValue('--tiao-handle-size')) || 0,
      padding,
    }
  }

  /**
   * A hop slides instead of teleporting: an offset from the old spot springs to
   * zero on top of the shift, so the readout still rides the handle exactly.
   * A hop mid-flight starts from wherever the last one had got to.
   */
  let hop: ReturnType<typeof animate> | null = null
  const hopBy = (delta: number) => {
    if (!delta || !readout.animate) return
    hop?.stop()
    const from = delta + (Number.parseFloat(readout.style.getPropertyValue(HOP_OFFSET)) || 0)
    hop = animate(readout, { [HOP_OFFSET]: [`${from}px`, '0px'] }, DODGE_SPRING)
  }
  opts.onDispose(() => hop?.stop())

  const update = (pct: number) => {
    lastPct = pct
    if (!trackWidth) return
    geo ??= readStyle()
    if (!geo || !advance) return
    geo.trackWidth = trackWidth
    const width = text instanceof HTMLInputElement ? text.value.length * advance : advance
    const next = readoutOffset(geo, pct, width, side, dodged, handle)
    if (next.dodged !== dodged) {
      dodged = next.dodged
      if (placed) hopBy(shift - next.shift)
    }
    placed = true
    if (next.shift !== shift) {
      shift = next.shift
      readout.style.setProperty('--tiao-readout-shift', shift ? `${shift}px` : '')
    }
  }

  const restyle = () => {
    geo = null
    if (lastPct >= 0) update(lastPct)
  }
  el.addEventListener('pointerenter', restyle)
  opts.onDispose(() => el.removeEventListener('pointerenter', restyle))
  opts.onDispose(
    observeTrackWidth(track, (width) => {
      trackWidth = width
      if (lastPct >= 0) update(lastPct)
    }),
  )
  return update
}

export interface SliderTrackHandlers {
  /** apply a pointer position mapped (unclamped) into [min, max] */
  apply(raw: number, last: boolean): void
  /** called once per drag with the initial mapped value, before the first apply */
  onDragStart?(raw: number): void
  /** arrow-key nudge (Shift ×10, Alt ÷10) with the resolved base step; makes the track focusable */
  onKeyDelta?(delta: number, base: number): void
}

/**
 * Shared fill-slider track behavior (number, interval): pointer drags map into
 * the [min, max] range with the rect read once per drag (no layout read per
 * pointermove), the row lights up while dragging, and arrow keys nudge.
 */
export function bindSliderTrack(opts: {
  /** control root that receives the dragging class + active-row state */
  el: HTMLElement
  track: HTMLElement
  min: number
  max: number
  step: number | undefined
  handlers: SliderTrackHandlers
  onDispose(fn: () => void): void
}): {
  /** row long-press: drag from the current value, since the pointer is on the label */
  beginRelativeDrag(e: PointerEvent, apply: (delta: number, last: boolean) => void): void
} {
  const { el, track, min, max, handlers } = opts
  let rect: DOMRect | null = null
  const fromPointer = (clientX: number) => {
    rect ??= track.getBoundingClientRect()
    return mapRange(clientX, rect.left, rect.right, min, max)
  }
  const setTrackActive = (on: boolean) => {
    el.classList.toggle('tiao-slider-dragging', on)
    setRowActive(el, on)
    setEwCursor(track, on)
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    rect = track.getBoundingClientRect()
    setTrackActive(true)
    const raw = fromPointer(e.clientX)
    handlers.onDragStart?.(raw)
    handlers.apply(raw, false)
    startDrag(e, {
      onMove: (s) => handlers.apply(fromPointer(s.x), false),
      onEnd: (s) => {
        handlers.apply(fromPointer(s.x), true)
        setTrackActive(false)
      },
    })
  }
  const beginRelativeDrag = (e: PointerEvent, apply: (delta: number, last: boolean) => void) => {
    const unitsPerPx = (max - min) / (track.getBoundingClientRect().width || 1)
    setTrackActive(true)
    startDrag(e, {
      onStart: (ev) => ev.preventDefault(),
      onMove: (s) => apply(s.dx * unitsPerPx, false),
      onEnd: (s) => {
        apply(s.dx * unitsPerPx, true)
        setTrackActive(false)
      },
    })
  }
  track.addEventListener('pointerdown', onPointerDown)
  opts.onDispose(() => track.removeEventListener('pointerdown', onPointerDown))

  const { onKeyDelta } = handlers
  if (onKeyDelta) {
    const onKeyDown = (e: KeyboardEvent) => {
      const base = opts.step ?? (max - min) / 100
      const delta = arrowKeyStep(e, base)
      if (!delta) return
      e.preventDefault()
      onKeyDelta(delta, base)
    }
    track.tabIndex = 0
    track.addEventListener('keydown', onKeyDown)
    opts.onDispose(() => track.removeEventListener('keydown', onKeyDown))
  }
  return { beginRelativeDrag }
}
