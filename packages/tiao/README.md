# tiao

A themeable, draggable debug pane with a vanilla TypeScript API, React hooks,
performance and export panes, and optional input plugins.

```sh
npm install tiao-tiao
```

```ts
import { Pane } from 'tiao-tiao'

const pane = new Pane({ title: 'Debug' })
pane.addBinding(params, 'speed', { min: 0, max: 4 })
```

Everything ships in one package with tree-shakeable subpath exports:

- `tiao-tiao` — core pane API
- `tiao-tiao/react` — React hooks
- `tiao-tiao/perf-pane` — performance monitors
- `tiao-tiao/export-pane` — PNG, WebM, and MP4 export
- `tiao-tiao/plugin-fps`
- `tiao-tiao/plugin-bezier`
- `tiao-tiao/plugin-radio-grid`
- `tiao-tiao/plugin-media`
- `tiao-tiao/plugin-camera`
- `tiao-tiao/styles.css` — optional static stylesheet

The package is ESM-only.

React is an optional peer dependency and is only required for
`tiao-tiao/react`. The core injects its styles automatically; importing
`tiao-tiao/styles.css` disables that runtime injection.

See the [full documentation](https://github.com/shampliu/tiao#readme).
