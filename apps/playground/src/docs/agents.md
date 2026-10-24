# tiao

tiao is a debug pane for tuning parameters while the page runs: bind properties of plain objects to controls, and read them back where you use them. Reach for it for anything tuned by eye (animation timing, shader uniforms, spacing, colors) instead of hardcoding numbers and reloading.

## Install

```sh
npm install @nightmarket/tiao
```

## Pick an entry point

- `@nightmarket/tiao`: `mountPane(options, setup)`. Lazy in development, a no-op in production. The default.
- `@nightmarket/tiao/react`: `useControls(schema)` returns the values; only components that read a changed value re-render.
- `@nightmarket/tiao/core`: the eager `Pane` class, only for panes that must ship to production.
- Plugins (`plugin-bezier`, `plugin-radio-grid`, `plugin-thumbnails`, `plugin-media`, `plugin-camera`, `plugin-fps`), `perf-pane`, and `export-pane` are separate entry points.

## Vanilla

```ts
import { mountPane } from '@nightmarket/tiao'

const params = { speed: 1, tint: '#ff8800', offset: { x: 0, y: 0 } }

const dispose = mountPane({ id: 'scene', title: 'Scene' }, (pane) => {
  pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
  pane.addBinding(params, 'tint')
  pane.addBinding(params, 'offset', { x: { min: -1, max: 1 }, y: { min: -1, max: 1 } })
  pane.on('change', (ev) => console.log(ev.key, ev.value))
})
```

The pane writes into `params`, so read it where the value is used, such as every frame of a render loop.

## React

```tsx
import { button, monitor, tabs, useControls } from '@nightmarket/tiao/react'

const { speed, color } = useControls('Motion', {
  speed: { value: 1, min: 0, max: 2 },
  color: '#f00',
})
```

A path as the first argument makes a folder that any component can add to. `{ pane: { id, anchor } }` as the third argument sends rows to a separate pane.

## Controls come from the value

- Number with `min` and `max`: slider. Without: scrubber. `view: 'angle'`: dial.
- Boolean: switch. String: text field, or a color picker when it parses as hex, rgb, hsl, or oklch.
- `{ min, max }`: range. `{ x, y }` or `{ x, y, z }`: vector; ranges on x and y add a pad.
- `options: { Label: value }`: dropdown. `view: 'radiogrid'` (plugin) for short lists.
- `readonly: true`: monitor. Add `view: 'graph'` to plot it.
- `pane.addFolder({ title })`, `pane.addTab({ pages })`, `pane.addButton({ title }).on('click', fn)`, `pane.addButtonGroup({ buttons })`.
- `showIf: () => boolean` hides a row or folder while it returns false.

## Plugins

Register once, then ask for the control by `view`:

```ts
import { registerBezierPlugin } from '@nightmarket/tiao/plugin-bezier'

registerBezierPlugin()
pane.addBinding(params, 'easing', { view: 'bezier' }) // [x1, y1, x2, y2]
```

## Conventions

- Give every pane an `id`. Its values persist under `tiao:<id>:values` and come back on reload; the value in code is the default. `persist: false` opts one row out.
- One pane per system (scene, post, camera), each on its own `anchor` (`'top-right'`, `'bottom-left'`, ...). Group rows with folders and tabs rather than label prefixes.
- Keep the UI out of production: use `mountPane` or the hooks, not `/core`. `DEBUG_LEVEL` (`NEXT_PUBLIC_DEBUG_LEVEL`, `VITE_DEBUG_LEVEL`) gates it: `0` off, `1` only with `?debug` in the URL, `2` on.
- Build a pane once and bind it to a stable object. Dispose what you mount (the function `mountPane` returns, or `pane.dispose()`), so effects and hot reloads don't stack panes.

## Keys

Tap `T` twice to search every row, `H` hides the floating panes, and right-clicking a row pins or resets it.

Docs: https://github.com/nightmarket/tiao
