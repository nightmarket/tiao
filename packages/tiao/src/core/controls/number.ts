import { h, startDrag } from '../dom'
import { clamp, mapRange, nudge, snap } from '../util'
import { createScrubber } from './scrubber'
import { bindSliderTrack } from './slider'
import type { InputPlugin, PluginContext, PluginView } from '../plugin'

/**
 * Number input (tweakpane-style). With min & max it renders a full-width fill
 * slider with the value field overlaid on the right; otherwise a scrubber field.
 */
export const numberInputPlugin: InputPlugin<number> = {
  id: 'number',
  type: 'input',
  accept(value) {
    return typeof value === 'number'
  },
  create(ctx) {
    const { min, max } = ctx.options
    if (typeof min === 'number' && typeof max === 'number') {
      return createSliderRow(ctx, min, max)
    }
    return createScrubberRow(ctx)
  },
}

function createSliderRow(ctx: PluginContext<number>, min: number, max: number): PluginView {
  const { value, options } = ctx
  const step = options.step
  const constrain = (v: number) => clamp(snap(v, step), min, max)

  const fill = h('div', 'tiao-slider-fill')
  const track = h('div', 'tiao-slider', fill)
  const scrub = createScrubber(
    value,
    () => value.get(),
    (v, last) => value.set(constrain(v), { source: 'ui', last }),
    {
      min,
      max,
      // fill-edge handlebar is the affordance; track owns dragging on the fill
      guide: false,
      fieldDrag: false,
      scrubAnchor: 'input',
      ...(options.format ? { format: options.format } : {}),
      ...(typeof step === 'number' ? { step } : {}),
    },
  )
  scrub.element.classList.add('tiao-slider-num')
  const el = h('div', 'tiao-number', track, scrub.element)

  const render = (v: number) => {
    fill.style.width = `${clamp(mapRange(v, min, max, 0, 100), 0, 100)}%`
  }
  render(value.get())
  ctx.onDispose(value.subscribe(render))
  ctx.onDispose(scrub.dispose)

  const { setTrackActive } = bindSliderTrack({
    el,
    track,
    min,
    max,
    step,
    handlers: {
      apply: (raw, last) => value.set(constrain(raw), { source: 'ui', last }),
      onKeyDelta: (delta, base) => {
        value.set(clamp(nudge(value.get(), delta, base), min, max), { source: 'ui', last: true })
      },
    },
    onDispose: ctx.onDispose,
  })
  // keyboard support on the track (Shift ×10, Alt ÷10)
  track.tabIndex = 0

  /** row long-press: mouse position = current value; drag left/right from there */
  const beginRelativeScrub = (e: PointerEvent) => {
    const base = value.get()
    const width = track.getBoundingClientRect().width || 1
    const unitsPerPx = (max - min) / width
    setTrackActive(true)
    startDrag(e, {
      onStart: (ev) => {
        ev.preventDefault()
      },
      onMove: (s) => {
        value.set(constrain(base + s.dx * unitsPerPx), { source: 'ui', last: false })
      },
      onEnd: (s) => {
        value.set(constrain(base + s.dx * unitsPerPx), { source: 'ui', last: true })
        setTrackActive(false)
      },
    })
  }

  return {
    element: el,
    activate: scrub.activate,
    // row long-press: relative from current value (track click still jumps)
    beginScrub: beginRelativeScrub,
  }
}

function createScrubberRow(ctx: PluginContext<number>): PluginView {
  const { value, options } = ctx
  const opts: { min?: number; max?: number; step?: number; format?: (v: number) => string } = {}
  if (options.format) opts.format = options.format
  if (typeof options.min === 'number') opts.min = options.min
  if (typeof options.max === 'number') opts.max = options.max
  if (typeof options.step === 'number') opts.step = options.step

  const scrub = createScrubber(
    value,
    () => value.get(),
    (v, last) => value.set(v, { source: 'ui', last }),
    opts,
  )
  ctx.onDispose(scrub.dispose)
  return { element: scrub.element, activate: scrub.activate, beginScrub: scrub.beginScrub }
}
