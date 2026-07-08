import { useEffect, useRef } from 'react'
import { createPerfPane } from '@tiao/perf-pane'
import { startThreeScene } from './scene'

/**
 * Fullscreen three.js scene monitored by the pre-configured perf pane:
 * fps / cpu / gpu graphs, draw-call counters, and memory counts. The demo
 * buttons churn geometries/textures — "Leak" removes meshes without
 * dispose() so you can watch the Memory counters stay elevated.
 */
export function ThreePerfExample() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const scene = startThreeScene(canvasRef.current!)
    const perf = createPerfPane({ renderer: scene.renderer })
    perf.pane.addButtonGroup({
      label: 'demo',
      buttons: {
        'Add 20': () => scene.addMeshes(20),
        Clear: () => scene.clear(true),
        Leak: () => scene.clear(false),
      },
    })
    return () => {
      perf.dispose()
      scene.stop()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100vw', height: '100vh', display: 'block' }}
    />
  )
}
