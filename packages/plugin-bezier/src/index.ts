import { clamp, createPopup, draggable, h, registerPlugin, type InputPlugin } from '@tiao/core'

export type BezierValue = [number, number, number, number]

function isBezier(v: unknown): v is BezierValue {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')
}

const SVG_NS = 'http://www.w3.org/2000/svg'
// y range extends beyond [0,1] so overshoot curves stay visible
const Y_MIN = -0.25
const Y_MAX = 1.25

const toX = (x: number) => x * 100
const toY = (y: number) => (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * 100

/**
 * Cubic-bezier easing editor (tweakpane-essentials style): a row with a curve
 * preview and text field, expanding to a square editor popup. Usage:
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

    const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: SVGElement) => {
      const node = doc.createElementNS(SVG_NS, tag)
      node.setAttribute('class', cls)
      parent.append(node)
      return node
    }

    // --- row: preview button + comma-separated values ---
    const previewSvg = doc.createElementNS(SVG_NS, 'svg')
    previewSvg.setAttribute('viewBox', '0 0 24 24')
    previewSvg.setAttribute('class', 'tiao-bezier-preview-svg')
    const previewCurve = el('path', 'tiao-bezier-preview-curve', previewSvg)

    const previewButton = h('button', 'tiao-bezier-preview', previewSvg)
    previewButton.type = 'button'
    previewButton.title = 'Open bezier editor'
    const textInput = h('input', 'tiao-text-input tiao-bezier-text')
    textInput.type = 'text'
    textInput.spellcheck = false
    const root = h('div', 'tiao-bezier', previewButton, textInput)

    // --- popup: square editor ---
    const editorSvg = doc.createElementNS(SVG_NS, 'svg')
    editorSvg.setAttribute('viewBox', '0 0 100 100')
    editorSvg.setAttribute('class', 'tiao-bezier-svg')
    editorSvg.setAttribute('preserveAspectRatio', 'none')

    // unit box with quarter grid; overshoot margin stays on the popup bg
    const unitBox = el('rect', 'tiao-bezier-unit', editorSvg)
    unitBox.setAttribute('x', '0')
    unitBox.setAttribute('width', '100')
    unitBox.setAttribute('y', String(toY(1)))
    unitBox.setAttribute('height', String(toY(0) - toY(1)))
    for (let i = 1; i < 4; i++) {
      const gx = el('line', 'tiao-bezier-guide', editorSvg)
      gx.setAttribute('x1', String(toX(i / 4)))
      gx.setAttribute('x2', String(toX(i / 4)))
      gx.setAttribute('y1', String(toY(0)))
      gx.setAttribute('y2', String(toY(1)))
      const gy = el('line', 'tiao-bezier-guide', editorSvg)
      gy.setAttribute('x1', '0')
      gy.setAttribute('x2', '100')
      gy.setAttribute('y1', String(toY(i / 4)))
      gy.setAttribute('y2', String(toY(i / 4)))
    }

    const curve = el('path', 'tiao-bezier-curve', editorSvg)
    const arm1 = el('line', 'tiao-bezier-arm', editorSvg)
    const arm2 = el('line', 'tiao-bezier-arm', editorSvg)
    const end1 = el('circle', 'tiao-bezier-end', editorSvg)
    end1.setAttribute('r', '1.5')
    end1.setAttribute('cx', String(toX(0)))
    end1.setAttribute('cy', String(toY(0)))
    const end2 = el('circle', 'tiao-bezier-end', editorSvg)
    end2.setAttribute('r', '1.5')
    end2.setAttribute('cx', String(toX(1)))
    end2.setAttribute('cy', String(toY(1)))
    const handle1 = el('circle', 'tiao-bezier-handle', editorSvg)
    handle1.setAttribute('r', '2.5')
    const handle2 = el('circle', 'tiao-bezier-handle', editorSvg)
    handle2.setAttribute('r', '2.5')

    const editor = h('div', 'tiao-bezier-editor', editorSvg)
    const popup = createPopup(root, editor, ctx.onDispose)
    const onPreviewClick = () => popup.toggle()
    previewButton.addEventListener('click', onPreviewClick)
    ctx.onDispose(() => previewButton.removeEventListener('click', onPreviewClick))

    const render = (v: BezierValue) => {
      const [x1, y1, x2, y2] = v
      curve.setAttribute(
        'd',
        `M ${toX(0)} ${toY(0)} C ${toX(x1)} ${toY(y1)}, ${toX(x2)} ${toY(y2)}, ${toX(1)} ${toY(1)}`,
      )
      arm1.setAttribute('x1', String(toX(0)))
      arm1.setAttribute('y1', String(toY(0)))
      arm1.setAttribute('x2', String(toX(x1)))
      arm1.setAttribute('y2', String(toY(y1)))
      arm2.setAttribute('x1', String(toX(1)))
      arm2.setAttribute('y1', String(toY(1)))
      arm2.setAttribute('x2', String(toX(x2)))
      arm2.setAttribute('y2', String(toY(y2)))
      handle1.setAttribute('cx', String(toX(x1)))
      handle1.setAttribute('cy', String(toY(y1)))
      handle2.setAttribute('cx', String(toX(x2)))
      handle2.setAttribute('cy', String(toY(y2)))

      // preview curve in a 24x24 box with 4px padding, y-flipped
      const px = (x: number) => 4 + x * 16
      const py = (y: number) => 20 - y * 16
      previewCurve.setAttribute(
        'd',
        `M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`,
      )
      if (doc.activeElement !== textInput) {
        textInput.value = v.map((n) => round2(n)).join(', ')
      }
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    // text entry: four comma-separated numbers
    const commitText = () => {
      const nums = textInput.value.split(',').map((s) => Number(s.trim()))
      if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
        const [x1, y1, x2, y2] = nums as BezierValue
        ctx.value.set(
          [clamp(x1, 0, 1), clamp(y1, Y_MIN, Y_MAX), clamp(x2, 0, 1), clamp(y2, Y_MIN, Y_MAX)],
          { source: 'ui', last: true },
        )
      } else {
        render(ctx.value.get())
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

    // one drag surface: grab whichever handle is closer
    const applyDrag = (index: 0 | 1, clientX: number, clientY: number, last: boolean) => {
      const rect = editorSvg.getBoundingClientRect()
      const x = clamp((clientX - rect.left) / rect.width, 0, 1)
      const y = Y_MAX - ((clientY - rect.top) / rect.height) * (Y_MAX - Y_MIN)
      const next = [...ctx.value.get()] as BezierValue
      next[index * 2] = round2(x)
      next[index * 2 + 1] = round2(clamp(y, Y_MIN, Y_MAX))
      ctx.value.set(next, { source: 'ui', last })
    }
    let active: 0 | 1 = 0
    ctx.onDispose(
      draggable(editorSvg as unknown as HTMLElement, {
        onStart: (e) => {
          const rect = editorSvg.getBoundingClientRect()
          const px = (e.clientX - rect.left) / rect.width
          const py = Y_MAX - ((e.clientY - rect.top) / rect.height) * (Y_MAX - Y_MIN)
          const [x1, y1, x2, y2] = ctx.value.get()
          active = Math.hypot(px - x1, py - y1) <= Math.hypot(px - x2, py - y2) ? 0 : 1
          applyDrag(active, e.clientX, e.clientY, false)
        },
        onMove: (s) => applyDrag(active, s.x, s.y, false),
        onEnd: (s) => applyDrag(active, s.x, s.y, true),
      }),
    )

    return { element: root }
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
  background: var(--tiao-surface);
  color: var(--tiao-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease;
}
.tiao-bezier-preview:hover {
  background: var(--tiao-surface-hover);
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
.tiao-bezier-svg {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--tiao-radius-sm);
  cursor: crosshair;
  touch-action: none;
  display: block;
  overflow: visible;
}
.tiao-bezier-unit {
  fill: var(--tiao-surface);
}
.tiao-bezier-guide {
  stroke: var(--tiao-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.tiao-bezier-curve {
  fill: none;
  stroke: var(--tiao-fg);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.tiao-bezier-arm {
  stroke: var(--tiao-fg-dim);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.tiao-bezier-end {
  fill: var(--tiao-fg-dim);
}
.tiao-bezier-handle {
  fill: var(--tiao-accent);
  stroke: var(--tiao-bg);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
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
