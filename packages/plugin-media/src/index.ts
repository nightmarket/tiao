import { h, registerPlugin, type InputPlugin } from '@tiao/core'

/**
 * Loaded media, ready to upload as a texture: both element types are valid
 * WebGL `TexImageSource`s; for WebGPU pass images through `createImageBitmap`
 * and videos through `importExternalTexture`.
 */
export type MediaValue = HTMLImageElement | HTMLVideoElement | null

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES]

function isMediaValue(v: unknown): v is MediaValue {
  if (v === null) return true
  if (typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement) return true
  if (typeof HTMLVideoElement !== 'undefined' && v instanceof HTMLVideoElement) return true
  return false
}

/**
 * Media upload input: drag & drop or click to load a png/jpeg/webp image or
 * mp4/webm video. The binding value becomes the loaded element (videos play
 * muted on loop), ready to feed WebGL/WebGPU textures. Usage:
 *   registerMediaPlugin()
 *   pane.addBinding(params, 'texture', { view: 'media' })  // value: MediaValue
 */
export const mediaPlugin: InputPlugin<MediaValue> = {
  id: 'media',
  type: 'input',
  accept(value, options) {
    return options.view === 'media' && isMediaValue(value)
  },
  create(ctx) {
    ensureStyles(ctx.document)
    const doc = ctx.document

    const input = h('input')
    input.type = 'file'
    input.accept = ACCEPT.join(',')
    input.className = 'tiao-media-input'

    const hint = h('div', 'tiao-media-hint', 'Upload...')
    const preview = h('div', 'tiao-media-preview')
    const name = h('div', 'tiao-media-name')
    const clear = h('button', 'tiao-media-clear', '\u00d7')
    clear.type = 'button'
    clear.title = 'Clear media'

    const zone = h('div', 'tiao-media-zone', preview, hint, name, clear, input)
    zone.tabIndex = 0
    zone.setAttribute('role', 'button')
    const root = ctx.label
      ? h('div', 'tiao-media', h('div', 'tiao-label', ctx.label), zone)
      : h('div', 'tiao-media', zone)

    // object URL backing the current value; videos need it alive while playing
    let currentUrl: string | null = null
    let hintTimer: ReturnType<typeof setTimeout> | undefined

    const setHint = (text: string, transient = false) => {
      hint.textContent = text
      clearTimeout(hintTimer)
      if (transient) {
        hintTimer = setTimeout(() => {
          hint.textContent = 'Upload...'
        }, 1600)
      }
    }

    const render = (v: MediaValue) => {
      if (v) preview.replaceChildren(v)
      else preview.replaceChildren()
      zone.classList.toggle('tiao-media-loaded', v !== null)
      if (v === null) name.textContent = ''
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    const commit = (media: MediaValue, url: string | null, label: string) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      currentUrl = url
      name.textContent = label
      ctx.value.set(media, { source: 'ui', last: true })
    }

    const loadFile = (file: File) => {
      if (!ACCEPT.includes(file.type)) {
        setHint('Unsupported file type', true)
        return
      }
      const url = URL.createObjectURL(file)
      if (IMAGE_TYPES.includes(file.type)) {
        const img = doc.createElement('img')
        img.onload = () => commit(img, url, file.name)
        img.onerror = () => {
          URL.revokeObjectURL(url)
          setHint('Failed to load image', true)
        }
        img.src = url
      } else {
        const video = doc.createElement('video')
        video.muted = true
        video.loop = true
        video.playsInline = true
        video.autoplay = true
        video.onloadeddata = () => {
          commit(video, url, file.name)
          void video.play().catch(() => {})
        }
        video.onerror = () => {
          URL.revokeObjectURL(url)
          setHint('Failed to load video', true)
        }
        video.src = url
      }
    }

    const onZoneClick = (e: MouseEvent) => {
      if (e.target === clear) return
      input.click()
    }
    const onZoneKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        input.click()
      }
    }
    const onInputChange = () => {
      const file = input.files?.[0]
      if (file) loadFile(file)
      input.value = ''
    }
    const onClear = (e: MouseEvent) => {
      e.stopPropagation()
      commit(null, null, '')
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      zone.classList.add('tiao-media-over')
    }
    const onDragLeave = () => zone.classList.remove('tiao-media-over')
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      zone.classList.remove('tiao-media-over')
      const file = e.dataTransfer?.files?.[0]
      if (file) loadFile(file)
    }

    zone.addEventListener('click', onZoneClick)
    zone.addEventListener('keydown', onZoneKey)
    zone.addEventListener('dragover', onDragOver)
    zone.addEventListener('dragleave', onDragLeave)
    zone.addEventListener('drop', onDrop)
    input.addEventListener('change', onInputChange)
    clear.addEventListener('click', onClear)
    ctx.onDispose(() => {
      zone.removeEventListener('click', onZoneClick)
      zone.removeEventListener('keydown', onZoneKey)
      zone.removeEventListener('dragover', onDragOver)
      zone.removeEventListener('dragleave', onDragLeave)
      zone.removeEventListener('drop', onDrop)
      input.removeEventListener('change', onInputChange)
      clear.removeEventListener('click', onClear)
      clearTimeout(hintTimer)
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    })

    return { element: root, full: true }
  },
}

const CSS = `
.tiao-media {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
/* same depth-aware split as core rows so the zone spans the full control column */
.tiao-media > .tiao-label {
  flex: 0 0 calc(50% - 6px - var(--tiao-depth, 0) * 6px);
  align-self: center;
}
.tiao-media-zone {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 48px;
  border: 1px dashed var(--tiao-border);
  border-radius: var(--tiao-radius-sm);
  background: var(--tiao-surface);
  overflow: hidden;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.tiao-media-zone:hover,
.tiao-media-zone.tiao-media-over {
  background: var(--tiao-surface-hover);
  border-color: var(--tiao-accent);
}
.tiao-media-zone.tiao-media-loaded {
  border-style: solid;
}
.tiao-media-input {
  display: none;
}
.tiao-media-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  text-align: center;
  color: var(--tiao-fg-dim);
  pointer-events: none;
}
.tiao-media-loaded .tiao-media-hint {
  display: none;
}
.tiao-media-preview {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.tiao-media-preview img,
.tiao-media-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tiao-media-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px 6px;
  font-family: var(--tiao-font-mono);
  font-size: var(--tiao-font-size-mono);
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  display: none;
}
.tiao-media-loaded .tiao-media-name {
  display: block;
}
.tiao-media-clear {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  line-height: 1;
}
.tiao-media-loaded .tiao-media-clear {
  display: flex;
}
.tiao-media-clear:hover {
  background: rgba(0, 0, 0, 0.65);
}
`

function ensureStyles(doc: Document): void {
  if (doc.querySelector('style[data-tiao-media]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-tiao-media', '')
  style.textContent = CSS
  doc.head.append(style)
}

let registered = false

export function registerMediaPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(mediaPlugin)
}
