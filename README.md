# tiao

A themeable, draggable debug pane for tweaking parameters — tweakpane-style bindings with a modern look, a first-class React API, and a plug-and-play plugin system. Zero dependencies in core.

| Package | What it is |
| --- | --- |
| `@tiao/core` | Vanilla TS pane: bindings, folders, tabs, monitors, theming, drag/anchor/hide |
| `@tiao/react` | Leva-style hooks on top of core; UI lazy-loads and tree-shakes out of prod |
| `@tiao/plugin-fps` | FPS graph blade |
| `@tiao/plugin-bezier` | Cubic-bezier easing editor input |
| `@tiao/plugin-radio-grid` | Segmented radio grid input |
| `@tiao/plugin-media` | Image/video upload input (drag & drop) for WebGL/WebGPU textures |
| `@tiao/export-pane` | Pre-configured pane that exports a canvas to PNG / WebM / MP4 |
| `@tiao/perf-pane` | Pre-configured pane for canvas/three.js perf: fps, cpu/gpu ms, draw calls, memory |

## Quick start (vanilla)

```ts
import { Pane } from '@tiao/core'

const params = {
  speed: 1,
  range: { min: 20, max: 80 },
  enabled: true,
  label: 'hello',
  tint: '#ff8800',
  offset: { x: 0, y: 0 },
  blend: 'multiply',
}

const pane = new Pane({ title: 'Scene', anchor: 'top-right', toggleKey: '`' })

pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 }) // fill slider
pane.addBinding(params, 'range', { min: 0, max: 100, step: 1 })  // interval ({ min, max } value)
pane.addBinding(params, 'enabled')                               // check toggle
pane.addBinding(params, 'label')                                 // text input
pane.addBinding(params, 'tint')                                  // color picker (auto-detected)
pane.addBinding(params, 'accent')                                // 'oklch(0.7 0.15 200)' / 'oklab(...)' open a gamut-aware OKLCH picker
pane.addBinding(params, 'offset', { x: { min: -1, max: 1 }, y: { min: -1, max: 1 } })
pane.addBinding(params, 'yaw', { view: 'angle' }) // circular angle overlay (degrees; unit: 'rad' for radians)
pane.addBinding(params, 'blend', { options: { Multiply: 'multiply', Screen: 'screen' } })

const folder = pane.addFolder({ title: 'Advanced', expanded: false }) // collapsible: false pins a section open
folder.addBinding(stats, 'fps', { readonly: true, view: 'graph', min: 0, max: 120 })

pane.addButton({ title: 'Reset' }).on('click', reset)
pane.addButtonGroup({ label: 'zoom', buttons: { '0.5x': () => zoom(0.5), '1x': () => zoom(1) } })
pane.on('change', (ev) => console.log(ev.key, ev.value, ev.last))

pane.dispose() // full cleanup
```

Styles are injected automatically on first pane creation. To manage CSS yourself (e.g. CSP without inline styles), `import '@tiao/core/styles.css'` instead — auto-injection detects it and no-ops.

### Pane chrome

- `anchor`: any corner, side center, or `'center'` (`'top-left'`, `'top-center'`, `'right-center'`, ...), or `container: element` for inline panes
- Hover the title bar for a gear icon (or right-click the pane) to open the Pane Settings panel: toggle dragging, switch themes (light, dark, solarized, nord, catppuccin), pick the accent color, and jump between the 9 anchor positions on a mini window that mirrors your viewport's aspect ratio
- The search icon in the title bar opens a filter row: rows are matched by label/title, folders holding a match are forced open, and a folder-title match keeps its whole subtree visible. `pane.filter(query)` / `pane.searchOpen` do the same programmatically
- `draggable: true` (default for floating panes); drag position, anchor, and the draggable toggle persist to `localStorage` when the pane has an `id`
- `toggleKey: '\`'` toggles that pane's visibility; `pane.hidden`, `pane.expanded` are settable
- Press `H` to hide/show all floating panes (skipped while typing). Hiding shows a brief "Press H to show debug panes" tip; `Pane.toggleAll()` does the same programmatically.
- `maxHeight: 500` (default) caps the pane height; content scrolls when it overflows
- Clicking a pane brings it above other overlapping panes
- Multiple panes are independent; `new Pane({ id: 'export' })` registers it for `Pane.get('export')`

### Theming

All styling flows through CSS custom properties on `.tiao-pane` (`--tiao-bg`, `--tiao-accent`, `--tiao-radius`, `--tiao-surface`, ...):

```ts
new Pane({ theme: { accent: '#f0f', '--tiao-width': '320px' } })
pane.theme = 'light'      // default 'dark'; also 'light' | 'solarized' | 'nord' | 'catppuccin'
pane.accent = '#ff0080'   // sets --tiao-accent
pane.style = 'kiki'       // 'bouba' (rounded glass, default) | 'kiki' (sharp / flat)
```

Graph monitors use the theme's neutral gray independently of `pane.accent`, with a light fill (`--tiao-graph-fill-opacity`, default `0.28`) over a barely tinted plot background so overlay labels stay readable. Override `--tiao-graph-accent` or `--tiao-graph-fill-opacity` only when you want a custom look.

Theme, accent, and style are also editable from the Pane Settings panel (gear icon or right-click), and persist to `localStorage` when the pane has an `id`. Style is orthogonal to theme: **Bouba** = rounded glass; **Kiki** = sharp corners / hairline elevation / no blur.

## React

```tsx
import { useControls, button, monitor } from '@tiao/react'

function ComponentA() {
  // creates the default pane
  const { speed, color } = useControls({
    speed: { value: 1, min: 0, max: 2 },
    color: '#f00',
  })
}

function ComponentB() {
  // adds a folder to the same pane from a different component
  const { gravity } = useControls('Physics', { gravity: 9.8 })
}

function ComponentC() {
  // a separate pane, anchored elsewhere
  const values = useControls(
    'Capture',
    { fps: monitor(() => stats.fps, { view: 'graph' }), reset: button(() => reset()) },
    { pane: { id: 'export', anchor: 'bottom-right' } },
  )
}
```

- Folder paths nest and merge: `useControls('Physics.Collisions', ...)` from any number of components lands in one folder; folders are ref-counted and survive sibling unmounts.
- Re-renders are per-field via `useSyncExternalStore` — only consumers of a changed value update.
- `$set({ key: value })` and `$get('key')` on the returned object for programmatic access.
- `usePane(id)` returns the live `Pane` (or `null` before load) for plugins/custom blades.

### Production builds

`useControls` is enabled when `NODE_ENV !== 'production'` (override per-hook with `enabled`, or globally with `setTiaoEnabled`). When disabled, hooks return plain default values and none of the DOM/UI code loads — `@tiao/core` is behind a dynamic `import()`, so bundlers split it into a chunk that prod users never download.

The vanilla equivalent:

```ts
if (import.meta.env.DEV) {
  const { Pane } = await import('@tiao/core')
  buildDebugPane(new Pane())
}
```

## Plugins

```ts
import { addFpsGraph } from '@tiao/plugin-fps'
import { registerBezierPlugin } from '@tiao/plugin-bezier'
import { registerRadioGridPlugin } from '@tiao/plugin-radio-grid'
import { registerMediaPlugin, type MediaValue } from '@tiao/plugin-media'

addFpsGraph(pane)
registerBezierPlugin()
pane.addBinding(params, 'easing', { view: 'bezier' })          // [x1, y1, x2, y2]
registerRadioGridPlugin()
pane.addBinding(params, 'mode', { view: 'radiogrid', options: { Line: 'line', Scatter: 'scatter' } })
registerMediaPlugin()
pane.addBinding(params, 'texture', { view: 'media' })          // MediaValue
```

The media input takes a png/jpeg/webp image or mp4/webm video via drag & drop or click-to-browse. The bound value becomes the loaded `HTMLImageElement` or `HTMLVideoElement` (`null` when empty) — both are valid WebGL `TexImageSource`s; for WebGPU pass images through `createImageBitmap` and videos through `importExternalTexture`. Videos autoplay muted on loop, so re-uploading the element each frame gives animated textures.

### Writing your own

A plugin claims a `(value, options)` pair and renders a view around a reactive `Value`:

```ts
import { registerPlugin, type InputPlugin } from '@tiao/core'

const starsPlugin: InputPlugin<number> = {
  id: 'stars',
  type: 'input', // 'input' | 'monitor' | 'blade'
  accept: (value, options) => typeof value === 'number' && options.view === 'stars',
  create(ctx) {
    const el = document.createElement('div')
    const render = (v: number) => (el.textContent = '★'.repeat(v))
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))
    // write with ctx.value.set(v, { source: 'ui', last: true })
    return { element: el } // { full: true } to own the whole row
  },
}

registerPlugin(starsPlugin)        // global
pane.registerPlugin(starsPlugin)   // or per-pane
```

Registration is last-wins, so your plugin can override built-ins. Built-in controls use the exact same API.

## Export pane

```ts
import { createExportPane } from '@tiao/export-pane'

const pane = createExportPane({ target: canvas, filename: 'scene' })
```

Anchored bottom-right by default: PNG export with scale, WebM recording via `MediaRecorder`, and MP4 via WebCodecs + [mediabunny](https://mediabunny.dev) (lazy-loaded; the option hides itself where WebCodecs is unavailable).

## Perf pane

```ts
import { createPerfPane } from '@tiao/perf-pane'

// renderer: three.js WebGLRenderer or WebGPURenderer (duck-typed — no three dependency)
const { pane, perf, dispose } = createPerfPane({ renderer })
```

Anchored top-right by default: an All / FPS / Memory / Perf tab group for the graphs (FPS, CPU, GPU, JS heap), then flat three.js counters (calls, triangles, lines, points, geometries, textures, shaders). Rows without a data source skip themselves.

- **FPS** — completed `renderer.render` calls per sampling window, matching the begin/end counting model used by stats.js.
- **CPU ms** — `renderer.render` is wrapped automatically; pass `instrument: false` to opt out and bracket your frame manually with `perf.begin()` / `perf.end()`.
- **GPU ms** — WebGL2 uses `EXT_disjoint_timer_query_webgl2`; three's WebGPURenderer works when created with `trackTimestamp: true`; or supply your own timer with `gpuTime: () => ms`.
- **GPU memory** — pass `gpuMemory: () => bytes` from your own texture/buffer accounting to add a graph next to JS heap.
- `addPerfMonitors(container, perf)` drops the same rows into a pane or folder you already have; `createPerfMonitor(options)` is the headless sampler if you only want the numbers.

## Development

```sh
pnpm install
pnpm dev          # playground at localhost:5173 (HMR over package sources)
pnpm build        # build packages for publish / consumers of dist
pnpm test         # vitest
pnpm typecheck
```

The playground Vite config aliases `@tiao/*` to each package's `src/`, so edits under `packages/` hot-reload without running `pnpm build`.
