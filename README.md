# tiao

A themeable, draggable debug pane for tweaking parameters — tweakpane-style bindings with a modern look, a first-class React API, and a plug-and-play plugin system. Zero dependencies in core.

Built on ideas and code from [tweakpane](https://github.com/cocopon/tweakpane) by [cocopon](https://github.com/cocopon), [leva](https://github.com/pmndrs/leva) by [pmndrs](https://github.com/pmndrs), and [baku89](https://github.com/baku89).

## Install

```sh
npm install @nightmarket/tiao
```

> **Note:** Published as `@nightmarket/tiao` under the Nightmarket npm org.

One package. Import what you need via subpaths:

| Import | What it is |
| --- | --- |
| `@nightmarket/tiao` | Production-safe `mountPane`; lazy in development and a no-op in production |
| `@nightmarket/tiao/core` | Eager `Pane` API for panes that must exist in production |
| `@nightmarket/tiao/react` | Leva-style hooks; UI lazy-loads and tree-shakes out of prod |
| `@nightmarket/tiao/plugin-fps` | FPS graph blade |
| `@nightmarket/tiao/plugin-bezier` | Cubic-bezier easing editor input |
| `@nightmarket/tiao/plugin-radio-grid` | Segmented radio grid input |
| `@nightmarket/tiao/plugin-media` | Image/video upload input (drag & drop) for WebGL/WebGPU textures |
| `@nightmarket/tiao/plugin-thumbnails` | Thumbnail grid input: pick one of a set of picture swatches |
| `@nightmarket/tiao/plugin-camera` | Camera-style ring / wheel number inputs |
| `@nightmarket/tiao/export-pane` | Pre-configured pane that exports a canvas to PNG / WebM / MP4 |
| `@nightmarket/tiao/perf-pane` | Pre-configured pane for canvas/three.js perf: fps, cpu/gpu ms, draw calls, memory |

`@nightmarket/tiao` is ESM-only. Each subpath is a separate entry point, so unused plugins stay out of your bundle.

React is an optional peer dependency and is only needed for `@nightmarket/tiao/react`. MP4 export depends on [`mediabunny`](https://mediabunny.dev), which is loaded lazily so it stays out of your application bundle unless you record MP4.

## Quick start (vanilla)

```ts
import { mountPane } from '@nightmarket/tiao'

const params = {
  speed: 1,
  range: { min: 20, max: 80 },
  enabled: true,
  label: 'hello',
  tint: '#ff8800',
  offset: { x: 0, y: 0 },
  blend: 'multiply',
}

const disposePane = mountPane(
  { title: 'Scene', anchor: 'top-right', toggleKey: '`' },
  (pane) => {
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

    pane.addBinding(params, 'mode', { options: { Orbit: 'orbit', Wave: 'wave' } })
    pane.addBinding(params, 'wavelength', { showIf: () => params.mode === 'wave' })
    pane.addFolder({ title: 'Wave', showIf: () => params.mode === 'wave' })

    const tabs = pane.addTab({ pages: [{ title: 'Monitor' }, { title: 'Look' }] })
    tabs.pages[0].addBinding(stats, 'fps', { readonly: true, view: 'graph' })
    tabs.pages[1].addBinding(params, 'tint')

    pane.on('change', (ev) => console.log(ev.key, ev.value, ev.last))
  },
)

// Call disposePane() when the owning app/component unmounts.
```

Styles are injected automatically on first pane creation. To manage CSS yourself (e.g. CSP without inline styles), `import '@nightmarket/tiao/styles.css'` instead — auto-injection detects it and no-ops.

### Persisted values

Panes with an `id` remember every value you tweak under `tiao:<id>:values` and write it back into the bound object on the next mount, so a reload picks up where you left off. Anything missing (or saved in a shape the binding no longer accepts) falls back to the value the code declares. Monitors never persist, `{ persist: false }` opts a single binding out, and `storage: false` opts the whole pane out. The notch's reset button — `Pane.resetValues()` — puts every value back to its code default, snaps floating panes back to the position their code declared, and clears the saved copies.

Storage stays out of the way of the frame budget: each key is parsed once rather than on every read, writes that change nothing never happen, and a drag writes only the value it settles on — the frames in between are previews. Clearing `localStorage` (from devtools or the app) takes effect immediately; nothing cached is written back.

### Pane chrome

- `anchor`: any corner, side center, or `'center'` (`'top-left'`, `'top-center'`, `'right-center'`, ...), or `container: element` for inline panes
- Hover the title bar for a gear icon (or right-click the pane) to open the Pane Settings panel: toggle dragging, switch themes (system, light, dark, solarized, nord, catppuccin), pick the accent color, and jump between the 9 anchor positions on a mini window that mirrors your viewport's aspect ratio. System follows `prefers-color-scheme` and updates when the OS theme changes.
- The search icon in the title bar opens a filter row: rows are matched by label/title, folders holding a match are forced open, and a folder-title match keeps its whole subtree visible. `pane.filter(query)` / `pane.searchOpen` do the same programmatically
- `draggable: true` (default for floating panes); drag position, anchor, and the draggable toggle persist to `localStorage` when the pane has an `id`
- `toggleKey: '\`'` toggles that pane's visibility; `pane.hidden`, `pane.expanded` are settable
- Press `H` to hide/show all floating panes (skipped while typing); `Pane.toggleAll()` does the same programmatically.
- A small notch at the top edge of the window holds the global controls: hide/show every floating pane (same as `H`), dock/undock them into an inline sidebar the page lays out beside (`Pane.toggleDock()` / `Pane.docked`), a settings gear, and reset every bound value and pane position to its code default (`Pane.resetValues()`). `notch: false` keeps a pane from mounting it.
- The notch gear opens the global settings panel: font size, either `Small` (each pane's own declared size, the default) or `Normal` (every floating pane at size `l`) via `Pane.setFontSize()` / `Pane.fontSize`; hiding, on by default, which makes the notch fully invisible until the pointer comes near the top edge anywhere across the window; glass, off by default, which turns floating panes and the notch translucent and frosted (`Pane.setGlass()` / `Pane.glass`) at the cost of a GPU blur every frame the page underneath changes; plus one theme, style, accent, and numbering for every pane in both views. Each change is broadcast — floating panes, docked panes, and the sidebar all take it and save it as their own, so a later per-pane tweak still sticks, and panes mounted afterwards inherit it unless they have saved chrome of their own. All of it persists under `tiao:notch`.
- Docked panes stack flush and square in the sidebar and hand their chrome over to it: one header search filters every pane at once, one settings menu sets theme, style, accent, and numbering for all of them, and anchors the sidebar left or right. Its outer edge drags to resize (width in `--tiao-dock-width`, default `300px`). All of it is separate state under `tiao:dock` — each pane keeps its floating theme and numbering and gets them back on undock.
- `order: 99` sets where a pane sits in the sidebar (and in a shared-anchor pack), z-index style: lower sorts first, the default is `0`, and panes sharing a value keep their creation order. Panes created while the sidebar is open slot into place rather than landing at the end, and `pane.order` re-sorts a live pane. The export pane defaults to `99` so it stays out of the way at the bottom.
- The sidebar pads `<body>` to reflow the page, which only moves elements in normal flow. Fixed page chrome is laid out against the viewport, so the sidebar insets it directly: any `position: fixed` element that spans the viewport edge to edge (a navbar, a bottom bar) is inset to the remaining width for as long as the panes stay docked, including ones the page mounts later. A corner toast, a centered modal, and anything narrower is left alone, and `data-tiao-no-inset` opts a single element out. Nothing is written to your inline styles — undocking removes the marker and the page is exactly as it was.
- Both are driven by `--tiao-dock-inset-start` and `--tiao-dock-inset-end` on `<html>`, which hold the sidebar's width on the edge it occupies and `0px` on the other, tracking the anchor, live resizes, and `H`. Read them for chrome the heuristic misses — a sidebar of your own, say — alongside `html.tiao-docked` for anything a length can't express.

  ```css
  .my-own-sidebar {
    left: var(--tiao-dock-inset-start, 0px);
  }
  ```
- `maxHeight: 500` (default) caps the pane height; content scrolls when it overflows
- Floating panes that share an anchor pack along that edge with an 8px gap (wrapping to a new column inward if they would leave the viewport). Drag a pane or pick another cell in the 9-point grid to leave the pack.
- Clicking a pane brings it above other overlapping panes
- Multiple panes are independent; `new Pane({ id: 'export' })` registers it for `Pane.get('export')`

### Theming

All styling flows through CSS custom properties on `.tiao-pane` (`--tiao-bg`, `--tiao-accent`, `--tiao-radius`, `--tiao-surface`, ...):

```ts
mountPane({ theme: { accent: '#f0f', '--tiao-width': '320px' } }, (pane) => {
  pane.theme = 'light'      // default 'dark'; also 'system' | 'light' | 'solarized' | 'nord' | 'catppuccin'
  pane.accent = '#ff0080'   // sets --tiao-accent
  pane.style = 'kiki'       // 'bouba' (rounded, default) | 'kiki' (sharp / flat)
})
```

Graph monitors use the theme's neutral gray independently of `pane.accent`, with a light fill (`--tiao-graph-fill-opacity`, default `0.28`) over a barely tinted plot background so overlay labels stay readable. Override `--tiao-graph-accent` or `--tiao-graph-fill-opacity` only when you want a custom look.

Theme, accent, and style are also editable from the Pane Settings panel (gear icon or right-click), and persist to `localStorage` when the pane has an `id`. Style is orthogonal to theme: **Bouba** = rounded corners / soft shadow; **Kiki** = sharp corners / hairline elevation. Either can be frosted with the global Glass setting.

## React

```tsx
import { useControls, button, monitor, tabs } from '@nightmarket/tiao/react'

function ComponentA() {
  // creates the default pane
  const { speed, color, mode, wavelength } = useControls({
    speed: { value: 1, min: 0, max: 2 },
    color: '#f00',
    mode: { value: 'orbit', options: { Orbit: 'orbit', Wave: 'wave' } },
    wavelength: { value: 1, showIf: (get) => get('mode') === 'wave' },
  })
}

function ComponentB() {
  // adds a folder to the same pane from a different component
  const { gravity } = useControls('Physics', { gravity: 9.8 })
}

function WaveExtras() {
  // whole folder is hidden unless Motion.mode is wave
  useControls('Wave', { amplitude: 0.5 }, { showIf: (get) => get('Motion.mode') === 'wave' })
}

function ComponentC() {
  // a separate pane, anchored elsewhere
  const values = useControls(
    'Capture',
    tabs({
      Monitor: { fps: monitor(() => stats.fps, { view: 'graph' }) },
      Actions: { reset: button(() => reset()) },
    }),
    { pane: { id: 'export', anchor: 'bottom-right' } },
  )
}
```

- Folder paths nest and merge: `useControls('Physics.Collisions', ...)` from any number of components lands in one folder; folders are ref-counted and survive sibling unmounts.
- `showIf: (get) => …` hides a row (or a whole folder via hook options). `get('mode')` is folder-relative; `get('Motion.mode')` is absolute. Hidden values stay in the store.
- `tabs({ Page: { … } })` groups rows onto tab pages; pass it as the schema itself or nest it under a key — either way values are flattened into the hook result.
- Re-renders are per-field via `useSyncExternalStore` — only consumers of a changed value update.
- `$set({ key: value })` and `$get('key')` on the returned object for programmatic access.
- `usePane(id)` returns the live `Pane` (or `null` before load) for plugins/custom blades.

### Debug levels

Gating resolves from one canonical env variable, `DEBUG_LEVEL`, read through your bundler's client-exposure prefix — no setup call in application code:

| Bundler | Variable |
| --- | --- |
| Next.js | `NEXT_PUBLIC_DEBUG_LEVEL` |
| Vite | `VITE_DEBUG_LEVEL` |
| Node / tests / custom `define` | `DEBUG_LEVEL` |

- `0` — off: every gate returns false; no UI code loads.
- `1` — armed: off unless the page URL has `?debug` (or `?debug=true`); `?debug=false` keeps it off. The pane lazy-loads only when enabled.
- `2` — on: on unless the URL has `?debug=false`.

Unset falls back to `NODE_ENV`: development is `2`, production is `0`. Override per-hook with `enabled`, or globally with `setTiaoEnabled`. When disabled, hooks return plain default values and none of the DOM/UI code loads.

### Production builds

Production builds go one step further. `@nightmarket/tiao/react` resolves through the `production` export condition to a build with no pane, no manager, and no dynamic `import()` of core, so the UI chunk is never emitted at all — `useControls` still returns values and `$set` still re-renders. Vite applies the condition on its own: the dev server loads the full pane, `vite build` picks the stripped build. Other setups may need it added to their resolve conditions (esbuild `--conditions=production`, `exportConditions` in `@rollup/plugin-node-resolve`, `resolve.conditionNames` in webpack). Without it they fall back to the development build, where core sits behind a dynamic `import()` and is split into a chunk production users never download.

Because that build contains no pane code, `setTiaoEnabled(true)` cannot bring the UI back in it — and neither can level `1` + `?debug=true`. To use level `1` on a production deployment, the bundler must not apply the `production` condition (Next/webpack/turbopack don't by default; in Vite, drop it from `resolve.conditions`). The UI then stays behind the dynamic `import()` and is only fetched when debug is enabled.

The root vanilla API has the same behavior:

```ts
import { mountPane } from '@nightmarket/tiao'

const dispose = mountPane({ title: 'Debug' }, (pane) => {
  buildDebugPane(pane)
})
```

Use `import { Pane } from '@nightmarket/tiao/core'` only when the pane must also exist in production.

## Plugins

```ts
import { addFpsGraph } from '@nightmarket/tiao/plugin-fps'
import { registerBezierPlugin } from '@nightmarket/tiao/plugin-bezier'
import { registerRadioGridPlugin } from '@nightmarket/tiao/plugin-radio-grid'
import { registerMediaPlugin, type MediaValue } from '@nightmarket/tiao/plugin-media'
import { registerThumbnailsPlugin } from '@nightmarket/tiao/plugin-thumbnails'

addFpsGraph(pane)
registerBezierPlugin()
pane.addBinding(params, 'easing', { view: 'bezier' })          // [x1, y1, x2, y2]
registerRadioGridPlugin()
pane.addBinding(params, 'mode', { view: 'radiogrid', options: { Line: 'line', Scatter: 'scatter' } })
registerMediaPlugin()
pane.addBinding(params, 'texture', { view: 'media' })          // MediaValue
registerThumbnailsPlugin()
pane.addBinding(params, 'gradient', {
  view: 'thumbnails',
  options: [
    { text: 'violet', value: 'violet', thumb: 'linear-gradient(135deg, #ddd6fe, #a78bfa)' },
    { text: 'brown', value: 'brown', thumb: '/thumbs/brown.png' },
    { text: 'gray', value: 'gray', thumb: '<svg viewBox="0 0 2 2"><rect width="2" height="2" fill="#999"/></svg>' },
  ],
  columns: 3,   // optional; the grid reflows to the column width without it
  aspect: 1.5,  // optional; thumbnail width / height, defaults to square
  label: '',    // optional; an empty label drops the label column so the grid spans the row
})
```

Each thumbnail is one string: inline `<svg>` markup, an image URL, or any CSS `background` value (gradients, colors). Artwork and caption form a single card, and the selected one gets a ring and an undimmed caption; captions come from `text` and are omitted when it is empty.

The media input takes a png/jpeg/webp image or mp4/webm video via drag & drop or click-to-browse. The bound value becomes the loaded `HTMLImageElement` or `HTMLVideoElement` (`null` when empty) — both are valid WebGL `TexImageSource`s; for WebGPU pass images through `createImageBitmap` and videos through `importExternalTexture`. Videos autoplay muted on loop, so re-uploading the element each frame gives animated textures.

### Writing your own

A plugin claims a `(value, options)` pair and renders a view around a reactive `Value`:

```ts
import { registerPlugin, type InputPlugin } from '@nightmarket/tiao/core'

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
import { createExportPane } from '@nightmarket/tiao/export-pane'

const pane = createExportPane({ target: canvas, filename: 'scene' })
```

Anchored bottom-right by default: PNG export with scale, WebM recording via `MediaRecorder`, and MP4 via WebCodecs + [mediabunny](https://mediabunny.dev) (lazy-loaded; the option hides itself where WebCodecs is unavailable).

## Perf pane

```ts
import { createPerfPane } from '@nightmarket/tiao/perf-pane'

// renderer: three.js WebGLRenderer or WebGPURenderer (duck-typed — no three dependency)
const { pane, perf, dispose } = createPerfPane({ renderer })
```

Anchored top-right by default: filled graphs for FPS, CPU, GPU, and JS heap (with observed range in the label), then flat three.js counters (calls, render calls, triangles, lines, points, geometries, textures, shaders). Rows without a data source skip themselves.

- **FPS** — display frames via `requestAnimationFrame` (not nested `renderer.render` calls from post/shadow passes).
- **CPU ms** — JS time for the full top-level render tree per display frame; pass `instrument: false` to opt out and bracket your frame manually with `perf.begin()` / `perf.end()`.
- **GPU ms** — WebGL2 uses `EXT_disjoint_timer_query_webgl2`; three's WebGPURenderer works when created with `trackTimestamp: true`; or supply your own timer with `gpuTime: () => ms`.
- **Render calls** — `info.render.frameCalls` (WebGPU): how many public `renderer.render()` invocations ran this frame (scene pass + shadow faces + post quads). Triangles/draw calls include all of those passes.
- **GPU memory** — pass `gpuMemory: () => bytes` from your own texture/buffer accounting to add a graph next to JS heap.
- `addPerfMonitors(container, perf)` drops the same rows into a pane or folder you already have; `createPerfMonitor(options)` is the headless sampler if you only want the numbers.

## Development

```sh
pnpm install
pnpm dev          # playground at localhost:5173 (HMR over package sources)
pnpm build        # build the @nightmarket/tiao package for publish
pnpm test         # vitest
pnpm typecheck
```

The playground Vite config aliases `@nightmarket/tiao` / `@nightmarket/tiao/*` to `packages/tiao/src/`, so edits hot-reload without running `pnpm build`.

### Publishing

```sh
pnpm install
pnpm run publish:package
```
