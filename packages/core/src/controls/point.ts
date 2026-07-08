import { draggable, h, icon } from '../dom'
import { clamp, isRecord, mapRange } from '../util'
import { createPopup } from './popup'
import { createScrubber } from './scrubber'
import { Value } from '../value'
import type { BindingOptions, InputPlugin, PluginContext } from '../plugin'

const AXES = ['x', 'y', 'z', 'w'] as const
type Axis = (typeof AXES)[number]

type PointValue = Record<string, number>

interface AxisOptions {
  min?: number
  max?: number
  step?: number
}

function pointAxes(value: unknown): Axis[] | null {
  if (!isRecord(value)) return null
  const axes = AXES.filter((a) => a in value)
  if (axes.length < 2) return null
  // every present axis must be a number, and no foreign keys allowed
  if (!axes.every((a) => typeof value[a] === 'number')) return null
  if (Object.keys(value).length !== axes.length) return null
  return axes
}

/**
 * point2d/3d/4d input, tweakpane-style: compact scrubber fields in the
 * control column; 2d points get a picker button that opens an XY pad popup.
 */
export const pointInputPlugin: InputPlugin<PointValue> = {
  id: 'point',
  type: 'input',
  accept(value) {
    return pointAxes(value) !== null
  },
  create(ctx) {
    const axes = pointAxes(ctx.value.get()) ?? []
    const root = h('div', 'tiao-point')
    const fields = h('div', 'tiao-point-fields')

    const setAxis = (axis: Axis, v: number, last: boolean) => {
      // new object so downstream equality checks see the change
      ctx.value.set({ ...ctx.value.get(), [axis]: v }, { source: 'ui', last })
    }

    for (const axis of axes) {
      const axisOpts = (ctx.options[axis] as AxisOptions | undefined) ?? {}
      const scrubOpts: AxisOptions = { ...axisOpts }
      if (scrubOpts.step === undefined && typeof ctx.options.step === 'number') {
        scrubOpts.step = ctx.options.step
      }
      const axisValue = new Value(ctx.value.get()[axis] ?? 0)
      ctx.onDispose(
        ctx.value.subscribe((v) => {
          axisValue.set(v[axis] ?? 0)
        }),
      )
      const scrub = createScrubber(
        axisValue,
        () => ctx.value.get()[axis] ?? 0,
        (v, last) => setAxis(axis, v, last),
        scrubOpts,
      )
      scrub.element.title = axis
      ctx.onDispose(scrub.dispose)
      fields.append(scrub.element)
    }

    if (axes.length === 2) {
      const toggle = h('button', 'tiao-point-pad-toggle', icon('plus'))
      toggle.type = 'button'
      toggle.title = 'Open XY pad'
      const pad = createPadPopup(ctx, ctx.options)
      root.append(toggle, fields, pad.element)
      const popup = createPopup(root, pad.element, ctx.onDispose)
      const onClick = () => popup.toggle()
      toggle.addEventListener('click', onClick)
      ctx.onDispose(() => toggle.removeEventListener('click', onClick))
      // clicking the row label opens the pad editor
      return { element: root, activate: () => popup.toggle() }
    }
    root.append(fields)
    return { element: root }
  },
}

function createPadPopup(ctx: PluginContext<PointValue>, options: BindingOptions) {
  const xOpts = (options['x'] as AxisOptions | undefined) ?? {}
  const yOpts = (options['y'] as AxisOptions | undefined) ?? {}
  const current = ctx.value.get()
  const xMin = xOpts.min ?? Math.min(-1, (current['x'] ?? 0) * 2)
  const xMax = xOpts.max ?? Math.max(1, (current['x'] ?? 0) * 2)
  const yMin = yOpts.min ?? Math.min(-1, (current['y'] ?? 0) * 2)
  const yMax = yOpts.max ?? Math.max(1, (current['y'] ?? 0) * 2)

  const thumb = h('div', 'tiao-thumb')
  // axis lines through value zero (center for symmetric ranges)
  const axisX = h('div', 'tiao-pad-axis tiao-pad-axis-x', h('span', 'tiao-pad-axis-label', 'x'))
  const axisY = h('div', 'tiao-pad-axis tiao-pad-axis-y', h('span', 'tiao-pad-axis-label', 'y'))
  axisX.style.top = `${clamp(mapRange(0, yMin, yMax, 100, 0), 0, 100)}%`
  axisY.style.left = `${clamp(mapRange(0, xMin, xMax, 0, 100), 0, 100)}%`
  const area = h('div', 'tiao-point-pad', axisX, axisY, thumb)
  const element = h('div', 'tiao-point-pad-popup', area)

  const render = (v: PointValue) => {
    thumb.style.left = `${clamp(mapRange(v['x'] ?? 0, xMin, xMax, 0, 100), 0, 100)}%`
    thumb.style.top = `${clamp(mapRange(v['y'] ?? 0, yMin, yMax, 100, 0), 0, 100)}%`
  }
  render(ctx.value.get())
  ctx.onDispose(ctx.value.subscribe(render))

  const apply = (clientX: number, clientY: number, last: boolean) => {
    const rect = area.getBoundingClientRect()
    const x = clamp(mapRange(clientX, rect.left, rect.right, xMin, xMax), xMin, xMax)
    const y = clamp(mapRange(clientY, rect.bottom, rect.top, yMin, yMax), yMin, yMax)
    ctx.value.set({ ...ctx.value.get(), x, y }, { source: 'ui', last })
  }
  ctx.onDispose(
    draggable(area, {
      onStart: (e) => apply(e.clientX, e.clientY, false),
      onMove: (s) => apply(s.x, s.y, false),
      onEnd: (s) => apply(s.x, s.y, true),
    }),
  )

  return { element }
}
