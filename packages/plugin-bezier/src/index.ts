import {
  clamp,
  createPopup,
  createScrubber,
  draggable,
  h,
  icon,
  mapRange,
  registerPlugin,
  Value,
  type InputPlugin,
} from '@tiao/core'

export type BezierValue = [number, number, number, number]

function isBezier(v: unknown): v is BezierValue {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')
}

const SVG_NS = 'http://www.w3.org/2000/svg'

// visible y range: the graph keeps a 25% vertical margin above and below the
// unit box so overshoot curves stay visible (matches tweakpane-essentials)
const Y_MIN = -0.5
const Y_MAX = 1.5

const PREVIEW_TICKS = 24
const PREVIEW_DELAY = 400
const PREVIEW_DURATION = 1000

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** point on the cubic bezier (0,0)-(x1,y1)-(x2,y2)-(1,1) at parameter t */
function curvePoint(v: BezierValue, t: number): [number, number] {
  const [x1, y1, x2, y2] = v
  const x01 = lerp(0, x1, t)
  const y01 = lerp(0, y1, t)
  const x12 = lerp(x1, x2, t)
  const y12 = lerp(y1, y2, t)
  const x23 = lerp(x2, 1, t)
  const y23 = lerp(y2, 1, t)
  return [
    lerp(lerp(x01, x12, t), lerp(x12, x23, t), t),
    lerp(lerp(y01, y12, t), lerp(y12, y23, t), t),
  ]
}

/** y for a given x (easing evaluation) via bisection on t */
function curveY(v: BezierValue, x: number): number {
  let dt = 0.25
  let t = 0.5
  let y = 0
  for (let i = 0; i < 20; i++) {
    const [tx, ty] = curvePoint(v, t)
    t += dt * (tx < x ? 1 : -1)
    y = ty
    dt *= 0.5
    if (Math.abs(x - tx) < 0.001) break
  }
  return y
}

/** popular preset eases: the CSS keywords plus the easings.net curves */
const PRESETS: readonly [string, BezierValue][] = [
  ['Linear', [0, 0, 1, 1]],
  ['Ease', [0.25, 0.1, 0.25, 1]],
  ['Ease In', [0.42, 0, 1, 1]],
  ['Ease Out', [0, 0, 0.58, 1]],
  ['Ease In Out', [0.42, 0, 0.58, 1]],
  ['In Sine', [0.12, 0, 0.39, 0]],
  ['Out Sine', [0.61, 1, 0.88, 1]],
  ['In Out Sine', [0.37, 0, 0.63, 1]],
  ['In Quad', [0.11, 0, 0.5, 0]],
  ['Out Quad', [0.5, 1, 0.89, 1]],
  ['In Out Quad', [0.45, 0, 0.55, 1]],
  ['In Cubic', [0.32, 0, 0.67, 0]],
  ['Out Cubic', [0.33, 1, 0.68, 1]],
  ['In Out Cubic', [0.65, 0, 0.35, 1]],
  ['In Expo', [0.7, 0, 0.84, 0]],
  ['Out Expo', [0.16, 1, 0.3, 1]],
  ['In Out Expo', [0.87, 0, 0.13, 1]],
  ['In Back', [0.36, 0, 0.66, -0.56]],
  ['Out Back', [0.34, 1.56, 0.64, 1]],
  ['In Out Back', [0.68, -0.6, 0.32, 1.6]],
]

function presetIndexOf(v: BezierValue): number {
  return PRESETS.findIndex(([, p]) => p.every((n, i) => Math.abs(n - (v[i] as number)) < 0.005))
}

/** shift-drag helper: snap the handle direction (from its endpoint) to 45deg steps */
function lockAngle(ox: number, oy: number, x: number, y: number): { x: number; y: number } {
  const d = Math.hypot(x - ox, y - oy)
  const a = Math.atan2(y - oy, x - ox)
  const la = (Math.round(a / (Math.PI / 4)) * Math.PI) / 4
  return { x: ox + Math.cos(la) * d, y: oy + Math.sin(la) * d }
}

/**
 * Cubic-bezier easing editor (tweakpane-essentials parity): a row with a curve
 * preview and text field, expanding to an editor popup with a playback strip,
 * draggable handles, and per-component number fields. Usage:
 *   registerBezierPlugin()
 *   pane.addBinding(params, 'easing', { view: 'bezier' })  // value: [x1, y1, x2, y2]
 */
export const bezierPlugin: InputPlugin<BezierValue> = {
  id: 'bezier',
  type: 'input',
  accept(value, options) {
    return options.view === 'bezier' && isBezier(value)
  },
  create(ctx) {
    ensureStyles(ctx.document)
    const doc = ctx.document

    const svgEl = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      cls: string,
      parent: Element,
    ) => {
      const node = doc.createElementNS(SVG_NS, tag)
      node.setAttribute('class', cls)
      parent.append(node)
      return node
    }

    // --- row: preview button + comma-separated values ---
    const previewSvg = doc.createElementNS(SVG_NS, 'svg')
    previewSvg.setAttribute('viewBox', '0 0 24 24')
    previewSvg.setAttribute('class', 'tiao-bezier-preview-svg')
    const previewCurve = svgEl('path', 'tiao-bezier-preview-curve', previewSvg)

    const previewButton = h('button', 'tiao-bezier-preview', previewSvg)
    previewButton.type = 'button'
    previewButton.title = 'Open bezier editor'
    const textInput = h('input', 'tiao-text-input tiao-bezier-text')
    textInput.type = 'text'
    textInput.spellcheck = false
    const root = h('div', 'tiao-bezier', previewButton, textInput)

    // --- editor: playback strip + graph (pixel-space svg + html handles) ---
    const ticksSvg = doc.createElementNS(SVG_NS, 'svg')
    ticksSvg.setAttribute('class', 'tiao-bezier-ticks')
    const ticksPath = svgEl('path', 'tiao-bezier-tick', ticksSvg)
    const marker = h('div', 'tiao-bezier-marker')
    const strip = h('div', 'tiao-bezier-strip', ticksSvg, marker)

    const graphSvg = doc.createElementNS(SVG_NS, 'svg')
    graphSvg.setAttribute('class', 'tiao-bezier-graph-svg')
    const guide = svgEl('path', 'tiao-bezier-guide', graphSvg)
    const arm1 = svgEl('line', 'tiao-bezier-arm', graphSvg)
    const arm2 = svgEl('line', 'tiao-bezier-arm', graphSvg)
    const line = svgEl('polyline', 'tiao-bezier-curve', graphSvg)
    const handles = [h('div', 'tiao-bezier-point'), h('div', 'tiao-bezier-point')] as const
    const graph = h('div', 'tiao-bezier-graph', strip, graphSvg, handles[0], handles[1])
    graph.tabIndex = 0

    let selected: 0 | 1 = 0
    const applySelection = () => {
      handles[0].classList.toggle('tiao-selected', selected === 0)
      handles[1].classList.toggle('tiao-selected', selected === 1)
    }
    applySelection()

    // --- editor: per-component number fields under the graph ---
    const fields = h('div', 'tiao-bezier-fields')
    const axisValues: Value<number>[] = []
    for (let i = 0; i < 4; i++) {
      const isX = i % 2 === 0
      const axisValue = new Value(ctx.value.get()[i] as number)
      axisValues.push(axisValue)
      const scrub = createScrubber(
        axisValue,
        () => ctx.value.get()[i] as number,
        (v, last) => {
          const next = [...ctx.value.get()] as BezierValue
          next[i] = v
          ctx.value.set(next, { source: 'ui', last })
        },
        isX ? { min: 0, max: 1, step: 0.01 } : { step: 0.01 },
      )
      scrub.element.title = `${isX ? 'x' : 'y'}${i < 2 ? 1 : 2}`
      ctx.onDispose(scrub.dispose)
      fields.append(scrub.element)
    }

    // --- editor: preset dropdown ("Custom" + popular eases) ---
    const presetSelect = h('select', 'tiao-select')
    const customOption = doc.createElement('option')
    customOption.value = ''
    customOption.textContent = 'Custom'
    presetSelect.append(customOption)
    PRESETS.forEach(([name], i) => {
      const opt = doc.createElement('option')
      opt.value = String(i)
      opt.textContent = name
      presetSelect.append(opt)
    })
    const presetWrap = h('div', 'tiao-select-wrap tiao-bezier-presets', presetSelect, icon('chevron'))
    const onPresetChange = () => {
      const preset = PRESETS[Number(presetSelect.value)]
      if (preset) ctx.value.set([...preset[1]], { source: 'ui', last: true })
    }
    presetSelect.addEventListener('change', onPresetChange)
    ctx.onDispose(() => presetSelect.removeEventListener('change', onPresetChange))

    const editor = h('div', 'tiao-bezier-editor', graph, presetWrap, fields)
    const popup = createPopup(root, editor, ctx.onDispose)

    // --- coordinate mapping (pixel space, 25% vertical margins) ---
    const size = () => ({ w: graph.clientWidth, h: graph.clientHeight })
    const valueToPos = (x: number, y: number) => {
      const { w, h: gh } = size()
      const vm = gh * 0.25
      return { x: mapRange(x, 0, 1, 0, w), y: mapRange(y, 0, 1, gh - vm, vm) }
    }
    const posToValue = (px: number, py: number) => {
      const { w, h: gh } = size()
      const vm = gh * 0.25
      return {
        x: clamp(w === 0 ? 0 : px / w, 0, 1),
        y: clamp(mapRange(py, gh - vm, vm, 0, 1), Y_MIN, Y_MAX),
      }
    }

    // --- playback preview (tweakpane behavior: replay on every change) ---
    let playing = false
    let startTime = -1
    const updateMarker = (progress: number) => {
      marker.style.left = `${curveY(ctx.value.get(), clamp(progress, 0, 1)) * 100}%`
    }
    const onTimer = () => {
      const dt = Date.now() - startTime
      updateMarker(dt / PREVIEW_DURATION)
      if (dt > PREVIEW_DURATION + PREVIEW_DELAY) stopPlayback()
      if (playing) requestAnimationFrame(onTimer)
    }
    const stopPlayback = () => {
      playing = false
      marker.classList.remove('tiao-active')
    }
    const play = () => {
      stopPlayback()
      if (!popup.isOpen()) return
      updateMarker(0)
      marker.classList.add('tiao-active')
      startTime = Date.now() + PREVIEW_DELAY
      playing = true
      requestAnimationFrame(onTimer)
    }
    ctx.onDispose(stopPlayback)
    const onStripDown = (e: PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      play()
    }
    strip.addEventListener('pointerdown', onStripDown)
    ctx.onDispose(() => strip.removeEventListener('pointerdown', onStripDown))

    // --- rendering ---
    const refresh = () => {
      const v = ctx.value.get()
      const [x1, y1, x2, y2] = v
      const { w, h: gh } = size()
      if (w > 0) {
        graphSvg.setAttribute('viewBox', `0 0 ${w} ${gh}`)

        // guides at y=0 and y=1
        guide.setAttribute(
          'd',
          [0, 1]
            .map((y) => {
              const p1 = valueToPos(0, y)
              const p2 = valueToPos(1, y)
              return `M ${p1.x},${p1.y} L ${p2.x},${p2.y}`
            })
            .join(' '),
        )

        const points: string[] = []
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const [cx, cy] = curvePoint(v, Math.min(t, 1))
          const p = valueToPos(cx, cy)
          points.push(`${p.x},${p.y}`)
        }
        line.setAttribute('points', points.join(' '))

        for (const index of [0, 1] as const) {
          const from = valueToPos(index, index)
          const to = valueToPos(v[index * 2] as number, v[index * 2 + 1] as number)
          const arm = index === 0 ? arm1 : arm2
          arm.setAttribute('x1', String(from.x))
          arm.setAttribute('y1', String(from.y))
          arm.setAttribute('x2', String(to.x))
          arm.setAttribute('y2', String(to.y))
          const handle = handles[index]
          handle.style.left = `${to.x}px`
          handle.style.top = `${to.y}px`
        }

        // playback strip ticks, spaced by the eased value
        const tw = ticksSvg.clientWidth
        const th = ticksSvg.clientHeight
        const ds: string[] = []
        for (let i = 0; i < PREVIEW_TICKS; i++) {
          const x = curveY(v, i / (PREVIEW_TICKS - 1)) * tw
          ds.push(`M ${x},0 v${th}`)
        }
        ticksPath.setAttribute('d', ds.join(' '))
      }

      // row preview curve in a 24x24 box with 4px padding, y-flipped
      const px = (x: number) => 4 + x * 16
      const py = (y: number) => 20 - y * 16
      previewCurve.setAttribute(
        'd',
        `M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`,
      )
      if (doc.activeElement !== textInput) {
        textInput.value = v.map((n) => round2(n)).join(', ')
      }

      const presetIndex = presetIndexOf(v)
      presetSelect.value = presetIndex >= 0 ? String(presetIndex) : ''
    }

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null
    ro?.observe(graph)
    ctx.onDispose(() => ro?.disconnect())

    refresh()
    ctx.onDispose(
      ctx.value.subscribe((v) => {
        axisValues.forEach((av, i) => av.set(v[i] as number))
        refresh()
        play()
      }),
    )

    const onPreviewClick = () => {
      popup.toggle()
      if (popup.isOpen()) {
        refresh()
        play()
      }
    }
    previewButton.addEventListener('click', onPreviewClick)
    ctx.onDispose(() => previewButton.removeEventListener('click', onPreviewClick))

    // --- row text entry: four comma-separated numbers ---
    const commitText = () => {
      const nums = textInput.value.split(',').map((s) => Number(s.trim()))
      if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
        const [x1, y1, x2, y2] = nums as BezierValue
        ctx.value.set([clamp(x1, 0, 1), y1, clamp(x2, 0, 1), y2], { source: 'ui', last: true })
      } else {
        refresh()
      }
    }
    const onTextKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') textInput.blur()
    }
    textInput.addEventListener('blur', commitText)
    textInput.addEventListener('keydown', onTextKey)
    ctx.onDispose(() => {
      textInput.removeEventListener('blur', commitText)
      textInput.removeEventListener('keydown', onTextKey)
    })

    // --- graph drag: grab whichever handle is closer; shift locks 45deg angles ---
    const applyDrag = (clientX: number, clientY: number, shift: boolean, last: boolean) => {
      const rect = graph.getBoundingClientRect()
      const vp = posToValue(clientX - rect.left, clientY - rect.top)
      // angle-locking pivots on the handle's own endpoint: (0,0) or (1,1)
      const p = shift ? lockAngle(selected, selected, vp.x, vp.y) : vp
      const next = [...ctx.value.get()] as BezierValue
      next[selected * 2] = round2(clamp(p.x, 0, 1))
      next[selected * 2 + 1] = round2(clamp(p.y, Y_MIN, Y_MAX))
      ctx.value.set(next, { source: 'ui', last })
    }
    ctx.onDispose(
      draggable(graph, {
        onStart: (e) => {
          const rect = graph.getBoundingClientRect()
          const px = e.clientX - rect.left
          const py = e.clientY - rect.top
          const [x1, y1, x2, y2] = ctx.value.get()
          const p1 = valueToPos(x1, y1)
          const p2 = valueToPos(x2, y2)
          selected = Math.hypot(px - p1.x, py - p1.y) <= Math.hypot(px - p2.x, py - p2.y) ? 0 : 1
          applySelection()
          graph.focus()
          applyDrag(e.clientX, e.clientY, e.shiftKey, false)
        },
        onMove: (s, e) => applyDrag(s.x, s.y, e.shiftKey, false),
        onEnd: (s, e) => applyDrag(s.x, s.y, e.shiftKey, true),
      }),
    )

    // --- keyboard: arrows nudge the selected handle (shift x10, alt /10) ---
    const onGraphKey = (e: KeyboardEvent) => {
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      const dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
      if (dx === 0 && dy === 0) return
      e.preventDefault()
      const step = 0.01 * (e.shiftKey ? 10 : 1) * (e.altKey ? 0.1 : 1)
      const next = [...ctx.value.get()] as BezierValue
      next[selected * 2] = round2(clamp((next[selected * 2] as number) + dx * step, 0, 1))
      next[selected * 2 + 1] = round2(
        clamp((next[selected * 2 + 1] as number) + dy * step, Y_MIN, Y_MAX),
      )
      ctx.value.set(next, { source: 'ui', last: true })
    }
    graph.addEventListener('keydown', onGraphKey)
    ctx.onDispose(() => graph.removeEventListener('keydown', onGraphKey))

    // clicking the row label opens the editor (same as the preview button)
    return { element: root, activate: onPreviewClick }
  },
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const CSS = `
.tiao-bezier {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
}
.tiao-bezier-preview {
  width: 24px;
  height: var(--tiao-row-height);
  flex: none;
  border-radius: var(--tiao-radius-sm);
  /* inverted by default: prominent gray chip (like the slider fill) */
  background: var(--tiao-fill);
  color: var(--tiao-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease;
}
.tiao-bezier-preview:hover {
  background: var(--tiao-hover-strong);
}
/* hovering anywhere on the row draws the mini curve in accent */
.tiao-row:hover .tiao-bezier-preview {
  color: var(--tiao-accent);
}
.tiao-bezier-preview-svg {
  width: 18px;
  height: 18px;
}
.tiao-bezier-preview-curve {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
.tiao-bezier-text {
  flex: 1;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.tiao-bezier-editor {
  width: 224px;
}
.tiao-bezier-graph {
  position: relative;
  height: 100px;
  border-radius: var(--tiao-radius-sm);
  background: var(--tiao-surface);
  overflow: hidden;
  cursor: pointer;
  touch-action: none;
}
.tiao-bezier-graph:focus-visible {
  outline: 1.5px solid var(--tiao-accent);
  outline-offset: 1px;
}
.tiao-bezier-graph-svg {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.tiao-bezier-guide {
  fill: none;
  stroke: var(--tiao-fg);
  stroke-dasharray: 1;
  opacity: 0.1;
}
.tiao-bezier-curve {
  fill: none;
  stroke: var(--tiao-fg);
  stroke-width: 1.5;
}
.tiao-bezier-arm {
  stroke: var(--tiao-fg);
  stroke-dasharray: 1;
  opacity: 0.5;
}
/* small circular handles, tweakpane-sized; the whole graph is the drag surface */
.tiao-bezier-point {
  position: absolute;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border: 1px solid var(--tiao-fg);
  border-radius: 50%;
  pointer-events: none;
}
.tiao-bezier-point.tiao-selected {
  background: var(--tiao-accent);
  border-color: var(--tiao-accent);
}
/* playback strip: eased tick marks + a marker dot that replays on change */
.tiao-bezier-strip {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 0;
  /* border-box: 4px of tick height plus 4px padding above and below */
  height: 12px;
  padding: 4px 0;
  cursor: pointer;
  z-index: 1;
}
.tiao-bezier-ticks {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.tiao-bezier-tick {
  stroke: var(--tiao-fg-dim);
  opacity: 0.5;
}
.tiao-bezier-marker {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: var(--tiao-fg);
  opacity: 0;
  transition: opacity 0.2s ease-out;
}
.tiao-bezier-marker.tiao-active {
  opacity: 1;
}
.tiao-bezier-presets {
  margin-top: 6px;
}
.tiao-bezier-fields {
  display: flex;
  gap: 2px;
  margin-top: 6px;
}
.tiao-bezier-fields .tiao-scrub {
  flex: 1;
  min-width: 0;
}
`

function ensureStyles(doc: Document): void {
  if (doc.querySelector('style[data-tiao-bezier]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-tiao-bezier', '')
  style.textContent = CSS
  doc.head.append(style)
}

let registered = false

export function registerBezierPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(bezierPlugin)
}
