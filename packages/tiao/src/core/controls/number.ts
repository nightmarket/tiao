import { h } from '../dom'
import type { InputPlugin, PluginContext, PluginView } from '../plugin'
import { clamp, mapRange, nudge, snap } from '../util'
import { createScrubber } from './scrubber'
import { bindSliderTrack, createSliderTrack, dodgeReadout, setSliderFillRange } from './slider'

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

  const track = createSliderTrack()
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
      ...(options.format ? { format: options.format } : {}),
      ...(typeof step === 'number' ? { step } : {}),
    },
  )
  scrub.element.classList.add('tiao-slider-num')
  const el = h('div', 'tiao-number', track, scrub.element)

  const dodge = dodgeReadout({
    el,
    track,
    readout: scrub.element,
    input: scrub.input,
    side: 'end',
    onDispose: ctx.onDispose,
  })
  const render = (v: number) => {
    const pct = clamp(mapRange(v, min, max, 0, 100), 0, 100)
    setSliderFillRange(track, 0, pct)
    dodge(pct)
  }
  render(value.get())
  ctx.onDispose(value.subscribe(render))
  ctx.onDispose(scrub.dispose)

  const { beginRelativeDrag } = bindSliderTrack({
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

  return {
    element: el,
    activate: scrub.activate,
    beginScrub: (e) => {
      const base = value.get()
      beginRelativeDrag(e, (delta, last) =>
        value.set(constrain(base + delta), { source: 'ui', last }),
      )
    },
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
