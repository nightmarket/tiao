type Child = Node | string | null | undefined

/**
 * Document that `h`/`icon` create elements in. Pane construction and blade
 * creation run under `withDocument(host.document, …)` so elements land in the
 * right realm for multi-document setups (PaneOptions.document). Event-time
 * creations fall back to the global document and get adopted on append.
 */
let currentDoc: Document | null = null

export function withDocument<T>(doc: Document, fn: () => T): T {
  const prev = currentDoc
  currentDoc = doc
  try {
    return fn()
  } finally {
    currentDoc = prev
  }
}

function creationDoc(): Document {
  return currentDoc ?? document
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = creationDoc().createElement(tag)
  if (className) el.className = className
  for (const c of children) {
    if (c == null) continue
    el.append(c)
  }
  return el
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function icon(name: 'chevron' | 'plus' | 'triangle' | 'check'): SVGSVGElement {
  const doc = creationDoc()
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 12 12')
  svg.setAttribute('class', `tiao-icon tiao-icon-${name}`)
  svg.setAttribute('aria-hidden', 'true')
  const path = doc.createElementNS(SVG_NS, 'path')
  const d = {
    chevron: 'M3.5 4.5 L6 7.5 L8.5 4.5',
    plus: 'M6 2.5 V9.5 M2.5 6 H9.5',
    check: 'M2.75 6.5 L5 8.75 L9.25 3.75',
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
  const svg = creationDoc().createElementNS(SVG_NS, 'svg')
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
  const path = creationDoc().createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  return path
}

function svgCircle(cx: number, cy: number, r: number): SVGCircleElement {
  const circle = creationDoc().createElementNS(SVG_NS, 'circle')
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

/** Lucide "search" magnifier. */
export function searchIcon(): SVGSVGElement {
  return lucideIcon('search', [svgCircle(11, 11, 8), svgPath('m21 21-4.3-4.3')])
}

/** Collapse a text selection without moving focus. */
export function collapseSelection(input: HTMLInputElement): void {
  const end = input.selectionEnd ?? input.value.length
  try {
    input.setSelectionRange(end, end)
  } catch {
    /* some input types reject selection */
  }
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
const LONG_PRESS_MS = 180

/**
 * At most one drag is active across the whole page. Starting a new drag (e.g.
 * clicking another slider) finishes the previous one so overlays / scrub state
 * can't stick when pointerup never reaches the old listeners.
 */
let finishActiveDrag: (() => void) | null = null
/** Monotonic id so stale document listeners from a replaced drag are no-ops. */
let dragGeneration = 0
/**
 * Event currently starting a drag. The document guard must not finish this
 * drag — capture-phase listeners can run in surprising orders across browsers
 * when both pointer and mouse compatibility events fire.
 */
let startingDragEvent: Event | null = null
const guardedDocs = new WeakSet<Document>()

/** End any in-flight drag. Safe to call when none is active. */
export function cancelActiveDrag(): void {
  finishActiveDrag?.()
}

/**
 * Mark the enclosing binding row as the sole active interaction target so its
 * hover pill stays on and other rows don't pick up :hover while dragging /
 * while an overlay is open.
 */
export function setRowActive(from: Element | null | undefined, on: boolean): void {
  const row = from instanceof Element ? from.closest('.tiao-row') : null
  if (!row) return
  row.classList.toggle('tiao-row-active', on)
}

/**
 * Hold the ew-resize cursor page-wide while scrubbing/sliding. A root class
 * (+ !important rule) rather than an inline cursor, so it also wins over
 * elements that set their own cursor — e.g. the row label (`pointer`) that a
 * long-press scrub starts from.
 */
export function setEwCursor(from: Element, on: boolean): void {
  from.ownerDocument.documentElement.classList.toggle('tiao-cursor-ew', on)
}

function ensureDragGuard(doc: Document): void {
  if (guardedDocs.has(doc)) return
  guardedDocs.add(doc)
  // any new press ends a stuck drag before element handlers start a new one
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      // same event that is (about to be / currently) starting a drag
      if (startingDragEvent === e) return
      finishActiveDrag?.()
    },
    true,
  )
}

/** Begin a drag from an existing pointerdown (or long-press) event. */
export function startDrag(ev: PointerEvent, handlers: DragHandlers): void {
  if (ev.button !== 0 && ev.type === 'pointerdown') return
  // mark before finishing the prior drag so nested/re-entrant pointerdowns
  // from onEnd side effects don't clear the drag we're about to arm
  startingDragEvent = ev
  // end any prior drag (also covers long-press, which has no fresh pointerdown)
  finishActiveDrag?.()
  const startX = ev.clientX
  const startY = ev.clientY
  const doc = (ev.target instanceof Node ? ev.target.ownerDocument : null) ?? document
  const win = doc.defaultView
  ensureDragGuard(doc)
  const generation = ++dragGeneration
  let moved = false
  let lastEvent = ev
  let ended = false
  // only treat buttons===0 as a missed pointerup after we've seen a pressed
  // move — spurious buttons:0 moves right after pointerdown were ending the
  // drag immediately (jump works, then the slider feels stuck)
  let seenPressedMove = false
  handlers.onStart?.(ev)

  const state = (e: PointerEvent): DragState => {
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!moved && Math.hypot(dx, dy) > MOVE_THRESHOLD) moved = true
    return { dx, dy, x: e.clientX, y: e.clientY, moved }
  }

  // generation gate only — don't require pointerId match. Some browsers/devices
  // retarget or renumber ids between down/move when switching controls quickly,
  // which left sliders looking "stuck" after the initial click jump.
  const isActive = () => generation === dragGeneration && !ended
  const cleanup = () => {
    doc.removeEventListener('pointermove', onMove, true)
    doc.removeEventListener('pointerup', onUp, true)
    doc.removeEventListener('pointercancel', onUp, true)
    win?.removeEventListener('blur', onWindowBlur)
  }
  const finish = (e: PointerEvent) => {
    if (ended) return
    ended = true
    if (finishActiveDrag === endActive) finishActiveDrag = null
    if (startingDragEvent === ev) startingDragEvent = null
    cleanup()
    handlers.onEnd?.(state(e), e)
  }
  const endActive = () => finish(lastEvent)
  const onMove = (e: PointerEvent) => {
    if (!isActive()) return
    if (e.buttons !== 0) seenPressedMove = true
    else if (seenPressedMove) {
      finish(e)
      return
    }
    lastEvent = e
    handlers.onMove?.(state(e), e)
  }
  const onUp = (e: PointerEvent) => {
    if (!isActive()) return
    finish(e)
  }
  // no capture: element blur events don't bubble to window, but they do pass
  // through it in the capture phase — a focus change inside the page (e.g.
  // pressing a slider track while another is focused) must not end the drag
  const onWindowBlur = () => {
    if (!isActive()) return
    finish(lastEvent)
  }

  finishActiveDrag = endActive
  doc.addEventListener('pointermove', onMove, true)
  doc.addEventListener('pointerup', onUp, true)
  doc.addEventListener('pointercancel', onUp, true)
  win?.addEventListener('blur', onWindowBlur)
  // clear the same-event guard after this turn so later presses can end us
  queueMicrotask(() => {
    if (startingDragEvent === ev) startingDragEvent = null
  })
}

/**
 * Pointer drag helper. Uses document-level move/up listeners (no pointer
 * capture): capture retargets later pointerdowns back to the first element,
 * which is what made slider tracks feel "stuck" when clicking between them.
 */
export function draggable(el: HTMLElement, handlers: DragHandlers): () => void {
  let ownedGeneration = 0
  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return
    if (handlers.filter && !handlers.filter(ev)) return
    const wrapped: DragHandlers = {
      onStart: (e) => {
        ownedGeneration = dragGeneration
        handlers.onStart?.(e)
      },
      onEnd: (s, e) => {
        ownedGeneration = 0
        handlers.onEnd?.(s, e)
      },
    }
    if (handlers.onMove) wrapped.onMove = handlers.onMove
    startDrag(ev, wrapped)
  }
  el.addEventListener('pointerdown', onPointerDown)
  return () => {
    // only finish if this element still owns the active drag
    if (ownedGeneration !== 0 && ownedGeneration === dragGeneration) {
      finishActiveDrag?.()
    }
    el.removeEventListener('pointerdown', onPointerDown)
  }
}

export interface LongPressHandlers {
  delay?: number
  filter?(ev: PointerEvent): boolean
  onLongPress(ev: PointerEvent): void
  /** short press without meeting the long-press delay */
  onTap?(ev: PointerEvent): void
}

/** Hold without moving to fire `onLongPress`; a quick release fires `onTap`. */
export function longPress(el: HTMLElement, handlers: LongPressHandlers): () => void {
  const delay = handlers.delay ?? LONG_PRESS_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let pointerId = 0
  let pressed = false
  let fired = false

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pressed = false
  }

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return
    if (handlers.filter && !handlers.filter(ev)) return
    pressed = true
    fired = false
    startX = ev.clientX
    startY = ev.clientY
    pointerId = ev.pointerId
    const doc = el.ownerDocument
    timer = setTimeout(() => {
      timer = null
      if (!pressed) return
      fired = true
      handlers.onLongPress(ev)
    }, delay)

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_THRESHOLD) clear()
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      doc.removeEventListener('pointermove', onMove, true)
      doc.removeEventListener('pointerup', onUp, true)
      doc.removeEventListener('pointercancel', onUp, true)
      const wasPressed = pressed
      const wasFired = fired
      clear()
      if (wasPressed && !wasFired) handlers.onTap?.(e)
    }
    doc.addEventListener('pointermove', onMove, true)
    doc.addEventListener('pointerup', onUp, true)
    doc.addEventListener('pointercancel', onUp, true)
  }

  el.addEventListener('pointerdown', onPointerDown)
  return () => {
    clear()
    el.removeEventListener('pointerdown', onPointerDown)
  }
}
