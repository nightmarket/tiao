import type { InputPlugin } from '@nightmarket/tiao/core'
import { addFpsGraph } from '@nightmarket/tiao/plugin-fps'
import type { MediaValue } from '@nightmarket/tiao/plugin-media'
import type { ThumbEntry } from '@nightmarket/tiao/plugin-thumbnails'
import { Code, Reference, type ReferenceProps, Section } from '../ui'

const GRADIENTS: ThumbEntry[] = [
  { text: 'violet', value: 'violet', thumb: 'linear-gradient(135deg, #ddd6fe, #a78bfa)' },
  { text: 'cyan', value: 'cyan', thumb: 'linear-gradient(135deg, #cffafe, #14b8a6)' },
  { text: 'orange', value: 'orange', thumb: 'linear-gradient(135deg, #fed7aa, #f97316)' },
]

const starsPlugin: InputPlugin<number> = {
  id: 'stars',
  type: 'input',
  accept: (value, options) => typeof value === 'number' && options.view === 'stars',
  create(ctx) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'docs-stars'
    const render = (v: number) => {
      el.textContent = '★'.repeat(v) + '☆'.repeat(5 - v)
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))
    el.addEventListener('click', () => {
      ctx.value.set((ctx.value.get() % 5) + 1, { source: 'ui', last: true })
    })
    return { element: el }
  },
}

const STARS_CODE = `import { registerPlugin, type InputPlugin } from '@nightmarket/tiao/core'

const starsPlugin: InputPlugin<number> = {
  id: 'stars',
  type: 'input', // 'input' | 'monitor' | 'blade'
  accept: (value, options) => typeof value === 'number' && options.view === 'stars',
  create(ctx) {
    const el = document.createElement('button')
    const render = (v: number) => (el.textContent = '★'.repeat(v) + '☆'.repeat(5 - v))
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))
    el.onclick = () => ctx.value.set((ctx.value.get() % 5) + 1, { source: 'ui', last: true })
    return { element: el } // { element, full: true } owns the whole row
  },
}

registerPlugin(starsPlugin) // every pane; pane.registerPlugin() for one
pane.addBinding({ rating: 3 }, 'rating', { view: 'stars' })`

const PLUGINS: ReferenceProps[] = [
  {
    name: 'Bezier',
    type: '[x1, y1, x2, y2]',
    code: `import { registerBezierPlugin } from '@nightmarket/tiao/plugin-bezier'

registerBezierPlugin()
pane.addBinding({ easing: [0.25, 0.1, 0.25, 1] }, 'easing', { view: 'bezier' })`,
    build: (pane) => {
      pane.addBinding({ easing: [0.25, 0.1, 0.25, 1] }, 'easing', { view: 'bezier' })
    },
    about: 'A cubic-bezier easing editor. Drag the two handles, or type the four numbers.',
  },
  {
    name: 'Radio grid',
    type: 'options',
    code: `import { registerRadioGridPlugin } from '@nightmarket/tiao/plugin-radio-grid'

registerRadioGridPlugin()
pane.addBinding({ quality: 'medium' }, 'quality', {
  view: 'radiogrid',
  options: { Low: 'low', Medium: 'medium', High: 'high' },
  columns: 3,
})`,
    build: (pane) => {
      pane.addBinding({ quality: 'medium' }, 'quality', {
        view: 'radiogrid',
        options: { Low: 'low', Medium: 'medium', High: 'high' },
        columns: 3,
      })
    },
    about: 'Every option on screen at once, as a segmented grid, for short lists.',
  },
  {
    name: 'Thumbnails',
    type: 'options',
    code: `import { registerThumbnailsPlugin } from '@nightmarket/tiao/plugin-thumbnails'

registerThumbnailsPlugin()
pane.addBinding({ gradient: 'violet' }, 'gradient', {
  view: 'thumbnails',
  options: [
    { text: 'violet', value: 'violet', thumb: 'linear-gradient(135deg, #ddd6fe, #a78bfa)' },
    { text: 'cyan', value: 'cyan', thumb: 'linear-gradient(135deg, #cffafe, #14b8a6)' },
    { text: 'orange', value: 'orange', thumb: 'linear-gradient(135deg, #fed7aa, #f97316)' },
  ],
  aspect: 1.5,
})`,
    build: (pane) => {
      pane.addBinding({ gradient: 'violet' }, 'gradient', {
        view: 'thumbnails',
        options: GRADIENTS,
        aspect: 1.5,
      })
    },
    about: (
      <>
        Pick a picture. A <code>thumb</code> is inline SVG, an image URL, or a CSS background.{' '}
        <code>label: ''</code> lets the grid span the row.
      </>
    ),
  },
  {
    name: 'Media',
    type: 'image | video',
    code: `import { registerMediaPlugin, type MediaValue } from '@nightmarket/tiao/plugin-media'

registerMediaPlugin()
pane.addBinding({ texture: null as MediaValue }, 'texture', { view: 'media' })`,
    build: (pane) => {
      pane.addBinding({ texture: null as MediaValue }, 'texture', { view: 'media' })
    },
    about: (
      <>
        Drop in an image or video. The value is the loaded <code>HTMLImageElement</code> or{' '}
        <code>HTMLVideoElement</code>, ready to use as a texture. Videos loop muted.
      </>
    ),
  },
  {
    name: 'Camera',
    type: 'number',
    code: `import { registerCameraPlugin } from '@nightmarket/tiao/plugin-camera'

registerCameraPlugin()
const lens = { focalLength: 55, fStop: 1.8 }
pane.addBinding(lens, 'focalLength', { view: 'cameraring' })
pane.addBinding(lens, 'fStop', { view: 'camerawheel', amount: 0.01, min: 0 })`,
    build: (pane) => {
      const lens = { focalLength: 55, fStop: 1.8 }
      pane.addBinding(lens, 'focalLength', { view: 'cameraring' })
      pane.addBinding(lens, 'fStop', { view: 'camerawheel', amount: 0.01, min: 0 })
    },
    about: 'A lens ring and a thumb wheel, for numbers you nudge. Drag either sideways.',
  },
  {
    name: 'FPS',
    type: 'monitor',
    code: `import { addFpsGraph } from '@nightmarket/tiao/plugin-fps'

addFpsGraph(pane)`,
    build: (pane) => {
      addFpsGraph(pane)
    },
    about: 'A frame-rate graph timed off requestAnimationFrame.',
  },
  {
    name: 'Stars',
    type: 'custom',
    code: STARS_CODE,
    build: (pane) => {
      pane.registerPlugin(starsPlugin)
      pane.addBinding({ rating: 3 }, 'rating', { view: 'stars' })
    },
    about: (
      <>
        Your own control: <code>accept</code> claims a value and <code>create</code> renders it. The
        last plugin registered wins, so one can replace a built-in.
      </>
    ),
  },
]

export function Plugins() {
  return (
    <>
      <header className="docs-hero">
        <h1>Plugins</h1>
        <p>
          Each plugin is its own import. Register it once, then pick it with <code>view</code>.
        </p>
      </header>
      {PLUGINS.map((plugin) => (
        <Reference key={plugin.name} {...plugin} />
      ))}
      <Section title="Perf and export panes">
        <p>
          The perf pane graphs fps, CPU and GPU time, and memory, and counts three.js draw calls.
          The export pane saves a canvas as PNG, WebM, or MP4.
        </p>
        <Code>{`import { createPerfPane } from '@nightmarket/tiao/perf-pane'
import { createExportPane } from '@nightmarket/tiao/export-pane'

const perf = createPerfPane({ renderer }) // a three.js WebGL or WebGPU renderer
const exporter = createExportPane({ target: canvas, filename: 'scene' })`}</Code>
      </Section>
    </>
  )
}
