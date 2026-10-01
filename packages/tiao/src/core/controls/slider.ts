import { h, setEwCursor, setRowActive, startDrag } from '../dom'
import { arrowKeyStep, mapRange } from '../util'

/** Track + fill + handle overlay. Fill range is `--tiao-fill-start/end` on the track. */
export function createSliderTrack(): HTMLElement {
  return h('div', 'tiao-slider', h('div', 'tiao-slider-fill'), h('div', 'tiao-slider-handles'))
}

const fillRange = new WeakMap<HTMLElement, [number, number]>()

/** Percent span of the filled band; handlebars clamp against these in CSS. */
export function setSliderFillRange(track: HTMLElement, startPct: number, endPct: number): void {
  const prev = fillRange.get(track)
  if (prev && prev[0] === startPct && prev[1] === endPct) return
  fillRange.set(track, [startPct, endPct])
  track.style.setProperty('--tiao-fill-start', `${startPct}%`)
  track.style.setProperty('--tiao-fill-end', `${endPct}%`)
}

export interface SliderTrackHandlers {
  /** apply a pointer position mapped (unclamped) into [min, max] */
  apply(raw: number, last: boolean): void
  /** called once per drag with the initial mapped value, before the first apply */
  onDragStart?(raw: number): void
  /** arrow-key nudge (Shift ×10, Alt ÷10) with the resolved base step; makes the track focusable */
  onKeyDelta?(delta: number, base: number): void
}

/**
 * Shared fill-slider track behavior (number, interval): pointer drags map into
 * the [min, max] range with the rect read once per drag (no layout read per
 * pointermove), the row lights up while dragging, and arrow keys nudge.
 */
export function bindSliderTrack(opts: {
  /** control root that receives the dragging class + active-row state */
  el: HTMLElement
  track: HTMLElement
  min: number
  max: number
  step: number | undefined
  handlers: SliderTrackHandlers
  onDispose(fn: () => void): void
}): {
  /** row long-press: drag from the current value, since the pointer is on the label */
  beginRelativeDrag(e: PointerEvent, apply: (delta: number, last: boolean) => void): void
} {
  const { el, track, min, max, handlers } = opts
  let rect: DOMRect | null = null
  const fromPointer = (clientX: number) => {
    rect ??= track.getBoundingClientRect()
    return mapRange(clientX, rect.left, rect.right, min, max)
  }
  const setTrackActive = (on: boolean) => {
    el.classList.toggle('tiao-slider-dragging', on)
    setRowActive(el, on)
    setEwCursor(track, on)
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    rect = track.getBoundingClientRect()
    setTrackActive(true)
    const raw = fromPointer(e.clientX)
    handlers.onDragStart?.(raw)
    handlers.apply(raw, false)
    startDrag(e, {
      onMove: (s) => handlers.apply(fromPointer(s.x), false),
      onEnd: (s) => {
        handlers.apply(fromPointer(s.x), true)
        setTrackActive(false)
      },
    })
  }
  const beginRelativeDrag = (e: PointerEvent, apply: (delta: number, last: boolean) => void) => {
    const unitsPerPx = (max - min) / (track.getBoundingClientRect().width || 1)
    setTrackActive(true)
    startDrag(e, {
      onStart: (ev) => ev.preventDefault(),
      onMove: (s) => apply(s.dx * unitsPerPx, false),
      onEnd: (s) => {
        apply(s.dx * unitsPerPx, true)
        setTrackActive(false)
      },
    })
  }
  track.addEventListener('pointerdown', onPointerDown)
  opts.onDispose(() => track.removeEventListener('pointerdown', onPointerDown))

  const { onKeyDelta } = handlers
  if (onKeyDelta) {
    const onKeyDown = (e: KeyboardEvent) => {
      const base = opts.step ?? (max - min) / 100
      const delta = arrowKeyStep(e, base)
      if (!delta) return
      e.preventDefault()
      onKeyDelta(delta, base)
    }
    track.tabIndex = 0
    track.addEventListener('keydown', onKeyDown)
    opts.onDispose(() => track.removeEventListener('keydown', onKeyDown))
  }
  return { beginRelativeDrag }
}
