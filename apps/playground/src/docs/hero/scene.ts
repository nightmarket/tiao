import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { pass } from 'three/tsl'
import {
  MathUtils,
  Mesh,
  type Node,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu'
import { createDayLight, lightAt, sunAt } from './cycle'
import { earth, planetMaterial, spaceNode } from './earth'
import { lensGrade } from './grade'
import { createBoulders, createLand, mesa, ROW } from './mesa'
import { RADIUS_METERS, sky, skyBackground, skyNode, skyTarget } from './sky'

export type HeroScene = 'mesa' | 'earth'

export interface EarthParams {
  /** how fast the planet turns under the camera, degrees per second */
  speed: number
  /** how fast the continents morph */
  morph: number
  /** how much the coastlines breathe */
  wobble: number
  /** camera height over the surface, planet radii */
  altitude: number
  /** camera pitch toward the horizon, degrees */
  tilt: number
  /** vertical field of view, degrees */
  fov: number
  /** where the sun sits along the horizon, degrees from straight ahead */
  azimuth: number
  /** how far the sun sits over the visible limb, degrees; below zero it is behind the planet */
  elevation: number
  /** how far the light that shades the ground sits above the visible sun, degrees */
  lift: number
  /** Rayleigh and ozone, the blue of the limb */
  density: number
  /** Mie, the glow around the sun */
  haze: number
  sea: number
  land: number
  relief: number
  clouds: number
  water: string
  ground: string
  flare: number
  /** how far the flare wanders */
  drift: number
  bloom: number
  exposure: number
  grain: number
}

export interface MesaParams {
  /** how fast the planet turns under the camera, degrees per second */
  speed: number
  /** camera height over the sand, meters */
  altitude: number
  /** camera pitch below level, degrees */
  tilt: number
  /** vertical field of view, degrees */
  fov: number
  /** hour of the day, 0 to 24 */
  time: number
  /** where the sun rises, degrees clockwise from straight ahead */
  azimuth: number
  /** whether the day runs on its own */
  play: boolean
  /** seconds a whole day takes while it runs */
  day: number
  /** share of the sky the clouds cover */
  coverage: number
  /** how thick the clouds are */
  clouds: number
  /** moves the clouds */
  wind: number
  /** Rayleigh and ozone, the blue of the sky */
  density: number
  /** Mie, the glow around the sun */
  haze: number
  /** share of the land the mesas cover */
  mesas: number
  /** how tall the dunes are */
  dunes: number
  sand: string
  rock: string
  flare: number
  /** how far the flare wanders */
  drift: number
  bloom: number
  exposure: number
  grain: number
}

export interface HeroParams {
  scene: HeroScene
  seed: number
  mesa: MesaParams
  earth: EarthParams
}

/** sharper than this costs fill rate the soft scenes don't show */
const MAX_DPR = 1.5

/** segments around and down the planet; enough for the land to break the limb */
const PLANET_SEGMENTS = [320, 160] as const

/**
 * The sky and clouds are soft, so they draw at this share of the resolution;
 * a whole half, so the grain their march leaves scales up evenly instead of
 * beating into a moire.
 */
const SKY_SCALE = 0.5

/** bloom spread (0 to 1) and the brightness it starts from, after exposure: low, so the lit land glows a little too */
const BLOOM_RADIUS = 0.6
const BLOOM_THRESHOLD = 0.2
/** how far over the threshold bloom eases in; a hard cut draws the threshold's contour across the sky's gradient */
const BLOOM_KNEE = 0.8

const glowOf = (input: Node<'vec4'>) => {
  const glow = bloom(input, 1, BLOOM_RADIUS, BLOOM_THRESHOLD)
  glow.smoothWidth.value = BLOOM_KNEE
  return glow
}

const UP = new Vector3(0, 1, 0)

/** the direction to a sun `elevation` degrees above the visible limb, seen from `altitude` over a unit planet */
function sunDirection(out: Vector3, p: EarthParams, lift: number): Vector3 {
  const dip = Math.acos(1 / (1 + p.altitude))
  const beta = dip - MathUtils.degToRad(p.elevation + lift)
  const az = MathUtils.degToRad(p.azimuth)
  return out
    .set(Math.sin(az) * Math.cos(beta), -Math.sin(beta), -Math.cos(az) * Math.cos(beta))
    .normalize()
}

/**
 * `level`, a direction whose elevation is measured over a level horizon, with
 * that elevation measured over a limb `dip` below level instead; straight up
 * stays straight up.
 */
function overLimb(out: Vector3, level: Vector3, dip: number): Vector3 {
  const elevation = Math.asin(level.y) * (1 + dip / (Math.PI / 2)) - dip
  const flat = Math.hypot(level.x, level.z) || 1
  return out.set(
    (level.x / flat) * Math.cos(elevation),
    Math.sin(elevation),
    (level.z / flat) * Math.cos(elevation),
  )
}

/**
 * Renders the hero into `canvas` with three's WebGPU renderer (WebGL 2 where
 * WebGPU is missing) while it is on screen, reading `params` each frame so a
 * pane bound to the same object tunes it live. Returns a stop function.
 */
export function startHero(canvas: HTMLCanvasElement, params: HeroParams): () => void {
  const renderer = new WebGPURenderer({ canvas, antialias: false })
  Reflect.set(window, '__hero', params) // DEBUG
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR))

  const camera = new PerspectiveCamera(90, 1, 0.01, 12)
  const planetGeometry = new SphereGeometry(1, ...PLANET_SEGMENTS)
  const planet = new Mesh(planetGeometry, planetMaterial())
  const earthScene = new Scene()
  earthScene.backgroundNode = spaceNode
  earthScene.add(planet)
  const earthColor = pass(earthScene, camera).getTextureNode()
  const earthBloom = glowOf(earthColor.mul(earth.exposure))
  const earthPipeline = new RenderPipeline(renderer, lensGrade(earth, earthColor, earthBloom))
  // the grade is the look; no tone mapping or color space conversion on top
  earthPipeline.outputColorTransform = false

  const mesaCamera = new PerspectiveCamera(80, 1, 0.0004, 4)
  const land = createLand()
  const boulders = createBoulders()
  const skyScene = new Scene()
  skyScene.backgroundNode = skyNode
  const mesaScene = new Scene()
  mesaScene.backgroundNode = skyBackground
  mesaScene.add(land, boulders)
  const mesaColor = pass(mesaScene, mesaCamera).getTextureNode()
  const mesaBloom = glowOf(mesaColor.mul(sky.exposure))
  const mesaPipeline = new RenderPipeline(renderer, lensGrade(sky, mesaColor, mesaBloom))
  mesaPipeline.outputColorTransform = false

  const buffer = new Vector2()
  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    mesaCamera.aspect = camera.aspect
    renderer.getDrawingBufferSize(buffer).multiplyScalar(SKY_SCALE).ceil()
    skyTarget.setSize(buffer.x, buffer.y)
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)

  // the clocks accumulate at the current speed, so changing a speed never jumps the scene
  let earthTime = 0
  let orbit = 0
  let skyTime = 0
  /** radians the desert's planet has turned, once around at most */
  let flight = 0
  const daylight = createDayLight()
  const hsl = { h: 0, s: 0, l: 0 }
  let last = 0
  const projected = new Vector3()
  /** where `direction` shows on screen, in uv (origin top left), or far off screen while it is behind the camera */
  const onScreen = (direction: Vector3, view: PerspectiveCamera, uv: Vector2) => {
    projected.copy(direction).add(view.position).project(view)
    if (projected.z > 1) uv.set(-10, -10)
    else uv.set((projected.x + 1) / 2, (1 - projected.y) / 2)
  }

  /** a camera at `height` over the origin, pitched `tilt` degrees down */
  const pose = (view: PerspectiveCamera, height: number, tilt: number, fov: number) => {
    view.position.set(0, height, 0)
    view.rotation.x = MathUtils.degToRad(-tilt)
    view.fov = fov
    view.updateProjectionMatrix()
    view.updateMatrixWorld()
  }

  const drawEarth = (dt: number, now: number) => {
    const p = params.earth
    earthTime += dt
    orbit += dt * p.speed
    earth.time.value = earthTime
    earth.clock.value = now
    earth.orbit.value = p.speed
    earth.morph.value = p.morph
    earth.wobble.value = p.wobble
    earth.seed.value = params.seed
    earth.sea.value = p.sea
    earth.landScale.value = p.land
    earth.clouds.value = p.clouds
    earth.relief.value = p.relief
    earth.density.value = p.density
    earth.haze.value = p.haze
    earth.water.value.set(p.water)
    earth.ground.value.set(p.ground)
    earth.flare.value = p.flare
    earth.drift.value = p.drift
    earth.exposure.value = p.exposure
    earth.grain.value = p.grain
    earthBloom.strength.value = p.bloom
    sunDirection(earth.sun.value, p, 0)
    sunDirection(earth.lit.value, p, p.lift)

    pose(camera, 1 + p.altitude, p.tilt, p.fov)
    earth.eye.value.copy(camera.position)
    planet.rotation.x = MathUtils.degToRad(orbit)

    onScreen(earth.sun.value, camera, earth.sunUv.value)
    earthPipeline.render()
  }

  const levelSun = new Vector3()
  const levelLight = new Vector3()
  /**
   * The sky at `p.time`, which runs on while the day plays, over a limb `dip`
   * below level: the sun rises from it at six, `p.azimuth` round from straight
   * ahead. Returns whichever of the sun and moon lights the land, as high over
   * it as it shows over the limb.
   */
  const lightTheDay = (p: MesaParams, dip: number, dt: number, now: number) => {
    if (p.play) p.time = (p.time + (dt * 24) / p.day) % 24
    skyTime += dt
    sky.time.value = skyTime
    sky.clock.value = now
    sky.dip.value = dip
    sunAt(levelSun, p.time).applyAxisAngle(UP, -MathUtils.degToRad(p.azimuth))
    lightAt(MathUtils.radToDeg(Math.asin(levelSun.y)), daylight)
    overLimb(sky.sun.value, levelSun, dip)
    // the land takes its light from whichever of the two is brighter
    const byMoon = daylight.moon.getHSL(hsl).l > daylight.sun.getHSL(hsl).l
    levelLight.copy(levelSun).multiplyScalar(byMoon ? -1 : 1)
    overLimb(sky.moon.value, levelSun.negate(), dip)
    sky.light.value.copy(byMoon ? sky.moon.value : sky.sun.value)
    sky.lightColor.value.copy(byMoon ? daylight.moon : daylight.sun)
    sky.sunColor.value.copy(daylight.sun)
    sky.ambient.value.copy(daylight.ambient)
    sky.stars.value = daylight.stars
    sky.exposure.value = p.exposure * daylight.exposure
    sky.density.value = p.density
    sky.haze.value = p.haze
    sky.coverage.value = p.coverage
    sky.clouds.value = p.clouds
    sky.wind.value = p.wind
    sky.flare.value = p.flare
    sky.drift.value = p.drift
    sky.grain.value = p.grain
    return levelLight
  }

  const drawMesa = (dt: number, now: number) => {
    const p = params.mesa
    flight = (flight + MathUtils.degToRad(dt * p.speed)) % (Math.PI * 2)
    const radii = 1 + p.altitude / RADIUS_METERS
    // the sun rises from the planet's limb, which sits this far below level
    mesa.light.value.copy(lightTheDay(p, Math.acos(1 / radii), dt, now))
    sky.travel.value = flight
    mesa.sand.value.set(p.sand)
    mesa.rock.value.set(p.rock)
    mesa.mesas.value = p.mesas
    mesa.dunes.value = p.dunes
    mesaBloom.strength.value = p.bloom
    // the noise turns by whole pairs of rows and the land the rest of the way
    mesa.snap.value = Math.floor(flight / (2 * ROW)) * 2 * ROW
    land.rotation.x = flight - mesa.snap.value
    boulders.rotation.x = flight
    pose(mesaCamera, radii, p.tilt, p.fov)
    onScreen(sky.sun.value, mesaCamera, sky.sunUv.value)
    // the sky and clouds into their target, then the desert over them
    renderer.setRenderTarget(skyTarget)
    renderer.render(skyScene, mesaCamera)
    renderer.setRenderTarget(null)
    mesaPipeline.render()
  }

  let frame = 0
  let running = false
  const draw = (time: number) => {
    const dt = (time - (last || time)) / 1000
    last = time
    switch (params.scene) {
      case 'mesa':
        drawMesa(dt, time / 1000)
        break
      case 'earth':
        drawEarth(dt, time / 1000)
        break
      default: {
        const unknown: never = params.scene
        throw new Error(`no scene ${String(unknown)}`)
      }
    }
    frame = requestAnimationFrame(draw)
  }

  // shaders compile once the backend is up; until then, and while off screen, nothing draws
  let visible = false
  let ready = false
  const sync = () => {
    const run = ready && visible
    if (run === running) return
    running = run
    cancelAnimationFrame(frame)
    last = 0
    if (run) frame = requestAnimationFrame(draw)
  }
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    sync()
  })
  visibility.observe(canvas)
  let stopped = false
  void renderer.init().then(() => {
    if (stopped) return
    ready = true
    sync()
  })

  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    visibility.disconnect()
    resizeObserver.disconnect()
    earthPipeline.dispose()
    mesaPipeline.dispose()
    skyTarget.dispose()
    for (const mesh of [land, boulders]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    planetGeometry.dispose()
    planet.material.dispose()
    renderer.dispose()
  }
}
