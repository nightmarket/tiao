import { type Anchor, Pane, type PaneOptions } from '../core'
import {
  downloadBlob,
  exportPng,
  type Recorder,
  recordMp4,
  recordWebm,
  supportsMp4,
} from './recorders'

export interface ExportPaneOptions {
  /** the canvas to capture, or a getter if it re-mounts */
  target: HTMLCanvasElement | (() => HTMLCanvasElement | null)
  id?: string
  title?: string
  anchor?: Anchor
  /** base filename without extension (default 'export') */
  filename?: string
  /** extra pane options merged in */
  pane?: Partial<PaneOptions>
}

/**
 * Pre-configured pane anchored bottom-right (by default) that exports the
 * target canvas as PNG, or records it to WebM/MP4.
 */
export function createExportPane(options: ExportPaneOptions): Pane {
  const pane = new Pane({
    id: options.id ?? 'tiao-export',
    title: options.title ?? 'Export',
    anchor: options.anchor ?? 'bottom-right',
    // export is a terminal action, so it sits last in the sidebar by default
    order: 99,
    ...options.pane,
  })

  const getCanvas = (): HTMLCanvasElement | null =>
    typeof options.target === 'function' ? options.target() : options.target

  const filename = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `${options.filename ?? 'export'}-${stamp}`
  }

  const params = {
    scale: 1,
    format: 'webm',
    fps: 60,
    bitrate: 8,
    status: 'idle',
  }

  // --- image ---
  const image = pane.addFolder({ title: 'Image' })
  image.addBinding(params, 'scale', { min: 0.5, max: 4, step: 0.5, label: 'scale' })
  image.addButton({ title: 'Export PNG' }).on('click', () => {
    const canvas = getCanvas()
    if (canvas) exportPng(canvas, params.scale, `${filename()}.png`)
  })

  // --- video ---
  const video = pane.addFolder({ title: 'Video' })
  const formats: Record<string, string> = { WebM: 'webm' }
  if (supportsMp4()) formats['MP4'] = 'mp4'
  video.addBinding(params, 'format', { options: formats, label: 'format' })
  video.addBinding(params, 'fps', { min: 1, max: 120, step: 1, label: 'fps' })
  video.addBinding(params, 'bitrate', { min: 1, max: 50, step: 1, label: 'Mbps' })
  // never polled, so an idle export pane adds no per-frame work; setStatus pushes changes
  const statusRow = video.addBinding(params, 'status', {
    readonly: true,
    interval: Infinity,
    label: 'status',
  })
  const setStatus = (status: string) => {
    params.status = status
    statusRow.refresh()
  }

  let recorder: Recorder | null = null
  /** set while mediabunny loads, so a second click can't orphan a recorder */
  let starting = false
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | null = null
  const recordButton = video.addButton({ title: 'Start recording' })

  // disposing the pane mid-recording must stop the capture stream and timer
  pane.onDispose(() => {
    if (timer) clearInterval(timer)
    timer = null
    void recorder?.stop()
    recorder = null
  })

  const setIdle = () => {
    recorder = null
    if (timer) clearInterval(timer)
    timer = null
    recordButton.title = 'Start recording'
    setStatus('idle')
  }

  recordButton.on('click', () => {
    void (async () => {
      if (starting) return
      if (recorder) {
        const active = recorder
        recorder = null
        setStatus('encoding…')
        try {
          const blob = await active.stop()
          downloadBlob(blob, `${filename()}.${params.format}`)
        } finally {
          setIdle()
        }
        return
      }
      const canvas = getCanvas()
      if (!canvas) {
        setStatus('no canvas')
        return
      }
      starting = true
      try {
        const opts = { fps: params.fps, bitrateMbps: params.bitrate }
        recorder =
          params.format === 'mp4' ? await recordMp4(canvas, opts) : recordWebm(canvas, opts)
      } catch (err) {
        setStatus('error')
        throw err
      } finally {
        starting = false
      }
      startedAt = performance.now()
      recordButton.title = 'Stop & save'
      timer = setInterval(() => {
        setStatus(`rec ${((performance.now() - startedAt) / 1000).toFixed(1)}s`)
      }, 100)
    })()
  })

  return pane
}

export type { Recorder, RecordOptions } from './recorders'
export { downloadBlob, exportPng, recordMp4, recordWebm, supportsMp4 } from './recorders'
