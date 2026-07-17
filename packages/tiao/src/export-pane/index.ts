import { Pane, type Anchor, type PaneOptions } from '../core'
import {
  downloadBlob,
  exportPng,
  recordMp4,
  recordWebm,
  supportsMp4,
  type Recorder,
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
  video.addBinding(params, 'status', { readonly: true, interval: 100, label: 'status' })

  let recorder: Recorder | null = null
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
    params.status = 'idle'
  }

  recordButton.on('click', () => {
    void (async () => {
      if (recorder) {
        const active = recorder
        recorder = null
        params.status = 'encoding…'
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
        params.status = 'no canvas'
        return
      }
      try {
        const opts = { fps: params.fps, bitrateMbps: params.bitrate }
        recorder = params.format === 'mp4' ? await recordMp4(canvas, opts) : recordWebm(canvas, opts)
      } catch (err) {
        params.status = 'error'
        throw err
      }
      startedAt = performance.now()
      recordButton.title = 'Stop & save'
      timer = setInterval(() => {
        params.status = `rec ${((performance.now() - startedAt) / 1000).toFixed(1)}s`
      }, 100)
    })()
  })

  return pane
}

export { exportPng, recordWebm, recordMp4, supportsMp4, downloadBlob } from './recorders'
export type { Recorder, RecordOptions } from './recorders'
