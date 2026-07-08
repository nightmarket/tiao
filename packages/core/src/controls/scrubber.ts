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
  // left grip dots signal draggability; tick ruler shows while scrubbing
  const grip = h('div', 'tiao-scrub-grip')
  const guide = h('div', 'tiao-scrub-guide')
  const wrap = h('div', 'tiao-scrub', input, grip, guide)

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

  let dragBase = 0
  const disposeDrag = draggable(input, {
    onStart: () => {
      dragBase = get()
    },
    onMove: (s) => {
      if (!s.moved || !input.readOnly) return
      wrap.classList.add('tiao-scrubbing')
      guide.style.backgroundPositionX = `calc(50% + ${s.dx}px)`
      set(constrain(dragBase + s.dx * scale), false)
    },
    onEnd: (s) => {
      wrap.classList.remove('tiao-scrubbing')
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
    const parsed = parseNumberInput(input.value)
    if (parsed !== null) set(constrain(parsed), true)
    input.readOnly = true
    input.value = format(get())
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
