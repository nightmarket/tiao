/**
 * The sky over the desert, through a day: the shared atmosphere seen from the
 * camera, volumetric clouds marched through a shell of noise around the small
 * planet, the stars, and the sun and moon. The sky and clouds are soft, so they
 * draw first into `skyTarget` at a fraction of the resolution, and the desert
 * shows them behind it. The light follows the sun's height through the cycle
 * worked out on the CPU (see cycle.ts).
 */
import {
  asin,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  Fn,
  float,
  fract,
  If,
  int,
  Loop,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorldDirection,
  pow,
  screenCoordinate,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { Color, HalfFloatType, type Node, RenderTarget, Vector2, Vector3 } from 'three/webgpu'
import { createAir, turnX } from './atmosphere'
import { fbm3, hash12, hash13 } from './noise'

/** the planet's radius in meters; the smaller it is, the more the horizon curves */
export const RADIUS_METERS = 6500
/** how many times deeper than the orbit's the air is here, so the camera flies low in it rather than near its top */
const AIR_DEPTH = 20

/** every sky uniform; its light comes from the cycle each frame */
export const sky = {
  /** seconds, for the wind and the drifting clouds */
  time: uniform(0),
  clock: uniform(0),
  /** toward the sun and the moon in the world */
  sun: uniform(new Vector3(0, 0, -1)),
  moon: uniform(new Vector3(0, 0, 1)),
  /** the sunlight that reaches the ground, which also colors the sun's disc */
  sunColor: uniform(new Color()),
  /** whichever of the sun and moon lights the clouds, and its color */
  light: uniform(new Vector3(0, 0, -1)),
  lightColor: uniform(new Color()),
  /** the sky's light from every direction */
  ambient: uniform(new Color()),
  stars: uniform(0),
  density: uniform(1),
  haze: uniform(1),
  coverage: uniform(0.45),
  clouds: uniform(1),
  wind: uniform(1),
  /** radians the planet has turned about x under the camera, which carries the clouds over */
  travel: uniform(0),
  /** how far below level the planet's limb sits, radians */
  dip: uniform(0),
  sunUv: uniform(new Vector2(-10, -10)),
  flare: uniform(1),
  drift: uniform(1),
  exposure: uniform(1),
  grain: uniform(0),
}

const airUniforms = { sun: sky.sun, density: sky.density, haze: sky.haze, depth: float(AIR_DEPTH) }

/** the air the desert sees, lit by the sun */
export const air = createAir(airUniforms)

/** the same air for the sky, whose rays run far enough to need finer steps; it draws at a fraction of the resolution */
const skyAir = createAir({ ...airUniforms, steps: 32 })

/**
 * The sky and clouds, drawn before the desert: rgb is their light, and alpha
 * how much of what lies behind the clouds shows through.
 */
export const skyTarget = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
const skyBehind = texture(skyTarget.texture, screenUV)

/** the camera's lowest and highest flight, meters over the sand */
export const ALTITUDE = { min: 150, max: 600 }

/** the cloud shell's base and top, meters over the ground: above the highest flight, since the march starts where a ray climbs through the base */
const CLOUD_BASE = ALTITUDE.max + 150
const CLOUD_TOP = CLOUD_BASE + 600
/** past this the clouds are lost in the haze */
const CLOUD_FAR = 13000
/** the deepest a ray marches into the shell */
const CLOUD_REACH = 3000
const CLOUD_STEPS = 18
const LIGHT_STEPS = 3
const LIGHT_STEP = 70
/** extinction per meter at full density */
const CLOUD_SIGMA = 0.04
/** density where the shapes are thickest */
const CLOUD_DENSITY = 1.6
/** large enough that half-res clouds don't beat against the march */
const CLOUD_SCALE = 1 / 1600

/** the camera, meters over the ground under it */
const eye = vec3(0, cameraPosition.y.sub(1).mul(RADIUS_METERS), 0)

/** whether rd from the camera meets the ground before it leaves the planet */
const grounded = (rd: Node<'vec3'>) => {
  const b = rd.y.mul(eye.y.add(RADIUS_METERS))
  return b.lessThan(0).and(b.mul(b).greaterThanEqual(eye.y.mul(eye.y.add(RADIUS_METERS * 2))))
}

/** how far rd from the camera runs before it climbs through `height` over the ground */
const exitAt = (rd: Node<'vec3'>, height: number) => {
  const b = rd.y.mul(eye.y.add(RADIUS_METERS)).toVar()
  // the eye's squared distance from the center less the sphere's
  const c = eye.y
    .sub(height)
    .mul(eye.y.add(RADIUS_METERS * 2 + height))
    .toVar()
  const root = sqrt(b.mul(b).sub(c)).toVar()
  // climbing rays take the form that doesn't cancel
  return select(b.greaterThan(0), c.negate().div(b.add(root)), root.sub(b))
}

/**
 * Cloud density at p: broad shapes over the coverage, with flat bases and
 * tops that narrow as they rise. `detailed` lets finer noise eat into their
 * edges so they billow rather than blur; the march toward the light skips it.
 */
const cloudAt = (p: Node<'vec3'>, detailed: boolean) => {
  const centered = vec3(p.x, p.y.add(RADIUS_METERS), p.z).toVar()
  // the clouds keep to the land as it turns under the camera
  const onLand = turnX(centered, sky.travel.negate()).sub(vec3(0, RADIUS_METERS, 0))
  const drift = vec3(sky.time.mul(sky.wind).mul(4.5), 0, sky.time.mul(sky.wind).mul(2))
  const at = onLand.add(drift).mul(CLOUD_SCALE).toVar()
  const h = length(centered)
    .sub(RADIUS_METERS + CLOUD_BASE)
    .div(CLOUD_TOP - CLOUD_BASE)
    .toVar()
  const profile = smoothstep(0, 0.1, h).mul(smoothstep(1, 0.4, h))
  const shape = fbm3(at, int(2))
    .sub(float(1).sub(sky.coverage))
    .div(max(sky.coverage, 0.05))
    .mul(profile)
    .sub(h.mul(0.15))
    .toVar()
  if (!detailed) return max(shape, 0).mul(sky.clouds).mul(CLOUD_DENSITY)
  const erode = fbm3(at.mul(4.3).add(7.1), int(2)).mul(0.35)
  return max(shape.sub(erode).div(float(1).sub(erode)), 0)
    .mul(sky.clouds)
    .mul(CLOUD_DENSITY)
}

/** Henyey-Greenstein, forward for the silver lining and a little back for the shadow side */
const cloudPhase = (mu: Node<'float'>) => {
  const hg = (g: number) =>
    float((1 - g * g) / (4 * Math.PI)).div(pow(max(mu.mul(-2 * g).add(1 + g * g), 1e-4), 1.5))
  return mix(hg(0.6), hg(-0.2), 0.3)
}

/** `behind` seen through the cloud shell along rd, with how much of it shows through */
const throughClouds = Fn(([rd, behind]: [Node<'vec3'>, Node<'vec3'>]) => {
  const result = vec4(behind, 1).toVar()
  const near = exitAt(rd, CLOUD_BASE).toVar()
  If(grounded(rd).not().and(near.lessThan(CLOUD_FAR)), () => {
    const far = min(exitAt(rd, CLOUD_TOP), near.add(CLOUD_REACH)).toVar()
    const ds = far.sub(near).div(CLOUD_STEPS).toVar()
    // a per-pixel start offset turns step banding into grain
    const jitter = hash12(screenCoordinate.xy)
    const transmittance = float(1).toVar()
    const lit = vec3(0).toVar()
    const phase = cloudPhase(dot(rd, sky.light))
      .mul(4 * Math.PI)
      .toVar()
    Loop(CLOUD_STEPS, ({ i }) => {
      If(transmittance.greaterThan(0.02), () => {
        const p = eye.add(rd.mul(near.add(float(i).add(jitter).mul(ds)))).toVar()
        const d = cloudAt(p, true).toVar()
        If(d.greaterThan(0.001), () => {
          const toLight = float(0).toVar()
          Loop(LIGHT_STEPS, ({ i: j }) => {
            toLight.addAssign(
              cloudAt(p.add(sky.light.mul(float(j).add(0.5).mul(LIGHT_STEP))), false),
            )
          })
          const sunlit = exp(toLight.mul(-CLOUD_SIGMA * LIGHT_STEP))
          // light that has scattered more than once reaches deeper and spreads evenly, lifting the shaded bases
          const spread = exp(toLight.mul(-CLOUD_SIGMA * LIGHT_STEP * 0.25)).mul(0.7)
          // dark edges where little has scattered yet
          const powder = float(1).sub(exp(d.mul(-CLOUD_SIGMA * 2 * 150)))
          const scatter = sky.lightColor
            .mul(sunlit.mul(phase).add(spread).mul(powder.mul(0.6).add(0.4)))
            .add(sky.ambient.mul(2.2))
          const step = exp(d.mul(ds).mul(-CLOUD_SIGMA))
          lit.addAssign(scatter.mul(transmittance.mul(float(1).sub(step))))
          transmittance.mulAssign(step)
        })
      })
    })
    // farther clouds sink into the haze until they're lost over the horizon
    const clouded = vec4(behind.mul(transmittance).add(lit), transmittance)
    result.assign(mix(clouded, result, smoothstep(0, CLOUD_FAR, near)))
  })
  return result
})

/** the atmosphere from the camera with the sun's and moon's glow, then the clouds; for `skyTarget` */
export const skyNode = Fn(() => {
  const dir = positionWorldDirection
  // rays under the limb look along it instead, so the target holds its color there
  const elevation = max(asin(clamp(dir.y, -1, 1)), sky.dip.negate())
  const level = normalize(vec2(dir.x, dir.z).add(vec2(0, 1e-6)))
  const rd = vec3(level.x.mul(cos(elevation)), sin(elevation), level.y.mul(cos(elevation))).toVar()
  const glow = vec3(1, 0.95, 0.85)
    .mul(pow(max(dot(rd, sky.sun), 0), 900).mul(1.5))
    .add(vec3(0.45, 0.55, 0.75).mul(pow(max(dot(rd, sky.moon), 0), 120).mul(0.08)))
  const col = skyAir.throughAir(cameraPosition, rd, float(1e4), glow).toVar()
  // the night sky's own faint glow, brightest low down
  col.addAssign(sky.ambient.mul(float(1).sub(rd.y).mul(0.8).add(0.2)))
  return throughClouds(rd, col)
})()

/** `skyTarget` behind the desert, with what needs every pixel behind its clouds: the stars and the sun's and moon's discs */
export const skyBackground = Fn(() => {
  const rd = positionWorldDirection.toVar()
  const cell = rd.mul(300)
  const star = step(0.986, hash13(cell.floor()))
    .mul(float(1).sub(smoothstep(0.05, 0.25, length(fract(cell).sub(0.5)))))
    .mul(hash13(cell.floor().add(3)).mul(0.7).add(0.3))
    .mul(smoothstep(0, 0.15, rd.y.add(sin(sky.dip))))
  const discs = vec3(star.mul(sky.stars).mul(0.8))
    .add(sky.sunColor.mul(smoothstep(0.99955, 0.9998, dot(rd, sky.sun)).mul(3)))
    .add(vec3(0.75, 0.8, 0.9).mul(smoothstep(0.99985, 0.99992, dot(rd, sky.moon)).mul(1.2)))
  return vec4(skyBehind.rgb.add(discs.mul(skyBehind.a)), 1)
})()
