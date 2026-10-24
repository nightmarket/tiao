import { type AnimationPlaybackControls, animate, arc } from 'motion/react'

interface Point {
  x: number
  y: number
}

export interface SunriseTour {
  /** the window the cursor starts over */
  frame: HTMLElement
  /** shown in the top layer, over every pane, popup, and overlay */
  cursor: HTMLElement
  /** whether the pane is up where a cursor could reach it: shown, expanded, and not in the drawer */
  reachable(): boolean
  /** the tab that holds the sun's rows */
  tab: HTMLElement
  /** the row the cursor drags to bring the sun up */
  slider: {
    /** its track, which the cursor drags with real pointer events */
    track: HTMLElement
    range: { min: number; max: number }
    /** where the sun is up */
    to: number
    /** the value now, for the scene to follow without the cursor, and to land on */
    get(): number
    follow(value: number): void
    land(value: number): void
  }
  /** the angle row the cursor pins and then turns from its card */
  dial: {
    get(): number
    /** its row, right-clicked to pin it */
    row: HTMLElement
    pinned(): boolean
    /** the dial on its pinned card, once there is one */
    knob(): HTMLElement | null
    /** degrees the cursor turns it to */
    to: number
  }
  /** played to the end, or handed over to the visitor */
  onDone(): void
}

/** the window fades in before the cursor shows; by now it has all but woken */
const ENTER_MS = 3000
/** slow enough that the sunrise reads */
const RISE_S = 3
const TURN_S = 1.5
/** how long the sun takes to finish rising once the visitor takes over */
const SETTLE_S = 0.9
/** how far from a dial's center the cursor circles, inside its 72 px ring */
const DIAL_RADIUS = 30
const EASE = [0.4, 0, 0.2, 1] as const

/** a stopped tour throws this out of the step it was waiting on */
const STOPPED = Symbol('stopped')

/**
 * A cursor that moves on arcs to the pane, opens the sun's tab, drags a
 * slider so the sun rises over the planet, pins an angle, and turns the
 * pinned card's dial. Every press is a real pointer event, so rows light up
 * and edits land in undo like any other. A click, key, scroll, or touch from
 * the visitor stops it and lets the sun finish rising on its own. Returns a
 * stop function.
 */
export function startSunriseTour(tour: SunriseTour): () => void {
  const { frame, cursor, slider, dial } = tour
  const { track, range } = slider
  const path = arc({ strength: 0.3 })
  const running = new Set<AnimationPlaybackControls>()
  let stopped = false
  /** the cursor's tip, in client coordinates */
  let pos: Point = { x: 0, y: 0 }
  /** while the tour's pointer holds a control, how to let it go */
  let held: (() => void) | null = null
  /** true while the tour dispatches its own events, which aren't the visitor's */
  let dispatching = false

  const step = async <T>(work: PromiseLike<T>): Promise<T> => {
    const result = await work
    if (stopped) throw STOPPED
    return result
  }
  const run = (controls: AnimationPlaybackControls) => {
    running.add(controls)
    return step(controls.finished)
  }
  const wait = (ms: number) => step(new Promise((resolve) => setTimeout(resolve, ms)))

  const centerOf = (el: Element): Point => {
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  const place = (p: Point) => {
    pos = p
    animate(cursor, { x: p.x, y: p.y }, { duration: 0 })
  }
  const moveTo = async (to: Point) => {
    const distance = Math.hypot(to.x - pos.x, to.y - pos.y)
    await run(
      animate(cursor, { x: to.x, y: to.y }, { duration: 0.3 + distance / 1500, ease: EASE, path }),
    )
    pos = to
  }
  const press = (down: boolean) =>
    run(animate(cursor, { scale: down ? 0.86 : 1 }, { duration: down ? 0.08 : 0.14 }))
  const click = async (el: HTMLElement, action = () => el.click()) => {
    await press(true)
    action()
    await press(false)
  }

  const dispatch = (target: EventTarget, event: Event) => {
    dispatching = true
    target.dispatchEvent(event)
    dispatching = false
  }
  const pointer = (type: string, target: EventTarget, p: Point) =>
    dispatch(
      target,
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: p.x,
        clientY: p.y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }),
    )
  const letGo = () => {
    const release = held
    held = null
    release?.()
  }

  const fraction = (v: number) => (v - range.min) / (range.max - range.min)
  /** the sun rises without the cursor: the scene follows each frame, and the row shows where it lands */
  const rise = (seconds: number) =>
    animate(slider.get(), slider.to, {
      duration: seconds,
      ease: 'easeOut',
      onUpdate: slider.follow,
      onComplete: () => slider.land(slider.to),
    })

  /** drags the slider from where it is to `slider.to` */
  const slide = async () => {
    const rect = track.getBoundingClientRect()
    const at = (v: number) => ({
      x: rect.left + fraction(v) * rect.width,
      y: rect.top + rect.height / 2,
    })
    const from = at(slider.get())
    await moveTo(from)
    await press(true)
    pointer('pointerdown', track, from)
    held = () => pointer('pointerup', track, pos)
    await run(
      animate(from.x, at(slider.to).x, {
        duration: RISE_S,
        ease: 'easeInOut',
        onUpdate: (x) => {
          place({ x, y: from.y })
          pointer('pointermove', track, pos)
        },
      }),
    )
    letGo()
    await press(false)
  }

  /** pins the dial's row from its right-click menu */
  const pin = async () => {
    const rect = dial.row.getBoundingClientRect()
    const spot = { x: rect.left + rect.width * 0.3, y: rect.top + rect.height / 2 }
    await moveTo(spot)
    await click(dial.row, () =>
      dispatch(
        dial.row,
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: spot.x,
          clientY: spot.y,
        }),
      ),
    )
    const pinButton = document.querySelector<HTMLElement>('.tiao-row-toolbar-pin')
    if (!pinButton) return
    await wait(180)
    await moveTo(centerOf(pinButton))
    await click(pinButton)
    await wait(300)
  }

  /** opens the pinned card's dial, circles it to `dial.to`, and presses to set it */
  const turn = async () => {
    const knob = dial.knob()
    if (!knob) return
    const center = centerOf(knob)
    const around = (degrees: number) => {
      const rad = (degrees * Math.PI) / 180
      return {
        x: center.x + Math.sin(rad) * DIAL_RADIUS,
        y: center.y - Math.cos(rad) * DIAL_RADIUS,
      }
    }
    await moveTo(center)
    await click(knob)
    // the open dial follows the pointer and sets the value on the next press
    held = () => {
      pointer('pointerdown', document.body, pos)
      pointer('pointerup', document.body, pos)
    }
    const from = dial.get()
    await moveTo(around(from))
    await run(
      animate(from, dial.to, {
        duration: TURN_S,
        ease: 'easeInOut',
        onUpdate: (degrees) => {
          place(around(degrees))
          pointer('pointermove', document, pos)
        },
      }),
    )
    await press(true)
    letGo()
    await press(false)
  }

  const play = async () => {
    await wait(ENTER_MS)
    if (!tour.reachable()) {
      await run(rise(RISE_S))
      return
    }
    const rect = frame.getBoundingClientRect()
    place({ x: rect.left + rect.width * 0.4, y: rect.top + rect.height * 0.8 })
    await run(animate(cursor, { opacity: 1 }, { duration: 0.3 }))

    await moveTo(centerOf(tour.tab))
    await click(tour.tab)
    await wait(200)
    await slide()
    await wait(250)
    if (!dial.pinned()) await pin()
    await turn()
    await wait(350)
    await moveTo({ x: pos.x - 80, y: pos.y - 60 })
    await run(animate(cursor, { opacity: 0 }, { duration: 0.4 }))
  }

  // a scroll moves the page out from under the cursor, which sits in the viewport
  const INTERRUPTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
  // the visitor's own pointer would end or steer a drag the cursor is holding
  const holdPointer = (e: PointerEvent) => {
    if (held && !dispatching) e.stopImmediatePropagation()
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const controls of running) controls.stop()
    letGo()
    for (const type of INTERRUPTS) window.removeEventListener(type, interrupt, true)
    window.removeEventListener('pointermove', holdPointer, true)
  }
  function interrupt(e: Event) {
    if (dispatching) return
    stop()
    animate(cursor, { opacity: 0 }, { duration: 0.2 })
    // grabbing the slider's row means the visitor is raising the sun now
    if (!(e.target instanceof Node && track.closest('.tiao-row')?.contains(e.target))) {
      rise(SETTLE_S)
    }
    tour.onDone()
  }
  for (const type of INTERRUPTS) window.addEventListener(type, interrupt, true)
  window.addEventListener('pointermove', holdPointer, true)

  cursor.popover = 'manual'
  if (!cursor.matches(':popover-open')) cursor.showPopover()
  play().then(
    () => {
      stop()
      tour.onDone()
    },
    (error: unknown) => {
      if (error !== STOPPED) throw error
    },
  )
  return stop
}
