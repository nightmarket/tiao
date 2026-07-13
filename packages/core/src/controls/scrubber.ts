import { collapseSelection, h, setEwCursor, setRowActive, startDrag } from '../dom'
import { arrowKeyStep, clamp, formatNumber, nudge, parseNumberInput, snap } from '../util'
import { Value } from '../value'

export interface ScrubberOptions {
  min?: number
  max?: number
  step?: number
  /** value change per horizontal pixel while dragging (default derived from step) */
  pointerScale?: number
  format?: (v: number) => string
  /**
   * Show the dotted arrow + tooltip overlay while scrubbing (default true).
   * Min/max fill sliders turn this off — the fill-edge handlebar is the cue.
   */
  guide?: boolean
  /**
   * Allow dragging the value field itself to scrub (default true).
   * Fill sliders turn this off so the track receives pointer events on the fill.
   */
  fieldDrag?: boolean
  /**
   * Where an external beginScrub (row long-press) drags from (default 'grip').
   * Controls that hide the grip (slider value field, interval endpoints)
   * scrub from the value field instead.
   */
  scrubAnchor?: 'grip' | 'input'
}

export interface ScrubberApi {
  element: HTMLElement
  activate: () => void
  /** start a scrub drag from an external pointer event (e.g. row long-press) */
  beginScrub: (ev: PointerEvent) => void
  dispose: () => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Copy pane theme tokens onto a body-portaled overlay. */
export function applyOverlayTheme(overlay: HTMLElement, from: Element): void {
  const cs = from.ownerDocument.defaultView?.getComputedStyle(from)
  if (!cs) return
  for (const prop of [
    '--tiao-fg',
    '--tiao-fg-soft',
    '--tiao-fg-dim',
    '--tiao-bg',
    '--tiao-bg-solid',
    '--tiao-border',
    '--tiao-accent',
    '--tiao-font-mono',
    '--tiao-font-size-mono',
    '--tiao-radius',
    '--tiao-radius-sm',
    '--tiao-shadow-popup',
  ]) {
    const v = cs.getPropertyValue(prop)
    if (v) overlay.style.setProperty(prop, v)
  }
}

/**
 * Value readout that follows the pointer above a body-portaled overlay
 * (angle dial, XY pad) — same visual language as the scrubber guide tooltip.
 */
export function createOverlayTooltip(overlay: HTMLElement): {
  place(originX: number, originY: number, clientX: number, clientY: number, text: string): void
  hide(): void
} {
  const el = h('div', 'tiao-scrub-tooltip')
  el.style.visibility = 'hidden'
  overlay.append(el)
  return {
    place(originX, originY, clientX, clientY, text) {
      el.style.visibility = 'visible'
      el.style.left = `${clientX - originX}px`
      el.style.top = `${clientY - originY}px`
      el.textContent = text
    },
    hide() {
      el.style.visibility = 'hidden'
    },
  }
}

/**
 * Draggable number field: drag the left knob to scrub, click the value to type.
 * While scrubbing, a dotted guide + value tooltip follow the pointer (tweakpane-style).
 * Used by plain number inputs and point component fields.
 */
export function createScrubber(
  value: Value<number>,
  get: () => number,
  set: (v: number, last: boolean) => void,
  opts: ScrubberOptions,
): ScrubberApi {
  const step = opts.step
  const scale = opts.pointerScale ?? (step ?? guessStep(get())) * 0.5
  const showGuide = opts.guide !== false
  const fieldDrag = opts.fieldDrag !== false
  // format to the binding step; formatNumber keeps trailing zeros and still
  // shows finer Alt (step/10) digits when present
  const format = opts.format ?? ((v: number) => formatNumber(v, step))

  const input = h('input', 'tiao-num-input')
  input.type = 'text'
  input.inputMode = 'decimal'
  input.readOnly = true
  input.value = format(get())

  // left knob is the scrub handle; guide/tooltip are portaled to <body> so
  // they aren't clipped by pane overflow (critical for tight vec2/vec3 fields)
  const knob = h('div', 'tiao-scrub-grip')
  const wrap = h('div', 'tiao-scrub', input, knob)

  let overlay: HTMLElement | null = null
  let guideBody: SVGPathElement | null = null
  let guideHead: SVGPathElement | null = null
  let tooltip: HTMLElement | null = null
  let originX = 0
  let originY = 0

  const hideOverlay = () => {
    overlay?.remove()
    overlay = null
    guideBody = null
    guideHead = null
    tooltip = null
    wrap.classList.remove('tiao-scrub-dragging')
    setRowActive(wrap, false)
    setEwCursor(input, false)
  }

  const showOverlay = (anchor: HTMLElement) => {
    wrap.classList.add('tiao-scrub-dragging')
    setEwCursor(input, true)
    if (!showGuide || overlay) return
    const doc = input.ownerDocument
    const rect = anchor.getBoundingClientRect()
    // grip: center of the handle; input: left padding edge so the guide
    // grows from the value field the same way the knob does
    originX = anchor === knob ? rect.left + rect.width / 2 : rect.left + 6
    originY = rect.top + rect.height / 2

    guideBody = doc.createElementNS(SVG_NS, 'path')
    guideBody.setAttribute('class', 'tiao-scrub-guide-body')
    guideHead = doc.createElementNS(SVG_NS, 'path')
    guideHead.setAttribute('class', 'tiao-scrub-guide-head')
    const guide = doc.createElementNS(SVG_NS, 'svg')
    guide.setAttribute('class', 'tiao-scrub-guide')
    guide.setAttribute('aria-hidden', 'true')
    guide.append(guideBody, guideHead)

    tooltip = h('div', 'tiao-scrub-tooltip')
    // the value subscription keeps the text current after this
    tooltip.textContent = format(get())
    overlay = h('div', 'tiao-scrub-overlay', guide, tooltip)
    overlay.style.left = `${originX}px`
    overlay.style.top = `${originY}px`
    applyOverlayTheme(overlay, input)
    doc.body.append(overlay)
  }

  const updateGuide = (clientX: number) => {
    if (!guideBody || !guideHead || !tooltip) return
    const dx = clientX - originX
    // arrow sits just shy of the cursor so the head reads as a pointer tip
    const aox = dx + (dx > 0 ? -1 : dx < 0 ? 1 : 0)
    const adx = clamp(-aox, -4, 4)
    guideHead.setAttribute(
      'd',
      [`M ${aox + adx},0 L${aox},4 L${aox + adx},8`, `M ${dx},-1 L${dx},9`].join(' '),
    )
    guideBody.setAttribute('d', `M 0,4 L${dx},4`)
    tooltip.style.left = `${dx}px`
  }

  const constrain = (v: number): number => {
    const snapped = snap(v, step)
    const lo = opts.min ?? -Infinity
    const hi = opts.max ?? Infinity
    return clamp(snapped, lo, hi)
  }

  const enterEdit = () => {
    input.readOnly = false
    input.focus()
    input.select()
    // re-select after the trailing click, which can collapse the selection
    setTimeout(() => {
      if (!input.readOnly) input.select()
    }, 0)
  }

  const runScrub = (anchor: HTMLElement, ev: PointerEvent, onTap?: () => void) => {
    let base = get()
    startDrag(ev, {
      onStart: (e) => {
        e.preventDefault()
        base = get()
        // long-press / drag activation cue before the pointer moves
        wrap.classList.add('tiao-scrub-dragging')
        setRowActive(wrap, true)
        setEwCursor(input, true)
      },
      onMove: (s, e) => {
        if (!s.moved) return
        showOverlay(anchor)
        set(constrain(base + s.dx * scale), false)
        updateGuide(e.clientX)
      },
      onEnd: (s) => {
        hideOverlay()
        if (s.moved) set(constrain(base + s.dx * scale), true)
        else onTap?.()
      },
    })
  }

  // scrub from the knob so the input never focuses / selects while dragging;
  // dragging the field itself also scrubs (unless fieldDrag is off — fill
  // sliders need the track to receive those hits), and a plain click enters edit
  const bindScrub = (anchor: HTMLElement, onTap?: () => void) => {
    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      if (!input.readOnly) return
      runScrub(anchor, ev, onTap)
    }
    anchor.addEventListener('pointerdown', onPointerDown)
    return () => anchor.removeEventListener('pointerdown', onPointerDown)
  }
  const disposeKnobDrag = bindScrub(knob)
  const disposeFieldDrag = fieldDrag
    ? bindScrub(input, enterEdit)
    : (() => {
        // click-to-edit only — don't start a competing drag over the fill track
        const onClick = () => {
          if (input.readOnly) enterEdit()
        }
        input.addEventListener('click', onClick)
        return () => input.removeEventListener('click', onClick)
      })()

  const commitText = () => {
    if (input.readOnly) return
    collapseSelection(input)
    const parsed = parseNumberInput(input.value)
    // skip re-snap when the field still shows a value we already committed
    // (e.g. Alt step/10 nudges that sit between the binding's `step` grid)
    if (parsed !== null && parsed !== get()) set(constrain(parsed), true)
    input.readOnly = true
    input.value = format(get())
    collapseSelection(input)
  }
  const nudgeFromKey = (e: KeyboardEvent): boolean => {
    const base = step ?? guessStep(get())
    const delta = arrowKeyStep(e, base)
    if (!delta) return false
    e.preventDefault()
    const current = input.readOnly ? get() : (parseNumberInput(input.value) ?? get())
    const next = clamp(nudge(current, delta, base), opts.min ?? -Infinity, opts.max ?? Infinity)
    set(next, true)
    if (!input.readOnly) {
      input.value = format(next)
      input.select()
    }
    return true
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (nudgeFromKey(e)) return
    if (input.readOnly) return
    if (e.key === 'Enter') commitText()
    if (e.key === 'Escape') {
      input.readOnly = true
      input.value = format(get())
      collapseSelection(input)
    }
  }
  input.addEventListener('blur', commitText)
  input.addEventListener('keydown', onKeyDown)

  const unsubscribe = value.subscribe(() => {
    const text = format(get())
    if (input.readOnly) input.value = text
    if (tooltip) tooltip.textContent = text
  })

  return {
    element: wrap,
    activate: enterEdit,
    beginScrub: (ev) => {
      if (!input.readOnly) return
      runScrub(opts.scrubAnchor === 'input' ? input : knob, ev)
    },
    dispose: () => {
      hideOverlay()
      disposeKnobDrag()
      disposeFieldDrag()
      input.removeEventListener('blur', commitText)
      input.removeEventListener('keydown', onKeyDown)
      unsubscribe()
    },
  }
}

/**
 * Scrubber for one component of a composite value (point axis, interval
 * endpoint, bezier coordinate): owns the derived Value that mirrors the
 * component and its subscription to the parent.
 */
export function createComponentScrubber<P>(
  parent: Value<P>,
  read: () => number,
  write: (v: number, last: boolean) => void,
  opts: ScrubberOptions,
  onDispose: (fn: () => void) => void,
): ScrubberApi {
  const component = new Value(read())
  onDispose(parent.subscribe(() => component.set(read())))
  const scrub = createScrubber(component, read, write, opts)
  onDispose(scrub.dispose)
  return scrub
}

function guessStep(v: number): number {
  const abs = Math.abs(v)
  if (abs === 0) return 0.1
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - 1)
  return clamp(magnitude, 0.001, 1)
}
