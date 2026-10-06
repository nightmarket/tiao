import { h, withDocument } from '../dom'

/** text-like pane inputs that get the custom caret */
const INPUT_SELECTOR = '.tiao-num-input, .tiao-text-input, .tiao-color-text, .tiao-search-input'

function restartBlink(caret: HTMLElement): void {
  caret.style.animation = 'none'
  void caret.offsetWidth
  caret.style.animation = ''
}

/**
 * Draws a 2px accent caret over the focused pane input; the native caret is
 * too thin to notice. The native caret is hidden while this one is active,
 * and the custom one hides whenever a non-collapsed selection is visible.
 */
export function installCaret(root: HTMLElement, doc: Document): () => void {
  const win = doc.defaultView
  let meas: CanvasRenderingContext2D | null = null
  try {
    meas = doc.createElement('canvas').getContext?.('2d') ?? null
  } catch {
    /* no canvas backend */
  }
  // no canvas (e.g. jsdom): keep the native caret
  if (!win || !meas) return () => {}

  const caret = withDocument(doc, () => h('div', 'tiao-caret'))
  let active: HTMLInputElement | null = null
  let frame = 0
  let deferredSearchbar: HTMLElement | null = null
  let revealTimer = 0
  let fontKey = ''
  let fontSize = 0
  let paddingLeft = 0
  let paddingRight = 0
  let textAlign = ''
  let variation = 'normal'
  /** canvas ignores font-variation-settings (the Areal mono is an axis), so
      those fields are measured by a hidden span in the same style instead */
  let axisMeas: HTMLSpanElement | null = null

  const measure = (text: string): number => {
    if (variation === 'normal') return meas.measureText(text).width
    if (!axisMeas) {
      axisMeas = withDocument(doc, () => h('span', 'tiao-caret-measure'))
      root.append(axisMeas)
    }
    axisMeas.style.font = meas.font
    axisMeas.style.fontVariationSettings = variation
    axisMeas.textContent = text
    return axisMeas.getBoundingClientRect().width
  }

  const hide = () => {
    caret.remove()
    if (active) active.style.caretColor = ''
    active = null
    doc.removeEventListener('selectionchange', onSelectionChange)
    deferredSearchbar = null
    if (revealTimer) win.clearTimeout(revealTimer)
    revealTimer = 0
  }

  const update = () => {
    if (!active) return
    if (doc.activeElement !== active) {
      hide()
      return
    }
    if (deferredSearchbar) {
      caret.remove()
      return
    }
    const start = active.selectionStart
    const end = active.selectionEnd
    // selection ranges render their own highlight; no caret to draw
    if (start === null || start !== end) {
      caret.remove()
      return
    }
    const cs = win.getComputedStyle(active)
    const nextFont = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const nextKey = `${nextFont} ${cs.fontVariationSettings}`
    if (nextKey !== fontKey) {
      fontKey = nextKey
      meas.font = nextFont
      variation = cs.fontVariationSettings || 'normal'
      fontSize = parseFloat(cs.fontSize)
      paddingLeft = parseFloat(cs.paddingLeft)
      paddingRight = parseFloat(cs.paddingRight)
      textAlign = cs.textAlign
    }
    const value = active.value
    const rect = active.getBoundingClientRect()
    let x: number
    if (textAlign === 'right') {
      // right-aligned fields rarely overflow; measure back from the right edge
      x = rect.right - paddingRight - measure(value.slice(start))
    } else {
      x = rect.left + paddingLeft + measure(value.slice(0, start)) - active.scrollLeft
    }
    x = Math.min(Math.max(x, rect.left + 1), rect.right - 3)

    const rootRect = root.getBoundingClientRect()
    const height = Math.min(rect.height - 6, fontSize + 4)
    const left = `${x - rootRect.left}px`
    const top = `${rect.top - rootRect.top + (rect.height - height) / 2}px`
    const heightPx = `${height}px`
    const moved =
      caret.style.left !== left || caret.style.top !== top || caret.style.height !== heightPx
    if (moved) {
      caret.style.left = left
      caret.style.top = top
      caret.style.height = heightPx
      restartBlink(caret)
    }
    if (!caret.isConnected) root.append(caret)
  }

  const scheduleUpdate = () => {
    if (frame) win.cancelAnimationFrame(frame)
    frame = win.requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }
  // selectionchange covers typing, clicks, arrows, and select-all inside inputs;
  // it is document-wide, so it is only listened to while a pane input has focus
  const onSelectionChange = () => scheduleUpdate()

  const revealDeferredSearchCaret = () => {
    if (!deferredSearchbar) return
    if (revealTimer) win.clearTimeout(revealTimer)
    revealTimer = 0
    deferredSearchbar = null
    scheduleUpdate()
  }

  const deferSearchCaret = (input: HTMLInputElement): boolean => {
    const searchbar = input.closest('.tiao-searchbar')
    if (!(searchbar instanceof HTMLElement) || !searchbar.classList.contains('tiao-open')) {
      return false
    }
    if (searchbar.getBoundingClientRect().height >= input.getBoundingClientRect().height) {
      return false
    }
    caret.remove()
    deferredSearchbar = searchbar
    if (revealTimer) win.clearTimeout(revealTimer)
    revealTimer = win.setTimeout(revealDeferredSearchCaret, 180)
    return true
  }

  const onFocusIn = (e: FocusEvent) => {
    const t = e.target
    if (t instanceof HTMLInputElement && t.matches(INPUT_SELECTOR)) {
      active = t
      doc.addEventListener('selectionchange', onSelectionChange)
      t.style.caretColor = 'transparent'
      if (t.matches('.tiao-search-input') && deferSearchCaret(t)) return
      update()
    }
  }
  const onFocusOut = (e: FocusEvent) => {
    if (e.target === active) {
      fontKey = ''
      hide()
    }
  }
  const onTransitionEnd = (e: TransitionEvent) => {
    if (e.target === deferredSearchbar && e.propertyName === 'height') {
      revealDeferredSearchCaret()
      return
    }
    if (active && e.target instanceof Element && root.contains(e.target)) scheduleUpdate()
  }

  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  root.addEventListener('transitionend', onTransitionEnd)
  return () => {
    if (frame) win.cancelAnimationFrame(frame)
    hide()
    axisMeas?.remove()
    root.removeEventListener('focusin', onFocusIn)
    root.removeEventListener('focusout', onFocusOut)
    root.removeEventListener('transitionend', onTransitionEnd)
  }
}
