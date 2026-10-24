import { h, withDocument } from './dom'
import type { PluginView } from './plugin'
import { openRowToolbar, type RowTarget } from './row-toolbar'

/** what a card needs from the row it features; right-clicking it offers the row's actions */
export interface Pinnable extends RowTarget {
  readonly label: string
  feature(onDispose: (fn: () => void) => void): PluginView
}

/** the pinned values of one namespace */
export interface PinBoard {
  has(row: Pinnable): boolean
  pin(row: Pinnable): void
  unpin(row: Pinnable): void
  /** re-theme every card after the global look changes */
  sync(): void
}

interface PinCard {
  element: HTMLElement
  dispose(): void
}

/**
 * Featured values: each pinned row gets a card stacked at the bottom center of
 * the page, or of `root()` when the namespace is rooted in an element, newest
 * at the bottom. A card is a second view of the row's value, drawn larger, so
 * editing either one moves both, and it stays up while the row's pane is
 * hidden or collapsed. The stack is mounted only while it holds a card.
 */
export function createPinBoard(
  doc: Document,
  root: () => HTMLElement | null,
  theme: (card: HTMLElement) => void,
): PinBoard {
  const stack = withDocument(doc, () => h('div', 'tiao-pins'))
  const cards = new Map<Pinnable, PinCard>()
  return {
    has: (row) => cards.has(row),
    pin(row) {
      if (cards.has(row)) return
      const card = withDocument(doc, () => createCard(row))
      theme(card.element)
      cards.set(row, card)
      stack.append(card.element)
      const home = root()
      stack.classList.toggle('tiao-pins-rooted', home !== null)
      const parent = home ?? doc.body
      if (stack.parentElement !== parent) parent.append(stack)
    },
    unpin(row) {
      const card = cards.get(row)
      if (!card) return
      cards.delete(row)
      card.dispose()
      if (cards.size === 0) stack.remove()
    },
    sync() {
      for (const card of cards.values()) theme(card.element)
    },
  }
}

/** a one-row pane, so the row's control keeps every pane style and its popups a home */
function createCard(row: Pinnable): PinCard {
  const disposers: (() => void)[] = []
  const view = row.feature((fn) => disposers.push(fn))
  const content = view.full
    ? h('div', 'tiao-row tiao-row-full', view.element)
    : h(
        'div',
        'tiao-row',
        h('div', 'tiao-label', row.label),
        h('div', 'tiao-control', view.element),
      )
  const element = h('div', 'tiao-pane tiao-pin', content)
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    openRowToolbar(row, content, 'top')
  }
  element.addEventListener('contextmenu', onContextMenu)
  return {
    element,
    dispose() {
      for (const fn of disposers) fn()
      element.removeEventListener('contextmenu', onContextMenu)
      element.remove()
    },
  }
}
