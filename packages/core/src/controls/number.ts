import { draggable, h } from '../dom'
import { clamp, mapRange, snap } from '../util'
import { createScrubber } from './scrubber'
import type { InputPlugin, PluginContext, PluginView } from '../plugin'

/**
 * Number input (tweakpane-style). With min & max it renders a compact fill
 * slider plus a number field in the control column; otherwise a scrubber field.
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

  // the track rect is read once per drag to avoid a layout read per pointermove
  let trackRect: DOMRect | null = null
  const fromPointer = (clientX: number) => {
    const rect = (trackRect ??= track.getBoundingClientRect())
    return constrain(mapRange(clientX, rect.left, rect.right, min, max))
  }
  ctx.onDispose(
    draggable(track, {
      onStart: (e) => {
        trackRect = track.getBoundingClientRect()
        value.set(fromPointer(e.clientX), { source: 'ui', last: false })
      },
      onMove: (s) => value.set(fromPointer(s.x), { source: 'ui', last: false }),
      onEnd: (s) => value.set(fromPointer(s.x), { source: 'ui', last: true }),
    }),
  )

  // keyboard support on the track
  track.tabIndex = 0
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const delta = step ?? (max - min) / 100
    value.set(constrain(value.get() + dir * delta), { source: 'ui', last: true })
  }
  track.addEventListener('keydown', onKeyDown)
  ctx.onDispose(() => track.removeEventListener('keydown', onKeyDown))

  return { element: el, activate: scrub.activate }
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
  return { element: scrub.element, activate: scrub.activate }
}
