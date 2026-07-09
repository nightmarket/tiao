import { h, setEwCursor, setRowActive, startDrag } from '../dom'
import { arrowKeyStep, clamp, isRecord, mapRange, nudge, snap } from '../util'
import { createScrubber } from './scrubber'
import { Value } from '../value'
import type { InputPlugin, PluginContext, PluginView } from '../plugin'

export interface IntervalValue {
  min: number
  max: number
}

function isInterval(value: unknown): value is IntervalValue {
  if (!isRecord(value)) return false
  if (Object.keys(value).length !== 2) return false
  return typeof value.min === 'number' && typeof value.max === 'number'
}

type Endpoint = 'min' | 'max'

/**
 * Interval input: `{ min, max }` endpoints on a full-width track.
 * Binding `min`/`max`/`step` options set the allowed range (tweakpane-style).
 * The filled band is the interval; from sits on the left, to on the right.
 */
export const intervalInputPlugin: InputPlugin<IntervalValue> = {
  id: 'interval',
  type: 'input',
  accept(value) {
    return isInterval(value)
  },
  create(ctx) {
    return createIntervalRow(ctx)
  },
}

function createIntervalRow(ctx: PluginContext<IntervalValue>): PluginView {
  const { value, options } = ctx
  const step = options.step
  const initial = value.get()
  // outer track bounds; fall back to a padded span around the current interval
  const rangeMin =
    typeof options.min === 'number' ? options.min : Math.min(0, initial.min, initial.max)
  const rangeMax =
    typeof options.max === 'number' ? options.max : Math.max(100, initial.min, initial.max)

  // move one endpoint, keeping min <= max
  const setEndpoint = (side: Endpoint, v: number, last: boolean) => {
    const cur = value.get()
    const next =
      side === 'min'
        ? { min: clamp(snap(v, step), rangeMin, cur.max), max: cur.max }
        : { min: cur.min, max: clamp(snap(v, step), cur.min, rangeMax) }
    value.set(next, { source: 'ui', last })
  }

  const fill = h('div', 'tiao-slider-fill')
  const track = h('div', 'tiao-slider', fill)

  const scrubOpts = {
    min: rangeMin,
    max: rangeMax,
    // fill-edge handlebars are the affordance; track owns dragging on the fill
    guide: false,
    fieldDrag: false,
    ...(options.format ? { format: options.format } : {}),
    ...(typeof step === 'number' ? { step } : {}),
  }
  const makeEndpoint = (side: Endpoint) => {
    const endpointValue = new Value(initial[side])
    ctx.onDispose(value.subscribe((v) => endpointValue.set(v[side])))
    const scrub = createScrubber(
      endpointValue,
      () => value.get()[side],
      (v, last) => setEndpoint(side, v, last),
      scrubOpts,
    )
    // absolute placement over the track comes from .tiao-interval-min/max CSS
    scrub.element.classList.add(`tiao-interval-${side}`)
    ctx.onDispose(scrub.dispose)
    return scrub
  }
  const minScrub = makeEndpoint('min')
  const maxScrub = makeEndpoint('max')

  const el = h('div', 'tiao-number tiao-interval', track, minScrub.element, maxScrub.element)

  const render = (v: IntervalValue) => {
    const left = clamp(mapRange(v.min, rangeMin, rangeMax, 0, 100), 0, 100)
    const right = clamp(mapRange(v.max, rangeMin, rangeMax, 0, 100), 0, 100)
    fill.style.left = `${left}%`
    fill.style.width = `${Math.max(0, right - left)}%`
  }
  render(value.get())
  ctx.onDispose(value.subscribe(render))

  // track drag grabs the nearer endpoint; outside the band always picks
  // the adjacent edge so from/to stay independently adjustable
  let trackRect: DOMRect | null = null
  let active: Endpoint = 'min'
  const fromPointer = (clientX: number) => {
    const rect = (trackRect ??= track.getBoundingClientRect())
    return mapRange(clientX, rect.left, rect.right, rangeMin, rangeMax)
  }
  const pickEndpoint = (raw: number, cur: IntervalValue): Endpoint => {
    if (raw <= cur.min) return 'min'
    if (raw >= cur.max) return 'max'
    return Math.abs(raw - cur.min) <= Math.abs(raw - cur.max) ? 'min' : 'max'
  }
  const setTrackActive = (on: boolean) => {
    el.classList.toggle('tiao-slider-dragging', on)
    setRowActive(el, on)
    setEwCursor(track, on)
  }
  const beginTrackDrag = (e: PointerEvent) => {
    trackRect = track.getBoundingClientRect()
    setTrackActive(true)
    active = pickEndpoint(fromPointer(e.clientX), value.get())
    setEndpoint(active, fromPointer(e.clientX), false)
    startDrag(e, {
      onMove: (s) => setEndpoint(active, fromPointer(s.x), false),
      onEnd: (s) => {
        setEndpoint(active, fromPointer(s.x), true)
        setTrackActive(false)
      },
    })
  }
  const onTrackPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    beginTrackDrag(e)
  }
  track.addEventListener('pointerdown', onTrackPointerDown)
  ctx.onDispose(() => track.removeEventListener('pointerdown', onTrackPointerDown))

  // keep the track out of tab order so Tab goes from → to
  const onKeyDown = (e: KeyboardEvent) => {
    const base = step ?? (rangeMax - rangeMin) / 100
    const delta = arrowKeyStep(e, base)
    if (!delta) return
    e.preventDefault()
    const cur = value.get()
    // nudge "to" without re-snapping so Alt fractions survive (matches scrubber)
    const nextMax = clamp(nudge(cur.max, delta, base), cur.min, rangeMax)
    value.set({ min: cur.min, max: nextMax }, { source: 'ui', last: true })
  }
  track.addEventListener('keydown', onKeyDown)
  ctx.onDispose(() => track.removeEventListener('keydown', onKeyDown))

  return {
    element: el,
    // row click focuses "from"; Tab advances to "to"
    activate: () => minScrub.activate(),
    beginScrub: beginTrackDrag,
  }
}
