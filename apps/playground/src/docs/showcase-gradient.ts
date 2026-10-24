import type { MediaValue } from '@nightmarket/tiao/plugin-media'

export type Blend = 'multiply' | 'screen' | 'overlay'

/** what the backdrop draws this frame, straight from the showcase's controls */
export interface GradientLook {
  /** where the two lights are along their orbits, in radians */
  phase: number
  seed: number
  /** the gradient's direction, in degrees */
  yaw: number
  /** the gradient's center, -1 to 1 across the screen */
  offset: { x: number; y: number }
  /** where the gradient starts and ends along its direction, 0 to 100 */
  range: { min: number; max: number }
  /** CSS colors: the gradient's two ends and the two lights */
  from: string
  to: string
  tint: string
  glow: string
  blend: Blend
  /** contour lines instead of a fill */
  lines: boolean
  zoom: number
  /** how far the lights spread, wider at a low f-stop */
  spread: number
  /** replaces the gradient when set */
  media: MediaValue
}

const BLENDS: Blend[] = ['multiply', 'screen', 'overlay']

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 size;
uniform float phase, seed, yaw, zoom, spread, mediaAspect;
uniform vec2 offset, range;
uniform vec3 from, to, tint, glow;
uniform int blend;
uniform bool lines, textured;
uniform sampler2D media;
out vec4 color;

vec3 blended(vec3 base, vec3 top) {
  if (blend == 0) return base * top;
  if (blend == 1) return 1.0 - (1.0 - base) * (1.0 - top);
  return mix(2.0 * base * top, 1.0 - 2.0 * (1.0 - base) * (1.0 - top), step(0.5, base));
}

void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 p = (gl_FragCoord.xy - 0.5 * size) / size.y / zoom - offset * vec2(0.5, -0.5);
  float along = dot(p, vec2(cos(yaw), sin(yaw))) + 0.5;
  vec3 base = mix(from, to, smoothstep(range.x, range.y, along));
  if (textured) {
    float aspect = size.x / size.y;
    vec2 fit = aspect > mediaAspect ? vec2(1.0, mediaAspect / aspect) : vec2(aspect / mediaAspect, 1.0);
    base = texture(media, (uv - 0.5) * fit + 0.5).rgb;
  }
  // dim, so the panes over it stay the brightest thing on screen
  base *= 0.3;
  vec2 a = 0.38 * vec2(cos(phase + seed), sin(1.3 * phase + seed));
  vec2 b = 0.38 * vec2(cos(0.8 * phase + 2.0 * seed + 2.1), sin(phase + seed + 4.0));
  float lightA = exp(-dot(p - a, p - a) / spread);
  float lightB = exp(-dot(p - b, p - b) / spread);
  vec3 col = mix(base, blended(base, min(tint * lightA + glow * lightB, 1.0)), min(lightA + lightB, 1.0));
  if (lines) {
    float f = (lightA + lightB + along) * 10.0;
    float line = 1.0 - smoothstep(0.0, fwidth(f), abs(fract(f + 0.5) - 0.5));
    col = base * 0.5 + col * line * 1.6;
  }
  col *= 1.0 - 0.5 * dot(uv - 0.5, uv - 0.5);
  color = vec4(col, 1.0);
}`

const UNIFORMS = [
  'size',
  'phase',
  'seed',
  'yaw',
  'zoom',
  'spread',
  'mediaAspect',
  'offset',
  'range',
  'from',
  'to',
  'tint',
  'glow',
  'blend',
  'lines',
  'textured',
] as const

/** longest step the lights take after a stall, so they don't jump */
const MAX_DT = 0.1

function compile(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  return program
}

/** CSS colors as 0 to 1 sRGB, read back through a pixel, so any format the browser knows works */
function colorReader(): (css: string) => [number, number, number] {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const seen = new Map<string, [number, number, number]>()
  return (css) => {
    let rgb = seen.get(css)
    if (!rgb) {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
      rgb = [r / 255, g / 255, b / 255]
      seen.set(css, rgb)
    }
    return rgb
  }
}

/**
 * Draw a gradient with two orbiting lights into `canvas`, asking `frame` for
 * the look each frame given the seconds since the last. It draws only while
 * the canvas is on screen. Returns a dispose function.
 */
export function mountGradient(
  canvas: HTMLCanvasElement,
  frame: (dt: number) => GradientLook,
): () => void {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  if (!gl) return () => {}
  const program = compile(gl)
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
  gl.useProgram(program)
  const at = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
  const rgb = colorReader()

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  let uploaded: MediaValue = null

  /** an image uploads once; a video's frame changes, so it uploads every frame */
  const upload = (media: MediaValue): boolean => {
    if (!media) return false
    const video = media instanceof HTMLVideoElement
    if (video && media.readyState < media.HAVE_CURRENT_DATA) return false
    if (video || media !== uploaded) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media)
      uploaded = media
    }
    const [w, h] = video
      ? [media.videoWidth, media.videoHeight]
      : [media.naturalWidth, media.naturalHeight]
    gl.uniform1f(at.mediaAspect, w / Math.max(h, 1))
    return true
  }

  const draw = (dt: number) => {
    const look = frame(dt)
    gl.uniform2f(at.size, canvas.width, canvas.height)
    gl.uniform1f(at.phase, look.phase)
    gl.uniform1f(at.seed, look.seed)
    gl.uniform1f(at.yaw, (look.yaw * Math.PI) / 180)
    gl.uniform1f(at.zoom, look.zoom)
    gl.uniform1f(at.spread, look.spread)
    gl.uniform2f(at.offset, look.offset.x, look.offset.y)
    gl.uniform2f(at.range, look.range.min / 100, look.range.max / 100)
    gl.uniform3fv(at.from, rgb(look.from))
    gl.uniform3fv(at.to, rgb(look.to))
    gl.uniform3fv(at.tint, rgb(look.tint))
    gl.uniform3fv(at.glow, rgb(look.glow))
    gl.uniform1i(at.blend, BLENDS.indexOf(look.blend))
    gl.uniform1i(at.lines, Number(look.lines))
    gl.uniform1i(at.textured, Number(upload(look.media)))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  let raf = 0
  let last = 0
  const tick = (now: number) => {
    draw(Math.min((now - last) / 1000, MAX_DT))
    last = now
    raf = requestAnimationFrame(tick)
  }
  const visibility = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf)
    raf = 0
    if (!entry?.isIntersecting) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  })
  visibility.observe(canvas)

  // the gradient is smooth, so it draws at CSS pixels rather than device ones
  const resize = new ResizeObserver(([entry]) => {
    if (!entry) return
    canvas.width = Math.round(entry.contentRect.width)
    canvas.height = Math.round(entry.contentRect.height)
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (!raf) draw(0)
  })
  resize.observe(canvas)

  return () => {
    cancelAnimationFrame(raf)
    visibility.disconnect()
    resize.disconnect()
    // the canvas keeps its context for a remount, so only what this drew with goes
    gl.deleteTexture(texture)
    gl.deleteProgram(program)
  }
}
