import { useEffect, useRef } from 'react'
import { createExportPane } from '@tiao/export-pane'
import { registerBezierPlugin } from '@tiao/plugin-bezier'
import { addFpsGraph } from '@tiao/plugin-fps'
import { registerRadioGridPlugin } from '@tiao/plugin-radio-grid'
import { button, monitor, useControls } from '@tiao/react'
import { startScene, type SceneHandle, type SceneParams } from './scene'
import type { Pane } from '@tiao/core'

registerRadioGridPlugin()
registerBezierPlugin()

/** Contributes motion controls to the default pane from one component... */
function useMotionControls() {
  return useControls('Motion', {
    running: true,
    speed: { value: 1, min: 0, max: 4, step: 0.01 },
    mode: { value: 'orbit', view: 'radiogrid', options: { Orbit: 'orbit', Wave: 'wave' }, columns: 2 },
    center: { value: { x: 0, y: 0 }, x: { min: -1, max: 1, step: 0.01 }, y: { min: -1, max: 1, step: 0.01 } },
  })
}

/** ...while a sibling component adds a Look folder to the same pane. */
function useLookControls(scene: React.RefObject<SceneHandle | null>) {
  return useControls('Look', {
    count: { value: 400, min: 10, max: 2000, step: 10 },
    size: { value: 2.5, min: 0.5, max: 10, step: 0.1 },
    color: '#7dd3fc',
    trail: { value: 0.12, min: 0.01, max: 1, step: 0.01 },
    fps: monitor(() => scene.current?.fps() ?? 0, { view: 'graph', min: 0, max: 120 }),
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
    glow: 'rgba(120, 200, 255, 0.5)',
    lch: 'oklch(0.7 0.15 200)',
    offset: { x: 0.2, y: -0.3 },
    rotation: { x: 0, y: 0, z: 0 },
    easing: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    quality: 'medium',
    time: 0,
  }
  setInterval(() => {
    params.time = performance.now() / 1000
  }, 50)

  addFpsGraph(pane, { label: 'fps' })

  const basics = pane.addFolder({ title: 'Basics' })
  basics.addBinding(params, 'exposure', { min: 0, max: 1, step: 0.01 })
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
  color.addBinding(params, 'glow', { label: 'glow (alpha)' })
  color.addBinding(params, 'lch', { label: 'oklch' })

  const vectors = pane.addFolder({ title: 'Vectors' })
  vectors.addBinding(params, 'offset', {
    x: { min: -1, max: 1, step: 0.01 },
    y: { min: -1, max: 1, step: 0.01 },
  })
  const nested = vectors.addFolder({ title: 'Nested' })
  nested.addBinding(params, 'rotation', { step: 1 })
  const deeper = nested.addFolder({ title: 'Deeper' })
  deeper.addBinding(params, 'iterations', { min: 1, max: 64, step: 1, label: 'depth demo' })

  const plugins = pane.addFolder({ title: 'Plugins', expanded: false })
  plugins.addBinding(params, 'easing', { view: 'bezier' })
  plugins.addBinding(params, 'quality', {
    view: 'radiogrid',
    options: { Low: 'low', Medium: 'medium', High: 'high' },
    columns: 3,
  })

  const tabs = pane.addTab({ pages: [{ title: 'Monitor' }, { title: 'Theme' }] })
  tabs.pages[0]!.addBinding(params, 'time', { readonly: true })
  tabs.pages[0]!.addBinding(params, 'time', { readonly: true, view: 'graph', label: 'time graph' })

  const themes = { theme: 'light' }
  tabs.pages[1]!.addBinding(themes, 'theme', {
    view: 'radiogrid',
    options: { Light: 'light', Dark: 'dark' },
    columns: 2,
  })
  tabs.pages[1]!.addBinding({ accent: '#1a1a1a' }, 'accent').on('change', (ev) => {
    pane.applyTheme({ accent: String(ev.value) })
  })
  pane.on('change', () => {
    pane.element.classList.toggle('tiao-theme-dark', themes.theme === 'dark')
  })

  return pane
}
