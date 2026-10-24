import type { Pane } from '@nightmarket/tiao/core'
import { Code, Demo, Section } from '../ui'

/** a row of a table: what, what it does, and the call that does the same */
type Row = [string, string, string?]

const NOTCH: Row[] = [
  ['Hide', 'Every floating pane, like H', 'Pane.toggleAll()'],
  ['Dock', 'Every floating pane into the sidebar', 'Pane.toggleDock()'],
  ['Search', 'Every row in every pane, like T T'],
  ['Undo, redo', 'The last 10 edits; a drag, a reset, or an import is one step', 'Pane.undo()'],
  ['Changed', 'How many rows differ from the code; click to outline them', 'Pane.countOverrides()'],
  ['⋯', 'Copy or import every saved value as JSON, or reset them all', 'Pane.exportValues()'],
  ['Gear', 'The global settings below'],
]

const SETTINGS: Row[] = [
  ['Hiding', 'The notch hides until the pointer nears the top. On by default'],
  ['Numbers', 'Numbers every folder title: 1, 1.1, 2'],
  ['Minimal mode', 'Rows show only their value until hovered'],
  ['Font', 'Geist (bundled), system, or ABC Areal from your page'],
  ['Font size', 'Small, medium, or large'],
  ['Spacing', 'Row padding, small to large'],
  ['Theme', 'Light, dark, or system'],
  ['Style', 'Bouba is soft and round; Kiki is sharp and flat'],
  ['Glass', 'Frosted panes and notch. On by default, and costs a blur per frame'],
  ['Accent', 'Fills, focus rings, and changed dots'],
]

const SETTINGS_CODE = `Pane.setFont('system') // 'geist' | 'system' | 'areal'
Pane.setFontSize('normal') // 'small' | 'normal' | 'large'
Pane.setSpacing('m')
Pane.setGlass(false)
Pane.setHoverControls(true)`

const SIDEBAR_CODE = `Pane.toggleDock() // or the notch's dock button; Pane.docked says which
new Pane({ title: 'Export', order: 99 }) // lower sorts first in the sidebar`

const INSET_CODE = `/* chrome of your own beside the sidebar */
.my-sidebar {
  left: var(--tiao-dock-inset-start, 0px);
}`

const NAMESPACE_CODE = `// the element must be positioned, not static
const release = Pane.namespace('hero', { root: element, hiding: true })
const pane = new Pane({ id: 'hero', title: 'Shader', namespace: 'hero', anchor: 'top-right' })

Pane.undo(pane.namespace) // the static actions take a namespace

pane.dispose()
release()`

const THEME_CODE = `pane.theme = 'nord' // 'system' | 'light' | 'dark' | 'solarized' | 'nord' | 'catppuccin'
pane.style = 'kiki' // 'bouba' is rounded with a soft shadow; 'kiki' is sharp and flat
pane.accent = '#88c0d0'`

const buildTheme = (pane: Pane) => {
  pane.theme = 'nord'
  pane.style = 'kiki'
  pane.accent = '#88c0d0'
  const params = { frost: 0.4, aurora: '#a3be8c' }
  pane.addBinding(params, 'frost', { min: 0, max: 1 })
  pane.addBinding(params, 'aurora')
}

const SHORTCUTS: Row[] = [
  ['T T', 'Search every row in every pane'],
  ['H', 'Hide or show the floating panes'],
  ['Enter', 'In search, reveal the row: opens its pane, folder, and tab'],
  ['⌘ Enter', 'In search, pin or unpin the row'],
  ['Right-click a row', 'Pin it, or reset it to its code default'],
  ['Right-click a title', 'Theme, style, accent, and anchor for that pane'],
]

function Table({ rows, keys }: { rows: Row[]; keys?: boolean }) {
  return (
    <dl className="docs-table">
      {rows.map(([term, what, call]) => (
        <div key={term}>
          <dt>{keys ? <kbd>{term}</kbd> : term}</dt>
          <dd>
            {what}
            {call && (
              <>
                {' '}
                <code>{call}</code>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Panes() {
  return (
    <>
      <header className="docs-hero">
        <h1>Panes</h1>
        <p>
          A pane floats over the page by default. All of them share one notch at the top of the
          window.
        </p>
      </header>

      <Section title="Placement">
        <p>
          <code>anchor</code> pins a pane to a corner, an edge, or the center, and panes on one
          anchor stack. Drag a title bar to move one. <code>container</code> renders a pane inline,
          like the ones on these pages.
        </p>
        <Code>{`new Pane({ id: 'scene', title: 'Scene', anchor: 'top-right', width: 280 })
new Pane({ title: 'Inline', container: document.querySelector('#controls') })`}</Code>
      </Section>

      <Section title="Sidebar">
        <p>
          The notch's dock button moves every floating pane into a sidebar, and the page reflows
          beside it. One header searches and styles all of them. Drag its edge to resize it. A
          namespace rooted in an element docks inside that element instead, like the windows on the
          overview.
        </p>
        <Code>{SIDEBAR_CODE}</Code>
        <p>
          Fixed bars that span the window move over too, and <code>data-tiao-no-inset</code> opts
          one out. For anything else, use the insets:
        </p>
        <Code>{INSET_CODE}</Code>
      </Section>

      <Section title="Small screens">
        <p>
          Under 768 px, panes stack in a drawer that slides up from the bottom. The tiao button or{' '}
          <kbd>H</kbd> opens it, and the button can be dragged to any corner.
        </p>
      </Section>

      <Section title="Notch">
        <p>
          The bar at the top of the window acts on every pane. <code>notch: false</code> keeps a
          pane from mounting it.
        </p>
        <Table rows={NOTCH} />
      </Section>

      <Section title="Global settings">
        <p>
          The notch's gear styles every pane at once and saves to <code>tiao:notch</code>. A pane's
          own menu can still change its theme, style, or accent.
        </p>
        <Table rows={SETTINGS} />
        <Code>{SETTINGS_CODE}</Code>
      </Section>

      <Section title="Namespaces">
        <p>
          A namespace is a second tiao on the page, with its own panes, notch, undo, and look. Root
          it in an element, and its panes and pins float inside it and scroll with the page. Its
          notch stays shown there, unless <code>hiding</code> lets it follow the Hiding setting. The
          windows on the overview are each one. <kbd>H</kbd> hides the namespace under the pointer.
        </p>
        <Code>{NAMESPACE_CODE}</Code>
      </Section>

      <Section title="Persistence">
        <p>
          A pane with an <code>id</code> saves what you change, along with its position, folders,
          and pins, and restores it on the next load. The notch's reset goes back to the code.{' '}
          <code>persist: false</code> opts out a row, and <code>storage: false</code> a pane.
        </p>
        <p>
          <code>setTiaoStorage(false)</code> keeps all of tiao out of localStorage, so a page starts
          from its code on every load. These docs do. Call it before mounting panes.
        </p>
      </Section>

      <Section title="Pinning">
        <p>
          Right-click a row to pin it, or set <code>binding.pinned = true</code>. A larger copy sits
          at the bottom of the page, or of its namespace's element, and editing either moves both.
        </p>
      </Section>

      <Section title="Theming">
        <p>
          Every color, radius, and size is a CSS variable on <code>.tiao-pane</code>. Right-click a
          title to change theme, style, and accent live.
        </p>
        <Demo paneId="docs-theme" title="Nord" build={buildTheme} />
        <Code>{THEME_CODE}</Code>
      </Section>

      <Section title="Shortcuts">
        <p>Keys are skipped while you type in a field.</p>
        <Table rows={SHORTCUTS} keys />
        <p>
          <code>toggleKey: '`'</code> gives one pane its own key.
        </p>
      </Section>
    </>
  )
}
