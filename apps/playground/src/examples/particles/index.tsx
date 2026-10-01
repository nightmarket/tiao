import { createExportPane } from '@nightmarket/tiao/export-pane'
import type { MediaValue } from '@nightmarket/tiao/plugin-media'
import { button, buttonGroup, monitor, tabs, useControls } from '@nightmarket/tiao/react'
import { useEffect, useRef } from 'react'
import { type SceneHandle, type SceneParams, startScene } from './scene'

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
    mode: {
      value: 'orbit',
      view: 'radiogrid',
      options: { Orbit: 'orbit', Wave: 'wave' },
      columns: 2,
    },
    center: {
      value: { x: 0, y: 0 },
      x: { min: -1, max: 1, step: 0.01 },
      y: { min: -1, max: 1, step: 0.01 },
      showIf: (get) => get('mode') === 'orbit',
    },
  })
  return controls
}

/** ...while a sibling component adds a Look folder to the same pane. */
function useLookControls(scene: React.RefObject<SceneHandle | null>) {
  return useControls(
    'Look',
    tabs({
      Sprite: {
        count: { value: 400, min: 10, max: 2000, step: 10 },
        size: { value: 2.5, min: 0.5, max: 10, step: 0.1 },
        color: '#7dd3fc',
        trail: { value: 0.12, min: 0.01, max: 1, step: 0.01 },
        sprite: { value: null as MediaValue, view: 'media' },
      },
      Monitor: {
        fps: monitor(() => scene.current?.fps() ?? 0, {
          view: 'graph',
          min: 0,
          max: 120,
          unit: 'FPS',
        }),
        reset: button(() => localStorage.clear(), 'Clear saved pane state'),
      },
    }),
  )
}

export function ParticlesExample() {
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

  return <canvas ref={canvasRef} style={{ width: '100vw', height: '100vh', display: 'block' }} />
}
