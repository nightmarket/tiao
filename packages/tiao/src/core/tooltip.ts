import { adoptTokens, h, withDocument } from './dom'
import { clamp } from './util'

/** hover time before the first tooltip opens */
const OPEN_DELAY = 150
/** a tooltip that closed this recently lets the next one open instantly */
const SKIP_DELAY = 300
/** space between the trigger and the bubble */
const GAP = 6
/** how close the bubble may get to the viewport edges */
const EDGE = 4

/** an open menu under the trigger; the bubble would sit on top of it */
const OPEN_MENUS = '.tiao-pane-menu.tiao-open, .tiao-import.tiao-open'
/** the trigger's theme, copied over because the bubble lives outside the panes */
const THEME_TOKENS = [
  '--tiao-fg',
  '--tiao-bg-solid',
  '--tiao-font',
  '--tiao-font-size',
  '--tiao-radius-sm',
]

/** one bubble per document, shared by every trigger; `owner` is the one showing */
interface Bubble {
  el: HTMLElement
  owner: HTMLElement | null
}
const bubbles = new WeakMap<Document, Bubble>()

let lastClosedAt = Number.NEGATIVE_INFINITY

function bubbleFor(doc: Document): Bubble {
  let bubble = bubbles.get(doc)
  if (!bubble) {
    const el = withDocument(doc, () => h('div', 'tiao-tooltip'))
    el.setAttribute('role', 'tooltip')
    // the trigger's aria-label already says this
    el.setAttribute('aria-hidden', 'true')
    bubble = { el, owner: null }
    bubbles.set(doc, bubble)
  }
  return bubble
}

/**
 * Short label dropped below `target`, centered, on hover or keyboard focus.
 * Every trigger shares one bubble rendered on `<body>` above everything else,
 * themed from the trigger it describes. The first one waits a short beat;
 * moving straight to a neighbor opens instantly. A press dismisses it until
 * the pointer leaves. `text` is read on every open, so the label can follow
 * the trigger's state. Returns a disposer.
 */
export function tooltip(target: HTMLElement, text: () => string): () => void {
  const doc = target.ownerDocument
  let timer: ReturnType<typeof setTimeout> | undefined
  let suppressed = false

  const show = () => {
    if (suppressed || !target.isConnected) return
    if (target.closest('.tiao-pane, .tiao-notch, .tiao-dock')?.querySelector(OPEN_MENUS)) return
    const bubble = bubbleFor(doc)
    const el = bubble.el
    bubble.owner = target
    adoptTokens(el, target, THEME_TOKENS)
    el.textContent = text()
    // re-appending restarts the fade-in for each new trigger
    doc.body.append(el)
    place(el)
  }

  // whole pixels: a half-pixel offset would blur the text on 1x displays
  const place = (el: HTMLElement) => {
    const t = target.getBoundingClientRect()
    const width = el.offsetWidth
    const center = t.left + t.width / 2
    const viewW = doc.documentElement.clientWidth
    const left = clamp(Math.round(center - width / 2), EDGE, Math.max(EDGE, viewW - EDGE - width))
    el.style.left = `${left}px`
    el.style.top = `${Math.round(t.bottom + GAP)}px`
    el.style.setProperty('--tiao-tooltip-arrow', `${Math.round(center - left)}px`)
  }

  const hide = () => {
    clearTimeout(timer)
    const bubble = bubbles.get(doc)
    if (bubble?.owner !== target) return
    bubble.owner = null
    bubble.el.remove()
    lastClosedAt = Date.now()
  }

  const onEnter = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || suppressed) return
    clearTimeout(timer)
    if (Date.now() - lastClosedAt < SKIP_DELAY) show()
    else timer = setTimeout(show, OPEN_DELAY)
  }
  const onLeave = () => {
    suppressed = false
    hide()
  }
  const onPress = () => {
    suppressed = true
    hide()
  }
  const onFocus = () => {
    if (target.matches(':focus-visible')) show()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide()
  }

  target.addEventListener('pointerenter', onEnter)
  target.addEventListener('pointerleave', onLeave)
  target.addEventListener('pointerdown', onPress)
  target.addEventListener('focus', onFocus)
  target.addEventListener('blur', hide)
  // keyboard activation opens menus too
  target.addEventListener('click', hide)
  target.addEventListener('keydown', onKey)
  return () => {
    hide()
    target.removeEventListener('pointerenter', onEnter)
    target.removeEventListener('pointerleave', onLeave)
    target.removeEventListener('pointerdown', onPress)
    target.removeEventListener('focus', onFocus)
    target.removeEventListener('blur', hide)
    target.removeEventListener('click', hide)
    target.removeEventListener('keydown', onKey)
  }
}
