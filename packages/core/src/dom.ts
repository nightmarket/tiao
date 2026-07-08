type Child = Node | string | null | undefined

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (className) el.className = className
  for (const c of children) {
    if (c == null) continue
    el.append(c)
  }
  return el
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function icon(name: 'chevron' | 'check' | 'plus' | 'triangle'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 12 12')
  svg.setAttribute('class', `tiao-icon tiao-icon-${name}`)
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  const d = {
    chevron: 'M3.5 4.5 L6 7.5 L8.5 4.5',
    check: 'M2.5 6.5 L5 9 L9.5 3.5',
    plus: 'M6 2.5 V9.5 M2.5 6 H9.5',
    // leva-style filled collapse caret, pointing down; the glyph is centered
    // in the viewBox so rotating it while collapsed keeps it optically aligned
    triangle: 'M3.2 4.25 L8.8 4.25 L6 7.75 Z',
  }[name]
  path.setAttribute('d', d)
  // the caret is a filled shape; a thin same-color stroke rounds its corners
  path.setAttribute('fill', name === 'triangle' ? 'currentColor' : 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', name === 'triangle' ? '1' : '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

/** 24px lucide-style icon shell; shapes get stroked with currentColor */
function lucideIcon(name: string, shapes: SVGElement[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', `tiao-icon tiao-icon-${name}`)
  svg.setAttribute('aria-hidden', 'true')
  for (const el of shapes) {
    el.setAttribute('fill', 'none')
    el.setAttribute('stroke', 'currentColor')
    el.setAttribute('stroke-width', '2')
    el.setAttribute('stroke-linecap', 'round')
    el.setAttribute('stroke-linejoin', 'round')
    svg.append(el)
  }
  return svg
}

function svgPath(d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  return path
}

function svgCircle(cx: number, cy: number, r: number): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', String(cx))
  circle.setAttribute('cy', String(cy))
  circle.setAttribute('r', String(r))
  return circle
}

/** Lucide "settings" gear (ISC licensed path data, embedded to stay zero-dep). */
export function gearIcon(): SVGSVGElement {
  return lucideIcon('gear', [
    svgPath(
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    ),
    svgCircle(12, 12, 3),
  ])
}

/** Lucide "search" (ISC licensed path data, embedded to stay zero-dep). */
export function searchIcon(): SVGSVGElement {
  return lucideIcon('search', [svgCircle(11, 11, 8), svgPath('m21 21-4.3-4.3')])
}

export interface DragState {
  dx: number
  dy: number
  x: number
  y: number
  moved: boolean
}

export interface DragHandlers {
  /** return false to ignore this pointerdown (e.g. on nested interactive elements) */
  filter?(ev: PointerEvent): boolean
  onStart?(ev: PointerEvent): void
  onMove?(state: DragState, ev: PointerEvent): void
  onEnd?(state: DragState, ev: PointerEvent): void
}

const MOVE_THRESHOLD = 3

/** Pointer-capture drag helper. `moved` flips once movement exceeds a threshold (click vs drag). */
export function draggable(el: HTMLElement, handlers: DragHandlers): () => void {
  let cleanupActiveDrag: (() => void) | null = null

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return
    if (handlers.filter && !handlers.filter(ev)) return
    cleanupActiveDrag?.()
    const startX = ev.clientX
    const startY = ev.clientY
    const pointerId = ev.pointerId
    const doc = el.ownerDocument
    const win = doc.defaultView
    let moved = false
    let lastEvent = ev
    let ended = false
    // capture retargets all pointer events (and the click) to `el`,
    // which is why filtered elements must bail out above
    try {
      el.setPointerCapture?.(pointerId)
    } catch {
      /* pointer capture is best-effort; document listeners below still finish the drag */
    }
    handlers.onStart?.(ev)

    const state = (e: PointerEvent): DragState => {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!moved && Math.hypot(dx, dy) > MOVE_THRESHOLD) moved = true
      return { dx, dy, x: e.clientX, y: e.clientY, moved }
    }

    const isActivePointer = (e: PointerEvent) => e.pointerId === pointerId
    const cleanup = () => {
      doc.removeEventListener('pointermove', onMove, true)
      doc.removeEventListener('pointerup', onUp, true)
      doc.removeEventListener('pointercancel', onUp, true)
      el.removeEventListener('lostpointercapture', onLostPointerCapture)
      win?.removeEventListener('blur', onWindowBlur, true)
      if (cleanupActiveDrag === cleanup) cleanupActiveDrag = null
    }
    const finish = (e: PointerEvent) => {
      if (ended) return
      ended = true
      cleanup()
      try {
        if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture?.(pointerId)
      } catch {
        /* release can fail if the browser already dropped capture */
      }
      handlers.onEnd?.(state(e), e)
    }
    const onMove = (e: PointerEvent) => {
      if (!isActivePointer(e)) return
      lastEvent = e
      handlers.onMove?.(state(e), e)
    }
    const onUp = (e: PointerEvent) => {
      if (!isActivePointer(e)) return
      finish(e)
    }
    const onLostPointerCapture = (e: PointerEvent) => {
      if (!isActivePointer(e)) return
      finish(e)
    }
    const onWindowBlur = () => finish(lastEvent)

    cleanupActiveDrag = cleanup
    doc.addEventListener('pointermove', onMove, true)
    doc.addEventListener('pointerup', onUp, true)
    doc.addEventListener('pointercancel', onUp, true)
    el.addEventListener('lostpointercapture', onLostPointerCapture)
    win?.addEventListener('blur', onWindowBlur, true)
  }
  el.addEventListener('pointerdown', onPointerDown)
  return () => {
    cleanupActiveDrag?.()
    el.removeEventListener('pointerdown', onPointerDown)
  }
}
