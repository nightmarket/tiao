import { h, icon, longPress, setRowActive, startDrag } from '../dom'
import { clamp, isRecord, mapRange } from '../util'
import { bindOverlayPointerGuard, onPaneScroll } from './popup'
import { applyOverlayTheme, createScrubber } from './scrubber'
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

const SVG_NS = 'http://www.w3.org/2000/svg'
const PAD_SIZE = 136

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

  let open = false
  let sticky = false
  let hovering = false
  let originX = 0
  let originY = 0
  let stopScrollWatch: (() => void) | null = null
  // pad rect in screen space, rebuilt whenever the overlay is (re)centered
  let rect: DOMRect

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
      width: PAD_SIZE,
      height: PAD_SIZE,
      x: originX - half,
      y: originY - half,
      toJSON: () => ({}),
    } as DOMRect
  }

  const apply = (clientX: number, clientY: number, last: boolean) => {
    const x = clamp(mapRange(clientX, rect.left, rect.right, xMin, xMax), xMin, xMax)
    const y = clamp(mapRange(clientY, rect.bottom, rect.top, yMin, yMax), yMin, yMax)
    ctx.value.set({ ...ctx.value.get(), x, y }, { source: 'ui', last })
  }

  const stopHoverFollow = () => {
    if (!hovering) return
    hovering = false
    doc.removeEventListener('pointermove', onHoverMove, true)
  }

  const onHoverMove = (e: PointerEvent) => {
    if (!sticky || !hovering) return
    apply(e.clientX, e.clientY, false)
  }

  const startHoverFollow = () => {
    stopHoverFollow()
    hovering = true
    doc.addEventListener('pointermove', onHoverMove, true)
  }

  let stopPointerGuard: (() => void) | null = null

  const closeOverlay = () => {
    if (!open) return
    open = false
    sticky = false
    stopHoverFollow()
    stopScrollWatch?.()
    stopScrollWatch = null
    stopPointerGuard?.()
    stopPointerGuard = null
    overlay.remove()
    root.classList.remove('tiao-point-dragging')
    setRowActive(root, false)
  }

  const openOverlay = (mode: 'sticky') => {
    applyOverlayTheme(overlay, toggle)
    if (!open) {
      doc.body.append(overlay)
      root.classList.add('tiao-point-dragging')
      setRowActive(root, true)
      open = true
      stopScrollWatch?.()
      stopScrollWatch = onPaneScroll(toggle, closeOverlay)
      stopPointerGuard?.()
      stopPointerGuard = bindOverlayPointerGuard(doc, {
        isOpen: () => open,
        allow: (t) => toggle.contains(t),
        onPointerDown: (e) => {
          if (!sticky) return
          centerOnToggle()
          apply(e.clientX, e.clientY, true)
          closeOverlay()
        },
        onKeyDown: (e) => {
          if (e.key === 'Escape') closeOverlay()
        },
      })
    }
    sticky = mode === 'sticky'
    centerOnToggle()
    // follow moves only — don't jump to the icon center on open
    startHoverFollow()
    render(ctx.value.get())
  }

  const openSticky = () => {
    if (open && sticky) {
      closeOverlay()
      return
    }
    openOverlay('sticky')
  }

  // click / long-press both open the overlay editor; long-press keeps adjusting
  // while the pointer stays down, then resumes hover-follow on release
  let suppressClick = false
  ctx.onDispose(
    longPress(toggle, {
      onLongPress: (e) => {
        suppressClick = true
        e.preventDefault()
        openSticky()
        stopHoverFollow()
        centerOnToggle()
        // don't apply at the icon center (pad origin) — wait until the pointer moves
        startDrag(e, {
          onMove: (s) => {
            if (!s.moved) return
            apply(s.x, s.y, false)
          },
          onEnd: (s) => {
            if (s.moved) apply(s.x, s.y, true)
            if (open && sticky) startHoverFollow()
          },
        })
      },
    }),
  )
  const onToggleClick = () => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    openSticky()
  }
  toggle.addEventListener('click', onToggleClick)
  ctx.onDispose(() => toggle.removeEventListener('click', onToggleClick))
  ctx.onDispose(closeOverlay)

  return { openSticky }
}
