/**
 * Raymarched Rayleigh, Mie, and ozone scattering in a shell around a unit
 * planet, lit by one sun. The orbit and the desert both look through it: one
 * from above the limb, the other from inside the shell.
 */
import {
  abs,
  cos,
  dot,
  exp,
  Fn,
  float,
  If,
  Loop,
  length,
  max,
  min,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
} from 'three/tsl'
import type { Node } from 'three/webgpu'

// planet radii; the shell and its scale heights are ~7x Earth's, so the limb reads at this size
const ATMOSPHERE_TOP = 1.045
const RAYLEIGH_HEIGHT = 0.009
const MIE_HEIGHT = 0.0025
const OZONE_PEAK = 0.004
const OZONE_WIDTH = 0.003
/** Earth's per-km coefficients, rescaled to planet radii and the thicker shell */
const RAYLEIGH = vec3(5.2, 12.1, 29.6)
const MIE_SCATTER = 1.6
const MIE_EXTINCTION = 1.8
const OZONE = vec3(6.5, 18.8, 0.8)
const MIE_G = 0.8
const SUN_INTENSITY = 16
const VIEW_STEPS = 14
const LIGHT_STEPS = 5
/** how far inside the limb, in planet radii, sunlight fades out rather than stopping where the ray first grazes it */
const PENUMBRA = 0.12
/** points across each view step the planet's shadow is averaged over */
const SHADOW_TAPS = 4
/**
 * Light scattered more than once, as a share of the sun's: it fills the air the
 * planet shades at twilight, so the shade's edge reads as a gradient rather
 * than a line. Only around the air's own sunrise: by day the sky is bright
 * enough without it, and it fades out as the sun sinks well below.
 */
const MULTIPLE = 0.35

/** distances along rd where it enters and leaves a sphere of radius r at the origin; negative on a miss */
export const sphereHit = Fn(([ro, rd, r]: [Node<'vec3'>, Node<'vec3'>, Node<'float'>]) => {
  const b = dot(ro, rd).toVar()
  const d = b.mul(b).sub(dot(ro, ro)).add(r.mul(r)).toVar()
  const hit = vec2(-1).toVar()
  If(d.greaterThanEqual(0), () => {
    const root = sqrt(d)
    hit.assign(vec2(b.negate().sub(root), b.negate().add(root)))
  })
  return hit
}).setLayout({
  name: 'sphereHit',
  type: 'vec2',
  inputs: [
    { name: 'ro', type: 'vec3' },
    { name: 'rd', type: 'vec3' },
    { name: 'r', type: 'float' },
  ],
})

/** v turned by `angle` about the x axis, which the planets here spin around */
export const turnX = (v: Node<'vec3'>, angle: Node<'float'>) =>
  vec3(
    v.x,
    v.y.mul(cos(angle)).sub(v.z.mul(sin(angle))),
    v.y.mul(sin(angle)).add(v.z.mul(cos(angle))),
  )

const rayleighPhase = (mu: Node<'float'>) =>
  mu
    .mul(mu)
    .add(1)
    .mul(3 / (16 * Math.PI))

const miePhase = (mu: Node<'float'>) => {
  const gg = MIE_G * MIE_G
  return mu
    .mul(mu)
    .add(1)
    .mul(3 * (1 - gg))
    .div(pow(max(mu.mul(-2 * MIE_G).add(1 + gg), 1e-4), 1.5).mul(8 * Math.PI * (2 + gg)))
}

/** the uniforms the air reads: toward the sun, and how thick its blue and its haze are */
export interface AirUniforms {
  sun: Node<'vec3'>
  density: Node<'float'>
  haze: Node<'float'>
  /**
   * How many times deeper than the orbit's the shell and its scale heights
   * are, at the same thickness overhead, so a camera low over a small world
   * flies in the air rather than at its top; 1 when unset.
   */
  depth?: Node<'float'>
  /** steps along each view ray; more for long rays, which slice the planet's shadow into contours with too few */
  steps?: number
}

/**
 * The air lit by `u.sun`. Its functions read uniforms, so they stay inline
 * rather than taking a layout, which would type the closed-over vec3 as a float.
 */
export function createAir(u: AirUniforms) {
  const depth = u.depth ?? float(1)
  const steps = u.steps ?? VIEW_STEPS
  const top = depth.mul(ATMOSPHERE_TOP - 1).add(1)

  /** Rayleigh, Mie, and ozone along a step of `ds` at p, thinned as the shell deepens */
  const densityOver = (p: Node<'vec3'>, ds: Node<'float'>) => {
    const h = max(length(p).sub(1), 0).div(depth).toVar()
    return vec3(
      exp(h.negate().div(RAYLEIGH_HEIGHT)),
      exp(h.negate().div(MIE_HEIGHT)),
      max(0, float(1).sub(abs(h.sub(OZONE_PEAK)).div(OZONE_WIDTH))),
    ).mul(ds.div(depth))
  }

  const extinction = Fn(([optical]: [Node<'vec3'>]) => {
    return RAYLEIGH.mul(u.density.mul(optical.x))
      .add(u.haze.mul(optical.y).mul(MIE_EXTINCTION))
      .add(OZONE.mul(u.density.mul(optical.z)))
  })

  /**
   * Optical depth from p to the sun. A ray the planet is in the way of counts
   * only the air up to where it passes closest, rather than the planet as
   * solid air, so the light fades as smoothly as `sunOver` lets it.
   */
  const sunDepth = Fn(([p]: [Node<'vec3'>]) => {
    const along = dot(p, u.sun).toVar()
    const blocked = along.lessThan(0).and(dot(p, p).sub(along.mul(along)).lessThan(1))
    const ds = select(blocked, along.negate(), sphereHit(p, u.sun, top).y)
      .div(LIGHT_STEPS)
      .toVar()
    const optical = vec3(0).toVar()
    Loop(LIGHT_STEPS, ({ i }) => {
      optical.addAssign(densityOver(p.add(u.sun.mul(float(i).add(0.5).mul(ds))), ds))
    })
    return optical
  })

  /**
   * How much of the sun p sees past the planet: all of it while its ray clears
   * the limb, fading to none as the ray cuts deeper, so the planet's shadow in
   * the air has a soft edge.
   */
  const sunOver = (p: Node<'vec3'>) => {
    const along = dot(p, u.sun).toVar()
    const miss = sqrt(max(dot(p, p).sub(along.mul(along)), 0))
    return select(along.greaterThanEqual(0), float(1), smoothstep(1 - PENUMBRA, 1, miss))
  }

  /**
   * sunOver averaged across the view step centered on p, so the shadow's edge
   * sweeps smoothly through the step instead of the whole step flipping at once.
   * Cheap next to the march toward the sun, which stays one per step.
   */
  const sunOverStep = (p: Node<'vec3'>, step: Node<'vec3'>) => {
    let sum: Node<'float'> = float(0)
    for (let k = 0; k < SHADOW_TAPS; k++) {
      sum = sum.add(sunOver(p.add(step.mul((k + 0.5) / SHADOW_TAPS - 0.5))))
    }
    return sum.div(SHADOW_TAPS)
  }

  /**
   * What reaches the eye along ro + rd * [0, far]: `behind`, dimmed by the air
   * in the way, plus the sunlight that air scatters toward the eye.
   */
  const throughAir = Fn(
    ([ro, rd, far, behind]: [Node<'vec3'>, Node<'vec3'>, Node<'float'>, Node<'vec3'>]) => {
      const result = vec3(behind).toVar()
      const shell = sphereHit(ro, rd, top).toVar()
      const t0 = max(shell.x, 0).toVar()
      const t1 = min(shell.y, far).toVar()
      If(shell.y.greaterThan(0).and(t1.greaterThan(t0)), () => {
        const ds = t1.sub(t0).div(steps).toVar()
        const view = vec3(0).toVar()
        const sumR = vec3(0).toVar()
        const sumM = vec3(0).toVar()
        Loop(steps, ({ i }) => {
          const p = ro.add(rd.mul(t0.add(float(i).add(0.5).mul(ds)))).toVar()
          const d = densityOver(p, ds).toVar()
          view.addAssign(d)
          const sunHeight = dot(p, u.sun).div(length(p)).toVar()
          const twilight = smoothstep(-0.35, -0.02, sunHeight).mul(smoothstep(0.3, 0.05, sunHeight))
          const lit = exp(extinction(view.add(sunDepth(p))).negate())
            .mul(sunOverStep(p, rd.mul(ds)))
            .add(exp(extinction(view).negate()).mul(twilight.mul(MULTIPLE)))
            .toVar()
          sumR.addAssign(lit.mul(d.x))
          sumM.addAssign(lit.mul(d.y))
        })
        const mu = dot(rd, u.sun).toVar()
        const air = sumR
          .mul(RAYLEIGH)
          .mul(u.density.mul(rayleighPhase(mu)))
          .add(sumM.mul(u.haze.mul(miePhase(mu)).mul(MIE_SCATTER)))
          .mul(SUN_INTENSITY)
        result.assign(behind.mul(exp(extinction(view).negate())).add(air))
      })
      return result
    },
  )

  return { throughAir }
}
