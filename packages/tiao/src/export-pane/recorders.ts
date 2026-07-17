export interface Recorder {
  stop(): Promise<Blob>
}

export interface RecordOptions {
  fps: number
  /** megabits per second */
  bitrateMbps: number
}

export function recordWebm(canvas: HTMLCanvasElement, opts: RecordOptions): Recorder {
  const stream = canvas.captureStream(opts.fps)
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: opts.bitrateMbps * 1e6,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start()

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop()
          resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
        }
        recorder.stop()
      }),
  }
}

export function supportsMp4(): boolean {
  return typeof VideoEncoder !== 'undefined'
}

/** MP4 via WebCodecs + mediabunny; loaded lazily so the muxer never ships unless used. */
export async function recordMp4(canvas: HTMLCanvasElement, opts: RecordOptions): Promise<Recorder> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = await import('mediabunny')

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: opts.bitrateMbps * 1e6,
  })
  output.addVideoTrack(source, { frameRate: opts.fps })
  await output.start()

  const frameDuration = 1 / opts.fps
  const start = performance.now()
  let stopped = false
  let pending: Promise<void> = Promise.resolve()
  let rafId = 0

  const capture = () => {
    if (stopped) return
    const timestamp = (performance.now() - start) / 1000
    // chain adds so encoder backpressure is respected without dropping order
    pending = pending.then(() => (stopped ? undefined : source.add(timestamp, frameDuration)))
    rafId = requestAnimationFrame(capture)
  }
  rafId = requestAnimationFrame(capture)

  return {
    stop: async () => {
      stopped = true
      cancelAnimationFrame(rafId)
      await pending
      source.close()
      await output.finalize()
      const buffer = output.target.buffer
      if (!buffer) throw new Error('tiao: mp4 finalize produced no data')
      return new Blob([buffer], { type: 'video/mp4' })
    },
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // give the browser a beat to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function exportPng(canvas: HTMLCanvasElement, scale: number, filename: string): void {
  if (scale === 1) {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
    }, 'image/png')
    return
  }
  const scaled = document.createElement('canvas')
  scaled.width = Math.round(canvas.width * scale)
  scaled.height = Math.round(canvas.height * scale)
  const c = scaled.getContext('2d')
  if (!c) return
  c.imageSmoothingEnabled = scale < 1
  c.drawImage(canvas, 0, 0, scaled.width, scaled.height)
  scaled.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename)
  }, 'image/png')
}
