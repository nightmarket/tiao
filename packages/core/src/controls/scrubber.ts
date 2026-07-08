import { draggable, h } from '../dom'
import { clamp, formatNumber, parseNumberInput, snap } from '../util'
import type { Value } from '../value'

export interface ScrubberOptions {
  min?: number
  max?: number
  step?: number
  /** value change per horizontal pixel while dragging (default derived from step) */
  pointerScale?: number
  format?: (v: number) => string
}

/**
 * Draggable number field: drag horizontally to scrub, click to type.
 * Used by plain number inputs and point component fields.
 */
export function createScrubber(
  value: Value<number>,
  get: () => number,
  set: (v: number, last: boolean) => void,
  opts: ScrubberOptions,
): { element: HTMLElement; activate: () => void; dispose: () => void } {
  const step = opts.step
  const scale = opts.pointerScale ?? (step ?? guessStep(get())) * 0.5
  const format = opts.format ?? ((v: number) => formatNumber(v, step))

  const input = h('input', 'tiao-num-input')
  input.type = 'text'
  input.inputMode = 'decimal'
  input.readOnly = true
  input.value = format(get())
  // left grip dots signal draggability
  const grip = h('div', 'tiao-scrub-grip')
  const wrap = h('div', 'tiao-scrub', input, grip)

  // full-screen tick ruler while scrubbing: aligned with the input but spanning
  // the whole viewport, so the drag direction reads even outside the pane
  let overlay: HTMLElement | null = null
  let overlayGuide: HTMLElement | null = null
  let overlayCenter = 0
  const showOverlay = () => {
    if (overlay) return
    const doc = input.ownerDocument
    const rect = input.getBoundingClientRect()
    overlayCenter = rect.left + rect.width / 2
    overlayGuide = h('div', 'tiao-drag-overlay-guide')
    overlayGuide.style.top = `${rect.bottom - 6}px`
    const marker = h('div', 'tiao-drag-overlay-marker')
    marker.style.left = `${overlayCenter}px`
    marker.style.top = `${rect.bottom - 8}px`
    overlay = h('div', 'tiao-drag-overlay', overlayGuide, marker)
    // the overlay lives on <body>, outside the pane's CSS variable scope
    const cs = doc.defaultView?.getComputedStyle(input)
    if (cs) {
      overlay.style.setProperty('--tiao-fg-dim', cs.getPropertyValue('--tiao-fg-dim'))
      overlay.style.setProperty('--tiao-accent', cs.getPropertyValue('--tiao-accent'))
    }
    doc.body.append(overlay)
  }
  const hideOverlay = () => {
    overlay?.remove()
    overlay = null
    overlayGuide = null
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

  const collapseSelection = () => {
    try {
      const end = input.value.length
      input.setSelectionRange(end, end)
    } catch {
      /* selection ranges are best-effort for text-like inputs */
    }
  }

  let dragBase = 0
  const disposeDrag = draggable(input, {
    onStart: () => {
      dragBase = get()
    },
    onMove: (s) => {
      if (!s.moved || !input.readOnly) return
      showOverlay()
      if (overlayGuide) overlayGuide.style.backgroundPositionX = `${overlayCenter + s.dx}px`
      set(constrain(dragBase + s.dx * scale), false)
    },
    onEnd: (s) => {
      hideOverlay()
      if (!input.readOnly) return
      if (s.moved) {
        set(constrain(dragBase + s.dx * scale), true)
      } else {
        // plain click: enter edit mode with the value selected
        enterEdit()
      }
    },
  })

  const commitText = () => {
    if (input.readOnly) return
    collapseSelection()
    const parsed = parseNumberInput(input.value)
    if (parsed !== null) set(constrain(parsed), true)
    input.readOnly = true
    input.value = format(get())
    collapseSelection()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (input.readOnly) {
      const delta = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
      if (delta) {
        e.preventDefault()
        set(constrain(get() + delta * (step ?? guessStep(get()))), true)
      }
      return
    }
    if (e.key === 'Enter') commitText()
    if (e.key === 'Escape') {
      input.readOnly = true
      input.value = format(get())
      collapseSelection()
    }
  }
  input.addEventListener('blur', commitText)
  input.addEventListener('keydown', onKeyDown)

  const unsubscribe = value.subscribe(() => {
    if (input.readOnly) input.value = format(get())
  })

  return {
    element: wrap,
    activate: enterEdit,
    dispose: () => {
      hideOverlay()
      disposeDrag()
      input.removeEventListener('blur', commitText)
      input.removeEventListener('keydown', onKeyDown)
      unsubscribe()
    },
  }
}

function guessStep(v: number): number {
  const abs = Math.abs(v)
  if (abs === 0) return 0.1
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - 1)
  return clamp(magnitude, 0.001, 1)
}
