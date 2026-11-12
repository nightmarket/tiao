import { h, type InputPlugin, injectCss, normalizeOptions, registerPlugin } from '../core'

/** A select entry with the artwork for its cell. */
export interface ThumbEntry {
  text: string
  value: unknown
  /**
   * inline `<svg …>` markup, an image URL, or any CSS `background` value.
   * Pass `null` / omit to render a text pill with no artwork.
   */
  thumb?: string | null
}

/**
 * Grid of picture swatches, one selected at a time. Usage:
 *   registerThumbnailsPlugin()
 *   pane.addBinding(params, 'gradient', {
 *     view: 'thumbnails',
 *     options: [
 *       { text: 'violet', value: 'violet', thumb: 'linear-gradient(135deg, #ddd6fe, #a78bfa)' },
 *       { text: 'brown', value: 'brown', thumb: '/thumbs/brown.png' },
 *       { text: 'none', value: 'none', thumb: null }, // text pill
 *     ],
 *   })
 * Pass `label: ''` to drop the label column and let the grid span the row.
 */
export const thumbnailsPlugin: InputPlugin<unknown> = {
  id: 'thumbnails',
  type: 'input',
  accept(_value, options) {
    return options.view === 'thumbnails' && options.options !== undefined
  },
  create(ctx) {
    injectCss(ctx.document, 'data-tiao-thumbnails', CSS)
    const entries = normalizeOptions(ctx.options.options) as ThumbEntry[]

    const grid = h('div', 'tiao-thumbs-grid')
    grid.setAttribute('role', 'radiogroup')
    const columns = ctx.options['columns']
    if (typeof columns === 'number') {
      grid.style.gridTemplateColumns = `repeat(${Math.max(1, columns)}, 1fr)`
    }
    const aspect = ctx.options['aspect']
    if (typeof aspect === 'number' && aspect > 0) {
      grid.style.setProperty('--tiao-thumbs-aspect', String(aspect))
    }

    const cells = entries.map((entry) => {
      const thumb = entry.thumb
      const cell =
        thumb == null || thumb === ''
          ? h('button', 'tiao-thumbs-cell tiao-thumbs-pill')
          : h('button', 'tiao-thumbs-cell', thumbBox(thumb))
      cell.type = 'button'
      cell.setAttribute('role', 'radio')
      cell.title = entry.text
      if (entry.text) cell.append(h('span', 'tiao-thumbs-text', entry.text))
      const onClick = () => ctx.value.set(entry.value, { source: 'ui', last: true })
      cell.addEventListener('click', onClick)
      ctx.onDispose(() => cell.removeEventListener('click', onClick))
      grid.append(cell)
      return cell
    })

    const render = (v: unknown) => {
      entries.forEach((entry, i) => {
        const selected = Object.is(entry.value, v)
        cells[i]?.classList.toggle('tiao-selected', selected)
        cells[i]?.setAttribute('aria-checked', String(selected))
      })
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    const root = ctx.label
      ? h('div', 'tiao-thumbs', h('div', 'tiao-label', ctx.label), grid)
      : h('div', 'tiao-thumbs', grid)
    return { element: root, full: true }
  },
}

const SVG_MARKUP = /^\s*<svg[\s>]/i
const IMAGE_SRC = /^(data:|blob:|https?:|\/|\.{1,2}\/)|\.(png|jpe?g|webp|gif|avif|svg)$/i

/** One string covers all three sources; the shape of the value picks the renderer. */
function thumbBox(thumb: string): HTMLElement {
  const box = h('div', 'tiao-thumbs-image')
  if (SVG_MARKUP.test(thumb)) {
    // markup comes from the calling code, same trust level as the rest of the pane
    box.innerHTML = thumb
  } else if (IMAGE_SRC.test(thumb)) {
    const img = h('img')
    img.src = thumb
    img.alt = ''
    img.loading = 'lazy'
    // a press picks the option; dragging would lift the picture out instead
    img.draggable = false
    box.append(img)
  } else {
    box.style.background = thumb
  }
  return box
}

const CSS = `
.tiao-thumbs {
  display: flex;
  align-items: flex-start;
  gap: var(--tiao-gap);
  width: 100%;
  min-width: 0;
}
/* keeps the core label's depth-aware split, so the grid fills just the control column */
.tiao-thumbs > .tiao-label {
  padding-top: 2px;
}
.tiao-thumbs-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  /* reflows to the column width, stretching to fill when a row is short;
     an explicit \`columns\` overrides from JS */
  grid-template-columns: repeat(auto-fit, minmax(var(--tiao-thumbs-min, 44px), 1fr));
  /* matches the grid's own inset from the pane edge (rack + row padding) so the
     spacing between cards and around them is even */
  gap: calc(var(--tiao-rack-pad-x) + var(--tiao-row-pad-x));
}
/* artwork and caption share one card: the frame wraps both, and the 2px inset
   keeps the two radii concentric */
.tiao-thumbs-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 2px;
  border-radius: calc(var(--tiao-radius-sm) + 2px);
  background: var(--tiao-surface);
  color: var(--tiao-fg-dim);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.tiao-thumbs-cell:hover {
  background: var(--tiao-surface-hover);
}
.tiao-thumbs-cell.tiao-selected {
  background: color-mix(in srgb, var(--tiao-fg) 12%, var(--tiao-surface));
  color: var(--tiao-fg-soft);
}
.tiao-thumbs-image {
  aspect-ratio: var(--tiao-thumbs-aspect, 1);
  overflow: hidden;
  border-radius: var(--tiao-radius-sm);
}
.tiao-thumbs-image img,
.tiao-thumbs-image svg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tiao-thumbs-text {
  padding: 2px 2px 0;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* null / omitted thumb: compact text pill, no artwork frame */
.tiao-thumbs-cell.tiao-thumbs-pill {
  justify-content: center;
  padding: 4px 6px;
  min-height: calc(var(--tiao-row-height) - 2px);
}
.tiao-thumbs-cell.tiao-thumbs-pill .tiao-thumbs-text {
  padding: 0;
}
`

let registered = false

export function registerThumbnailsPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(thumbnailsPlugin)
}
