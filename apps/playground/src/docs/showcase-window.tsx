import { Pane } from '@nightmarket/tiao/core'
import type { BezierValue } from '@nightmarket/tiao/plugin-bezier'
import { addFpsGraph } from '@nightmarket/tiao/plugin-fps'
import type { MediaValue } from '@nightmarket/tiao/plugin-media'
import type { ThumbEntry } from '@nightmarket/tiao/plugin-thumbnails'
import { cubicBezier } from 'motion/react'
import { useEffect, useRef } from 'react'
import { type Blend, mountGradient } from './showcase-gradient'
import { WindowLights } from './ui'

/** each gradient's two ends, which its thumbnail previews */
const PALETTES = {
  violet: ['#ddd6fe', '#a78bfa'],
  cyan: ['#cffafe', '#14b8a6'],
  orange: ['#fed7aa', '#f97316'],
} as const
type Palette = keyof typeof PALETTES

const GRADIENTS: ThumbEntry[] = Object.entries(PALETTES).map(([value, [from, to]]) => ({
  text: value[0]!.toUpperCase() + value.slice(1),
  value,
  thumb: `linear-gradient(135deg, ${from}, ${to})`,
}))

/** seconds for the lights to travel a quarter of their orbits, eased by the curve */
const QUARTER_S = 2.5
/** the focal length that draws the gradient at its own size */
const NORMAL_FOCAL = 50

/** a level that swings, for the monitor to plot */
const wave = {
  get level() {
    return Math.sin(performance.now() / 600) * 0.5 + 0.5
  },
}

/** two panes and a pinned card, narrow enough to share the window with its notch, and tall enough for every folder open */
const PANE = { namespace: 'showcase', width: 200, maxHeight: 400 } as const

/**
 * One of each control on the left, one of each plugin on the right, and a
 * pinned row, all driving the gradient behind them and the caption under it.
 */
function mountShowcase(screen: HTMLCanvasElement, caption: HTMLElement): () => void {
  const params = {
    speed: 1.2,
    seed: 42,
    enabled: true,
    label: 'hello tiao',
    blend: 'screen' as Blend,
    range: { min: 20, max: 80 },
    offset: { x: 0.2, y: -0.3 },
    yaw: 45,
    tint: '#ff8800',
    glow: 'oklch(0.7 0.15 200)',
    gradient: 'violet' as Palette,
    mode: 'fill',
    ease: [0.4, 0, 0.2, 1] as BezierValue,
    focal: 55,
    fStop: 1.8,
    texture: null as MediaValue,
  }
  let zoom = 1

  const controls = new Pane({ ...PANE, title: 'Controls', anchor: 'left-center' })
  const tabs = controls.addTab({
    pages: [{ title: 'Values' }, { title: 'Shapes' }, { title: 'Colors' }],
  })
  const values = tabs.pages[0]!
  const speed = values.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
  values.addBinding(params, 'seed', { step: 1 })
  values.addBinding(params, 'enabled')
  values.addBinding(params, 'label')
  values.addBinding(params, 'blend', {
    options: { Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay' },
  })
  const shapes = tabs.pages[1]!
  shapes.addBinding(params, 'range', { min: 0, max: 100, step: 1 })
  shapes.addBinding(params, 'offset', { x: { min: -1, max: 1 }, y: { min: -1, max: 1 } })
  shapes.addBinding(params, 'yaw', { view: 'angle' })
  const colors = tabs.pages[2]!
  colors.addBinding(params, 'tint')
  colors.addBinding(params, 'glow')
  controls.addButtonGroup({
    label: 'zoom',
    buttons: {
      '1x': () => {
        zoom = 1
      },
      '2x': () => {
        zoom = 2
      },
    },
  })

  const plugins = new Pane({ ...PANE, title: 'Plugins', anchor: 'right-center' })
  const look = plugins.addFolder({ title: 'Look' })
  look.addBinding(params, 'mode', {
    view: 'radiogrid',
    options: { Fill: 'fill', Line: 'line' },
    columns: 2,
  })
  look.addBinding(params, 'gradient', {
    view: 'thumbnails',
    options: GRADIENTS,
    aspect: 1.6,
    label: '',
  })
  look.addBinding(params, 'ease', { view: 'bezier' })
  const lens = look.addFolder({ title: 'Lens', expanded: false })
  lens.addBinding(params, 'focal', { view: 'cameraring' })
  lens.addBinding(params, 'fStop', { view: 'camerawheel', amount: 0.01, min: 0 })
  lens.addBinding(params, 'texture', { view: 'media' })
  const stats = plugins.addFolder({ title: 'Stats', expanded: false })
  stats.addBinding(wave, 'level', { readonly: true, view: 'graph', min: 0, max: 1 })
  addFpsGraph(stats)

  speed.pinned = true

  let time = 0
  let curve = ''
  let ease = cubicBezier(...params.ease)
  const disposeGradient = mountGradient(screen, (dt) => {
    if (params.enabled) time += dt * params.speed
    if (params.ease.join() !== curve) {
      curve = params.ease.join()
      ease = cubicBezier(...params.ease)
    }
    const quarters = time / QUARTER_S
    if (caption.textContent !== params.label) caption.textContent = params.label
    const [from, to] = PALETTES[params.gradient]
    return {
      phase: (Math.floor(quarters) + ease(quarters % 1)) * (Math.PI / 2),
      seed: params.seed * 2.39996,
      yaw: params.yaw,
      offset: params.offset,
      range: params.range,
      from,
      to,
      tint: params.tint,
      glow: params.glow,
      blend: params.blend,
      lines: params.mode === 'line',
      zoom: zoom * (params.focal / NORMAL_FOCAL),
      spread: 0.02 + 0.08 / Math.max(params.fStop, 0.5),
      media: params.texture,
    }
  })
  return () => {
    disposeGradient()
    controls.dispose()
    plugins.dispose()
  }
}

/** The breadth of tiao in a mini window: a namespace of its own, rooted in the view. */
export function ShowcaseWindow() {
  const viewRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLCanvasElement>(null)
  const captionRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const release = Pane.namespace('showcase', { root: viewRef.current! })
    const dispose = mountShowcase(screenRef.current!, captionRef.current!)
    return () => {
      dispose()
      release()
    }
  }, [])
  return (
    <figure className="docs-window">
      <WindowLights />
      <div ref={viewRef} className="docs-window-view">
        <canvas ref={screenRef} className="docs-window-screen docs-showcase-screen" />
        <span ref={captionRef} className="docs-showcase-caption" />
      </div>
    </figure>
  )
}
