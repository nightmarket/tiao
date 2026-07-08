import { useEffect, useRef } from 'react'
import { createExportPane } from '@tiao/export-pane'
import { registerBezierPlugin } from '@tiao/plugin-bezier'
import { registerCameraPlugin } from '@tiao/plugin-camera'
import { addFpsGraph } from '@tiao/plugin-fps'
import { registerMediaPlugin, type MediaValue } from '@tiao/plugin-media'
import { registerRadioGridPlugin } from '@tiao/plugin-radio-grid'
import { button, buttonGroup, monitor, useControls } from '@tiao/react'
import { startScene, type SceneHandle, type SceneParams } from './scene'
import type { Pane } from '@tiao/core'

registerRadioGridPlugin()
registerBezierPlugin()
registerCameraPlugin()
registerMediaPlugin()

/** Contributes motion controls to the default pane from one component... */
function useMotionControls() {
  const controls = useControls('Motion', {
    running: true,
    speed: { value: 1, min: 0, max: 4, step: 0.01 },
    presets: buttonGroup({
      '0.5x': () => controls.$set({ speed: 0.5 }),
      '1x': () => controls.$set({ speed: 1 }),
      '2x': () => controls.$set({ speed: 2 }),
    }),
    mode: { value: 'orbit', view: 'radiogrid', options: { Orbit: 'orbit', Wave: 'wave' }, columns: 2 },
    center: { value: { x: 0, y: 0 }, x: { min: -1, max: 1, step: 0.01 }, y: { min: -1, max: 1, step: 0.01 } },
  })
  return controls
}

/** ...while a sibling component adds a Look folder to the same pane. */
function useLookControls(scene: React.RefObject<SceneHandle | null>) {
  return useControls('Look', {
    count: { value: 400, min: 10, max: 2000, step: 10 },
    size: { value: 2.5, min: 0.5, max: 10, step: 0.1 },
    color: '#7dd3fc',
    trail: { value: 0.12, min: 0.01, max: 1, step: 0.01 },
    // drop an image/video to replace the dots with a sprite drawn per particle
    sprite: { value: null as MediaValue, view: 'media' },
    fps: monitor(() => scene.current?.fps() ?? 0, { view: 'graph', min: 0, max: 120, unit: 'FPS' }),
    reset: button(() => localStorage.clear(), 'Clear saved pane state'),
  })
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const paramsRef = useRef<SceneParams | null>(null)

  const motion = useMotionControls()
  const look = useLookControls(sceneRef)

  paramsRef.current = {
    running: motion.running,
    speed: motion.speed,
    mode: motion.mode as SceneParams['mode'],
    center: motion.center,
    count: look.count,
    size: look.size,
    color: look.color,
    trail: look.trail,
    sprite: look.sprite,
  }

  // scene lifecycle
  useEffect(() => {
    const canvas = canvasRef.current!
    const handle = startScene(canvas, () => paramsRef.current!)
    sceneRef.current = handle
    return () => handle.stop()
  }, [])

  // export pane (vanilla, pre-configured, anchored bottom-right)
  useEffect(() => {
    const pane = createExportPane({
      target: () => canvasRef.current,
      filename: 'tiao-demo',
    })
    return () => pane.dispose()
  }, [])

  // kitchen-sink pane via the vanilla API, loaded with a dynamic import —
  // the same pattern a prod app uses to keep tiao out of its main bundle
  useEffect(() => {
    let pane: Pane | undefined
    let disposed = false
    void (async () => {
      const { Pane } = await import('@tiao/core')
      if (disposed) return
      pane = buildKitchenSink(new Pane({
        id: 'kitchen',
        title: 'Kitchen sink',
        anchor: 'top-left',
        toggleKey: '`',
        width: 300,
      }))
    })()
    return () => {
      disposed = true
      pane?.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100vw', height: '100vh', display: 'block' }}
    />
  )
}

function buildKitchenSink(pane: Pane): Pane {
  const params = {
    exposure: 0.6,
    iterations: 12,
    seed: 42,
    label: 'hello tiao',
    enabled: true,
    blend: 'multiply',
    tint: '#ff8800',
    fade: '#22d3ee',
    glow: 'rgba(120, 200, 255, 0.5)',
    sky: 'hsl(200, 80%, 60%)',
    warm: { h: 30, s: 90, v: 95 },
    lch: 'oklch(0.7 0.15 200)',
    offset: { x: 0.2, y: -0.3 },
    rotation: { x: 0, y: 0, z: 0 },
    easing: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    flen: 55,
    fnumber: 1.8,
    quality: 'medium',
    texture: null as MediaValue,
    time: 0,
  }
  setInterval(() => {
    params.time = performance.now() / 1000
  }, 50)

  // one labeled two-column graph, one full-width label-less graph
  addFpsGraph(pane, { label: 'FPS' })
  addFpsGraph(pane)

  const basics = pane.addFolder({ title: 'Basics' })
  basics.addBinding(params, 'exposure', { min: 0, max: 1, step: 0.01 })
  basics.addButtonGroup({
    label: 'presets',
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
  basics.addBinding(params, 'iterations', { min: 1, max: 64, step: 1 })
  basics.addBinding(params, 'seed')
  basics.addBinding(params, 'label')
  basics.addBinding(params, 'enabled')
  basics.addBinding(params, 'blend', {
    options: { Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay' },
  })
  basics.addButton({ title: 'Log params' }).on('click', () => console.log({ ...params }))

  const color = pane.addFolder({ title: 'Color', collapsible: false })
  color.addBinding(params, 'tint')
  color.addBinding(params, 'fade', { label: 'fade (opt-in a)', color: { alpha: true } })
  color.addBinding(params, 'glow', { label: 'glow (alpha)' })
  color.addBinding(params, 'sky', { label: 'hsl' })
  color.addBinding(params, 'warm', { label: 'hsv object' })
  color.addBinding(params, 'lch', { label: 'oklch' })
  color.addSeparator()

  const vectors = pane.addFolder({ title: 'Vectors', color: '#fb923c' })
  vectors.addBinding(params, 'offset', {
    x: { min: -1, max: 1, step: 0.01 },
    y: { min: -1, max: 1, step: 0.01 },
  })
  const nested = vectors.addFolder({ title: 'Nested' })
  nested.addBinding(params, 'rotation', { step: 1 })
  const deeper = nested.addFolder({ title: 'Deeper' })
  deeper.addBinding(params, 'iterations', { min: 1, max: 64, step: 1, label: 'depth demo' })

  const camera = pane.addFolder({ title: 'Camera', expanded: false })
  camera.addBinding(params, 'flen', { view: 'cameraring', series: 0, label: 'flen (0)' })
  camera.addBinding(params, 'flen', {
    view: 'cameraring',
    series: 1,
    label: 'flen (1)',
    unit: { ticks: 10, pixels: 40, value: 0.2 },
    min: 1,
    step: 0.02,
  })
  camera.addBinding(params, 'flen', { view: 'cameraring', series: 2, label: 'flen (2)' })
  camera.addBinding(params, 'flen', { view: 'cameraring', wide: true, label: 'flen (wide)' })
  camera.addBinding(params, 'fnumber', {
    view: 'camerawheel',
    label: 'f-number',
    amount: 0.01,
    min: 0,
  })

  const plugins = pane.addFolder({ title: 'Plugins', expanded: false })
  plugins.addBinding(params, 'easing', { view: 'bezier' })
  plugins.addBinding(params, 'quality', {
    view: 'radiogrid',
    options: { Low: 'low', Medium: 'medium', High: 'high' },
    columns: 3,
  })
  plugins
    .addBinding(params, 'texture', { view: 'media' })
    .on('change', (ev) => console.log('texture source:', ev.value))

  // theme + accent live in the pane settings menu (gear / right-click)
  const tabs = pane.addTab({ pages: [{ title: 'Monitor' }, { title: 'Info' }] })
  tabs.pages[0]!.addBinding(params, 'time', { readonly: true })
  tabs.pages[0]!.addBinding(params, 'time', { readonly: true, view: 'graph', label: 'time graph', unit: 's' })
  // bufferSize on a plain monitor renders a mini scrollable console of the last N values
  tabs.pages[0]!.addBinding(params, 'time', {
    readonly: true,
    label: 'time log',
    bufferSize: 10,
    interval: 500,
    format: (v: number) => v.toFixed(2),
  })
  tabs.pages[1]!.addBinding({ note: 'right-click for settings' }, 'note', { readonly: true })

  return pane
}
