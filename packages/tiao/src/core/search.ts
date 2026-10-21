import type { BindingApi } from './blade'
import { formatValue } from './controls/monitor'
import { h, searchIcon, withDocument } from './dom'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** how the search shortcut reads in a tooltip on this platform */
export const SEARCH_KEY_HINT = isMac ? '⌘K' : 'Ctrl K'

/** ⌘K on Apple platforms, Ctrl+K elsewhere */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  return (e.key === 'k' || e.key === 'K') && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey
}

/** most results drawn at once; a longer query narrows the rest */
const MAX_RESULTS = 50

/** a row the search can find, with the titles of the pane and sections around it */
export interface SearchEntry {
  binding: BindingApi<unknown>
  path: string[]
}

export interface SearchHost {
  document: Document
  /** every row on the page, read each time the search opens */
  entries(): SearchEntry[]
  /** open whatever hides the row and point it out */
  reveal(binding: BindingApi<unknown>): void
  /** wear the global look */
  theme(el: HTMLElement): void
}

export interface Search {
  open(): void
  close(): void
  dispose(): void
}

interface Match {
  entry: SearchEntry
  rank: number
}

/**
 * Search every row in every pane by its label, key, or the titles around it.
 * Arrow keys pick a result; Enter reveals its row (opening hidden panes,
 * collapsed folders, and tabs) and ⌘/Ctrl+Enter pins or unpins it.
 */
export function createSearch(host: SearchHost): Search {
  const doc = host.document
  const { element, input, list } = withDocument(doc, () => {
    const input = h('input', 'tiao-search-palette-input')
    input.type = 'search'
    input.placeholder = 'Search parameters'
    input.spellcheck = false
    input.setAttribute('aria-label', 'Search parameters')
    const list = h('div', 'tiao-search-palette-results')
    list.setAttribute('role', 'listbox')
    const field = h('div', 'tiao-search-palette-field', searchIcon(), input)
    const element = h('div', 'tiao-pane tiao-search-palette', field, list)
    element.setAttribute('role', 'dialog')
    element.setAttribute('aria-label', 'Search parameters')
    return { element, input, list }
  })

  let entries: SearchEntry[] = []
  let matches: Match[] = []
  let active = 0
  let isOpen = false

  const render = () => {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean)
    matches = []
    for (const entry of entries) {
      const label = entry.binding.label.toLowerCase()
      const text = `${entry.path.join(' ')} ${label} ${entry.binding.key}`.toLowerCase()
      if (!terms.every((t) => text.includes(t))) continue
      const first = terms[0] ?? ''
      const rank = label.startsWith(first) ? 0 : label.includes(first) ? 1 : 2
      matches.push({ entry, rank })
    }
    // stable, so rows of equal rank keep their order on the page
    matches.sort((a, b) => a.rank - b.rank)
    matches.length = Math.min(matches.length, MAX_RESULTS)
    active = 0
    list.replaceChildren(
      ...withDocument(doc, () =>
        matches.length > 0
          ? matches.map((m, i) => resultRow(m.entry, i))
          : [h('div', 'tiao-search-palette-empty', 'No matches')],
      ),
    )
    highlight()
  }

  const resultRow = (entry: SearchEntry, index: number) => {
    const { binding, path } = entry
    const row = h(
      'button',
      'tiao-search-palette-item',
      h(
        'span',
        'tiao-search-palette-name',
        h('span', 'tiao-search-palette-label', binding.label),
        path.length > 0 ? h('span', 'tiao-search-palette-path', path.join(' › ')) : null,
      ),
      h('span', 'tiao-search-palette-value', formatValue(binding.value.get())),
    )
    row.type = 'button'
    row.tabIndex = -1
    row.setAttribute('role', 'option')
    row.dataset.index = String(index)
    return row
  }

  const highlight = () => {
    list.querySelectorAll('.tiao-search-palette-item').forEach((row, i) => {
      const on = i === active
      row.classList.toggle('tiao-active', on)
      row.setAttribute('aria-selected', String(on))
      if (on) row.scrollIntoView?.({ block: 'nearest' })
    })
  }

  const choose = (index: number, pin: boolean) => {
    const binding = matches[index]?.entry.binding
    if (!binding) return
    close()
    if (pin) binding.pinned = !binding.pinned
    else host.reveal(binding)
  }

  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (matches.length === 0) return
        const step = e.key === 'ArrowDown' ? 1 : -1
        active = (active + step + matches.length) % matches.length
        highlight()
        return
      }
      case 'Enter':
        e.preventDefault()
        choose(active, e.metaKey || e.ctrlKey)
        return
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      default:
        return
    }
  }
  const rowAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('.tiao-search-palette-item') : null
  const onPointerMove = (e: PointerEvent) => {
    const index = Number(rowAt(e.target)?.dataset.index ?? -1)
    if (index < 0 || index === active) return
    active = index
    highlight()
  }
  const onClick = (e: MouseEvent) => {
    const index = Number(rowAt(e.target)?.dataset.index ?? -1)
    if (index >= 0) choose(index, e.metaKey || e.ctrlKey)
  }
  const onOutside = (e: PointerEvent) => {
    if (!element.contains(e.target as Node | null)) close()
  }

  input.addEventListener('input', render)
  input.addEventListener('keydown', onKey)
  list.addEventListener('pointermove', onPointerMove)
  list.addEventListener('click', onClick)

  function open() {
    entries = host.entries()
    host.theme(element)
    input.value = ''
    render()
    if (!isOpen) {
      isOpen = true
      doc.body.append(element)
      doc.addEventListener('pointerdown', onOutside, true)
    }
    input.focus()
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    element.remove()
    entries = []
    matches = []
    doc.removeEventListener('pointerdown', onOutside, true)
  }

  return {
    open,
    close,
    dispose() {
      close()
      input.removeEventListener('input', render)
      input.removeEventListener('keydown', onKey)
      list.removeEventListener('pointermove', onPointerMove)
      list.removeEventListener('click', onClick)
    },
  }
}
