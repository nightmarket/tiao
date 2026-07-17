import { h, icon, startDrag } from '../dom'
import { clamp, formatNumber, isRecord, mapRange, snap } from '../util'
import { createStickyOverlay } from './popup'
import { createComponentScrubber, createOverlayTooltip } from './scrubber'
import type { BindingOptions, InputPlugin, PluginContext } from '../plugin'

const AXES = ['x', 'y', 'z', 'w'] as const
type Axis = (typeof AXES)[number]

type PointValue = Record<string, number>

interface AxisOptions {
  min?: number
  max?: number
  step?: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const PAD_SIZE = 136
/** default display / snap precision for point axes when no step is set */
const DEFAULT_POINT_STEP = 0.01

function resolveAxisStep(axisOpts: AxisOptions, bindingStep: unknown): number {
  if (typeof axisOpts.step === 'number') return axisOpts.step
  if (typeof bindingStep === 'number') return bindingStep
  return DEFAULT_POINT_STEP
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
 * control column; 2d points get a picker button that opens an XY pad overlay.
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

    const scrubs = axes.map((axis) => {
      const axisOpts = (ctx.options[axis] as AxisOptions | undefined) ?? {}
      const scrubOpts: AxisOptions = {
        ...axisOpts,
        step: resolveAxisStep(axisOpts, ctx.options.step),
      }
      const scrub = createComponentScrubber(
        ctx.value,
        () => ctx.value.get()[axis] ?? 0,
        (v, last) => setAxis(axis, v, last),
        scrubOpts,
        ctx.onDispose,
      )
      scrub.element.title = axis
      fields.append(scrub.element)
      return scrub
    })

    if (axes.length === 2) {
      const toggle = h('button', 'tiao-point-pad-toggle', icon('plus'))
      toggle.type = 'button'
      toggle.title = 'Open XY pad'
      root.append(toggle, fields)
      const pad = createPadOverlay(ctx, ctx.options, toggle, root)
      return {
        element: root,
        activate: () => pad.openSticky(),
        beginScrub: (ev) => scrubs[0]?.beginScrub(ev),
      }
    }
    root.append(fields)
    return {
      element: root,
      beginScrub: (ev) => scrubs[0]?.beginScrub(ev),
    }
  },
}

function createPadOverlay(
  ctx: PluginContext<PointValue>,
  options: BindingOptions,
  toggle: HTMLElement,
  root: HTMLElement,
): { openSticky: (pointer?: { x: number; y: number }) => void } {
  const xOpts = (options['x'] as AxisOptions | undefined) ?? {}
  const yOpts = (options['y'] as AxisOptions | undefined) ?? {}
  const xStep = resolveAxisStep(xOpts, options.step)
  const yStep = resolveAxisStep(yOpts, options.step)
  const current = ctx.value.get()
  const xMin = xOpts.min ?? Math.min(-1, (current['x'] ?? 0) * 2)
  const xMax = xOpts.max ?? Math.max(1, (current['x'] ?? 0) * 2)
  const yMin = yOpts.min ?? Math.min(-1, (current['y'] ?? 0) * 2)
  const yMax = yOpts.max ?? Math.max(1, (current['y'] ?? 0) * 2)

  const thumb = h('div', 'tiao-thumb')
  // axis lines through value zero (center for symmetric ranges)
  const axisX = h('div', 'tiao-pad-axis tiao-pad-axis-x', h('span', 'tiao-pad-axis-label', 'x'))
  const axisY = h('div', 'tiao-pad-axis tiao-pad-axis-y', h('span', 'tiao-pad-axis-label', 'y'))
  const originLeft = clamp(mapRange(0, xMin, xMax, 0, 100), 0, 100)
  const originTop = clamp(mapRange(0, yMin, yMax, 100, 0), 0, 100)
  axisX.style.top = `${originTop}%`
  axisY.style.left = `${originLeft}%`

  // dotted accent line from origin → thumb (same stroke language as scrub guide)
  const doc = ctx.document
  const ray = doc.createElementNS(SVG_NS, 'line')
  ray.setAttribute('class', 'tiao-point-pad-ray')
  ray.setAttribute('x1', `${originLeft}%`)
  ray.setAttribute('y1', `${originTop}%`)
  const raySvg = doc.createElementNS(SVG_NS, 'svg')
  raySvg.setAttribute('class', 'tiao-point-pad-ray-svg')
  raySvg.setAttribute('aria-hidden', 'true')
  raySvg.append(ray)

  const area = h('div', 'tiao-point-pad', axisX, axisY, raySvg, thumb)
  area.style.width = `${PAD_SIZE}px`
  area.style.height = `${PAD_SIZE}px`
  const overlay = h('div', 'tiao-scrub-overlay tiao-point-overlay', area)
  area.style.transform = 'translate(-50%, -50%)'
  const tooltip = createOverlayTooltip(overlay)

  const formatPoint = (v: PointValue) =>
    `${formatNumber(v['x'] ?? 0, xStep)}, ${formatNumber(v['y'] ?? 0, yStep)}`

  const render = (v: PointValue) => {
    const left = clamp(mapRange(v['x'] ?? 0, xMin, xMax, 0, 100), 0, 100)
    const top = clamp(mapRange(v['y'] ?? 0, yMin, yMax, 100, 0), 0, 100)
    thumb.style.left = `${left}%`
    thumb.style.top = `${top}%`
    ray.setAttribute('x2', `${left}%`)
    ray.setAttribute('y2', `${top}%`)
  }
  render(ctx.value.get())
  ctx.onDispose(ctx.value.subscribe(render))

  // pad rect in screen space, rebuilt whenever the overlay is (re)centered
  let rect = { left: 0, right: 0, top: 0, bottom: 0 }
  let originX = 0
  let originY = 0

  const centerOnToggle = () => {
    const r = toggle.getBoundingClientRect()
    originX = r.left + r.width / 2
    originY = r.top + r.height / 2
    overlay.style.left = `${originX}px`
    overlay.style.top = `${originY}px`
    // virtual pad centered on the plus icon
    const half = PAD_SIZE / 2
    rect = {
      left: originX - half,
      right: originX + half,
      top: originY - half,
      bottom: originY + half,
    }
  }

  const apply = (clientX: number, clientY: number, last: boolean) => {
    const x = clamp(snap(mapRange(clientX, rect.left, rect.right, xMin, xMax), xStep), xMin, xMax)
    const y = clamp(snap(mapRange(clientY, rect.bottom, rect.top, yMin, yMax), yStep), yMin, yMax)
    const next = { ...ctx.value.get(), x, y }
    ctx.value.set(next, { source: 'ui', last })
    tooltip.place(originX, originY, clientX, clientY, formatPoint(next))
  }

  // click → sticky hover-follow; long-press → drag and commit on release
  const pad = createStickyOverlay({
    document: doc,
    trigger: toggle,
    root,
    overlay,
    dragClass: 'tiao-point-dragging',
    center: centerOnToggle,
    apply,
    onLongPress: (e) => {
      pad.open({ sticky: false, follow: false })
      // don't apply at the icon center (pad origin) — wait until the pointer moves
      startDrag(e, {
        onMove: (s) => {
          if (!s.moved) return
          apply(s.x, s.y, false)
        },
        onEnd: (s) => {
          if (s.moved) apply(s.x, s.y, true)
          pad.close()
        },
      })
    },
    onOpen: () => tooltip.hide(),
    onClose: () => tooltip.hide(),
    // follow moves only — don't jump to the icon center on open
    render: () => render(ctx.value.get()),
    onDispose: ctx.onDispose,
  })

  return { openSticky: () => pad.toggleSticky() }
}
