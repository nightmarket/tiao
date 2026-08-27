import { useEffect, useRef } from 'react'
import { Pane } from '@nightmarket/tiao/core'
import { createExportPane } from '@nightmarket/tiao/export-pane'
import { createPerfPane } from '@nightmarket/tiao/perf-pane'
import { addFpsGraph } from '@nightmarket/tiao/plugin-fps'
import { type MediaValue } from '@nightmarket/tiao/plugin-media'
import { type ThumbEntry } from '@nightmarket/tiao/plugin-thumbnails'
import { buttonGroup, monitor, tabs, useControls } from '@nightmarket/tiao/react'

/** Decorative looping gradient so export/FPS have frames — not a scene to debug. */
function startBackdrop(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')!
  let raf = 0
  const resize = () => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
  }
  const draw = (now: number) => {
    const { width: w, height: h } = canvas
    const hue = (now / 40) % 360
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, `hsl(${hue} 38% 10%)`)
    g.addColorStop(1, `hsl(${(hue + 48) % 360} 46% 18%)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    raf = requestAnimationFrame(draw)
  }
  resize()
  window.addEventListener('resize', resize)
  raf = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
  }
}

const CITIES = [
  'Amsterdam', 'Athens', 'Auckland', 'Bangkok', 'Barcelona', 'Beijing',
  'Berlin', 'Bogotá', 'Boston', 'Brussels', 'Buenos Aires', 'Cairo',
  'Cape Town', 'Chicago', 'Copenhagen', 'Dubai', 'Dublin', 'Helsinki',
  'Hong Kong', 'Istanbul', 'Jakarta', 'Johannesburg', 'Kyoto', 'Lagos',
  'Lisbon', 'London', 'Los Angeles', 'Madrid', 'Melbourne', 'Mexico City',
  'Milan', 'Montreal', 'Mumbai', 'Nairobi', 'New York', 'Oslo', 'Paris',
  'Prague', 'Rio de Janeiro', 'Rome', 'San Francisco', 'Santiago',
  'São Paulo', 'Seoul', 'Shanghai', 'Singapore', 'Stockholm', 'Sydney',
  'Taipei', 'Tokyo', 'Toronto', 'Vancouver', 'Vienna', 'Warsaw', 'Zurich',
] as const

const DOT_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#1f2937"/><circle cx="4" cy="4" r="2.2" fill="#fbbf24"/></svg>',
)}`

const GRADIENTS: ThumbEntry[] = [
  { text: 'violet', value: 'violet', thumb: 'linear-gradient(135deg, #ddd6fe, #a78bfa)' },
  { text: 'magenta', value: 'magenta', thumb: 'linear-gradient(135deg, #fbcfe8, #db2777)' },
  { text: 'cyan', value: 'cyan', thumb: 'linear-gradient(135deg, #cffafe, #14b8a6)' },
  { text: 'orange', value: 'orange', thumb: 'linear-gradient(135deg, #fed7aa, #f97316)' },
  {
    text: 'checker',
    value: 'checker',
    thumb: `<svg viewBox="0 0 2 2"><rect width="2" height="2" fill="#e5e5e5"/><rect width="1" height="1" fill="#737373"/><rect x="1" y="1" width="1" height="1" fill="#737373"/></svg>`,
  },
  { text: 'dot', value: 'dot', thumb: DOT_SRC },
]

function buildControls(): Pane {
  const pane = new Pane({
    id: 'showcase-controls',
    title: 'Controls',
    anchor: 'top-left',
    toggleKey: '`',
    width: 300,
    order: 0,
  })

  const params = {
    opacity: 0.8,
    enabled: true,
    threshold: 0.75,
    exposure: 0.6,
    iterations: 12,
    seed: 42,
    clipRange: { min: 20, max: 80 },
    percent: 0.42,
    label: 'hello tiao',
    blend: 'multiply',
    city: 'tokyo',
    tint: '#ff8800',
    fade: '#22d3ee',
    glow: 'rgba(120, 200, 255, 0.5)',
    sky: 'hsl(200, 80%, 60%)',
    warm: { h: 30, s: 90, v: 95 },
    lch: 'oklch(0.7 0.15 200)',
    offset: { x: 0.2, y: -0.3 },
    rotation: { x: 0, y: 15, z: 0 },
    angle: 45,
    placeholder: 'collapsed folder body',
    locked: 0.5,
    secret: 'now you see me',
    draft: 'ephemeral',
  }

  pane.addBinding(params, 'opacity', { min: 0, max: 1, step: 0.01, label: 'Opacity (slider)' })
  pane.addBinding(params, 'enabled', { label: 'Enabled' })
  pane.addBinding(params, 'threshold', {
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Threshold (shown when Enabled)',
    showIf: () => params.enabled,
  })

  const numbers = pane.addFolder({ title: 'Numbers' })
  numbers.addBinding(params, 'exposure', { min: 0, max: 1, step: 0.01, label: 'Exposure (slider)' })
  numbers.addBinding(params, 'iterations', { min: 1, max: 64, step: 1, label: 'Iterations (int)' })
  numbers.addBinding(params, 'seed', { label: 'Seed (free scrubber)' })
  numbers.addBinding(params, 'clipRange', { min: 0, max: 100, step: 1, label: 'Clip Range' })
  numbers.addBinding(params, 'percent', {
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Percent (formatted)',
    format: (v: number) => `${Math.round(v * 100)}%`,
  })

  const text = pane.addFolder({ title: 'Text & Choice' })
  text.addBinding(params, 'label', { label: 'Label' })
  text.addBinding(params, 'blend', {
    label: 'Blend Mode',
    options: { Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay' },
  })
  text.addBinding(params, 'city', {
    label: 'City (long list)',
    options: Object.fromEntries(
      CITIES.map((name) => [name, name.toLowerCase().replace(/\s+/g, '-')]),
    ),
  })

  const colors = pane.addFolder({ title: 'Colors (Non-collapsible)', collapsible: false })
  colors.addBinding(params, 'tint', { label: 'Tint (hex)' })
  colors.addBinding(params, 'fade', { label: 'Fade (hex + alpha)', color: { alpha: true } })
  colors.addBinding(params, 'glow', { label: 'Glow (rgba)' })
  colors.addBinding(params, 'sky', { label: 'Sky (hsl)' })
  colors.addBinding(params, 'warm', { label: 'Warm (hsv object)' })
  colors.addBinding(params, 'lch', { label: 'Lch (oklch)' })

  const vectors = pane.addFolder({ title: 'Vectors (Tinted)', color: '#fb923c' })
  vectors.addBinding(params, 'offset', {
    label: 'Offset',
    x: { min: -1, max: 1, step: 0.01 },
    y: { min: -1, max: 1, step: 0.01 },
  })
  vectors.addBinding(params, 'angle', { view: 'angle', step: 1, label: 'Angle' })
  const nested = vectors.addFolder({ title: 'Nested' })
  nested.addBinding(params, 'rotation', { step: 1, label: 'Rotation' })
  const deeper = nested.addFolder({ title: 'Deeper (level 3)' })
  deeper.addBinding(params, 'iterations', { min: 1, max: 64, step: 1, label: 'Depth' })

  const collapsed = pane.addFolder({ title: 'Collapsed by Default (expanded: false)', expanded: false })
  collapsed.addBinding(params, 'placeholder', { label: 'Placeholder' })

  const visibility = pane.addFolder({ title: 'Visibility' })
  visibility.addBinding(params, 'locked', {
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Locked (disabled)',
    disabled: true,
  })
  const secret = visibility.addBinding(params, 'secret', { label: 'Secret (hidden)', hidden: true })
  visibility.addButton({ title: 'Toggle hidden row' }).on('click', () => {
    secret.hidden = !secret.hidden
  })
  visibility.addBinding(params, 'draft', { label: 'Draft (not persisted)', persist: false })

  pane.addSeparator()
  pane.addButton({ title: 'Log params' }).on('click', () => console.log({ ...params }))
  pane.addButtonGroup({
    label: 'Exposure presets',
    buttons: {
      Low: () => {
        params.exposure = 0.2
        pane.refresh()
      },
      Mid: () => {
        params.exposure = 0.6
        pane.refresh()
      },
      High: () => {
        params.exposure = 1
        pane.refresh()
      },
    },
  })

  return pane
}

function buildCameraPlugins(): Pane {
  const pane = new Pane({
    id: 'showcase-plugins',
    title: 'Camera & Plugins',
    anchor: 'top-left',
    width: 300,
    order: 1,
  })

  const params = {
    fov: 50,
    focalLength: 55,
    fStop: 1.8,
    easing: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    quality: 'medium',
    gradient: 'violet',
    swatch: 'checker',
    texture: null as MediaValue,
  }

  addFpsGraph(pane, { label: 'FPS' })
  addFpsGraph(pane)

  pane.addBinding(params, 'fov', { min: 10, max: 120, step: 1, label: 'Camera FOV' })
  pane.addBinding(params, 'focalLength', { view: 'cameraring', series: 0, label: 'Focal Length (series 0)' })
  pane.addBinding(params, 'focalLength', {
    view: 'cameraring',
    series: 1,
    label: 'Focal Length (series 1)',
    unit: { ticks: 10, pixels: 40, value: 0.2 },
    min: 1,
    step: 0.02,
  })
  pane.addBinding(params, 'focalLength', { view: 'cameraring', series: 2, label: 'Focal Length (series 2)' })
  pane.addBinding(params, 'focalLength', { view: 'cameraring', wide: true, label: 'Focal Length (wide)' })
  pane.addBinding(params, 'fStop', {
    view: 'camerawheel',
    label: 'F-Stop',
    amount: 0.01,
    min: 0,
  })

  pane.addBinding(params, 'easing', { view: 'bezier', label: 'Easing' })
  pane.addBinding(params, 'quality', {
    view: 'radiogrid',
    options: { Low: 'low', Medium: 'medium', High: 'high' },
    columns: 3,
    label: 'Quality',
  })
  pane.addBinding(params, 'gradient', { view: 'thumbnails', options: GRADIENTS, aspect: 1.4, label: 'Gradient' })
  pane.addBinding(params, 'swatch', { view: 'thumbnails', options: GRADIENTS, label: '' })
  pane.addBinding(params, 'texture', { view: 'media', label: 'Texture' })

  return pane
}

function buildMonitors(): Pane {
  const pane = new Pane({
    id: 'showcase-monitors',
    title: 'Monitors',
    anchor: 'top-left',
    width: 300,
    order: 2,
  })

  const params = { time: 0 }
  const ticker = setInterval(() => {
    params.time = performance.now() / 1000
  }, 50)
  pane.onDispose(() => clearInterval(ticker))

  const pages = pane.addTab({ pages: [{ title: 'Live' }, { title: 'Info' }] })
  pages.pages[0]!.addBinding(params, 'time', { readonly: true, label: 'Time' })
  pages.pages[0]!.addBinding(params, 'time', {
    readonly: true,
    view: 'graph',
    label: 'Time (graph)',
    unit: 's',
  })
  pages.pages[0]!.addBinding(params, 'time', {
    readonly: true,
    label: 'Time (log)',
    bufferSize: 10,
    interval: 500,
    format: (v: number) => v.toFixed(2),
  })
  pages.pages[1]!.addBinding(
    { note: 'right-click a pane header for theme / accent / settings' },
    'note',
    { readonly: true, label: 'Hint' },
  )

  return pane
}

function buildKiki(): Pane {
  const pane = new Pane({
    id: 'showcase-kiki',
    title: 'Kiki / Small (pane options)',
    anchor: 'bottom-left',
    style: 'kiki',
    size: 's',
    theme: { '--tiao-accent': '#e879f9' },
    width: 240,
  })
  const params = { scale: 1, accentNote: 'accent via theme token' }
  pane.addBinding(params, 'scale', { min: 0.25, max: 2, step: 0.05, label: 'Scale' })
  pane.addBinding(params, 'accentNote', { label: 'Note' })
  return pane
}

function useReactApiDemo() {
  const controls = useControls(
    {
      label: { value: 'hello tiao', label: 'Label' },
      opacity: { value: 0.8, min: 0, max: 1, step: 0.01, label: 'Opacity (slider)' },
      presets: buttonGroup(
        {
          Soft: () => controls.$set({ opacity: 0.3 }),
          Mid: () => controls.$set({ opacity: 0.6 }),
          Hard: () => controls.$set({ opacity: 1 }),
        },
        'Opacity presets',
      ),
      pages: tabs({
        Motion: {
          speed: { value: 1, min: 0, max: 4, step: 0.01 },
          running: true,
        },
        Monitor: {
          elapsed: monitor(() => performance.now() / 1000, {
            view: 'graph',
            min: 0,
            max: 120,
            unit: 's',
          }),
        },
      }),
    },
    {
      pane: {
        id: 'showcase-react',
        title: 'React API',
        anchor: 'top-left',
        width: 280,
        order: 3,
      },
    },
  )
  return controls
}

export function ShowcaseExample() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useReactApiDemo()

  useEffect(() => {
    const canvas = canvasRef.current!
    const stopBackdrop = startBackdrop(canvas)
    const controls = buildControls()
    const plugins = buildCameraPlugins()
    const monitors = buildMonitors()
    const kiki = buildKiki()
    const perf = createPerfPane()
    const exp = createExportPane({
      target: () => canvasRef.current,
      filename: 'tiao-showcase',
    })
    return () => {
      controls.dispose()
      plugins.dispose()
      monitors.dispose()
      kiki.dispose()
      perf.dispose()
      exp.dispose()
      stopBackdrop()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100vw', height: '100vh', display: 'block' }}
    />
  )
}
