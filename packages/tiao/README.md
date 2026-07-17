# tiao

A themeable, draggable debug pane with a vanilla TypeScript API, React hooks,
performance and export panes, and optional input plugins.

```sh
npm install @nightmarket/tiao
```

```ts
import { Pane } from '@nightmarket/tiao'

const pane = new Pane({ title: 'Debug' })
pane.addBinding(params, 'speed', { min: 0, max: 4 })
```

Everything ships in one package with tree-shakeable subpath exports:

- `@nightmarket/tiao` — core pane API
- `@nightmarket/tiao/react` — React hooks
- `@nightmarket/tiao/perf-pane` — performance monitors
- `@nightmarket/tiao/export-pane` — PNG, WebM, and MP4 export
- `@nightmarket/tiao/plugin-fps`
- `@nightmarket/tiao/plugin-bezier`
- `@nightmarket/tiao/plugin-radio-grid`
- `@nightmarket/tiao/plugin-media`
- `@nightmarket/tiao/plugin-camera`
- `@nightmarket/tiao/styles.css` — optional static stylesheet

The package is ESM-only.

React is an optional peer dependency and is only required for
`@nightmarket/tiao/react`. The core injects its styles automatically; importing
`@nightmarket/tiao/styles.css` disables that runtime injection.

See the [full documentation](https://github.com/nightmarket/tiao#readme).
