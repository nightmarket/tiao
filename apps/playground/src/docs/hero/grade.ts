/**
 * The frame's finish, shared by the scenes with a sun: exposure, a chromatic
 * lens flare that follows the sun across the frame, the bloom, a tone curve,
 * vignette, and grain.
 */
import {
  abs,
  atan,
  clamp,
  dot,
  exp,
  Fn,
  float,
  fract,
  length,
  max,
  mix,
  pow,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, TextureNode } from 'three/webgpu'
import { hash12 } from './noise'

/** what the finish reads; the sun's screen position is worked out on the CPU each frame */
export interface LensUniforms {
  /** the sun in screen uv (origin top left), far off screen when it is behind the camera */
  sunUv: Node<'vec2'>
  exposure: Node<'float'>
  flare: Node<'float'>
  /** how far the flare wanders */
  drift: Node<'float'>
  grain: Node<'float'>
  /** seconds, for the flare's wander and the grain */
  clock: Node<'float'>
}

const disc = (p: Node<'vec2'>, r: number, soft: number) =>
  float(1).sub(smoothstep(r - soft, r + soft, length(p)))

/** one ghost along the sun-to-centre axis, each channel scaled a little differently so its edge fringes */
const ghost = (
  p: Node<'vec2'>,
  s: Node<'vec2'>,
  f: number,
  r: number,
  tint: [number, number, number],
  spread: number,
) => {
  const channel = (c: number) => {
    const q = p.sub(s.mul(f * (1 + spread * (c - 1))))
    return disc(q, r, r * 0.35).mul(smoothstep(0, r, length(q)).mul(0.45).add(0.55))
  }
  return vec3(channel(0), channel(1), channel(2)).mul(vec3(...tint))
}

/**
 * The frame's light: exposure, then a chromatic lens flare from the sun that
 * shows only while the frame is bright where the sun is (so the planet passing
 * in front puts it out), plus `glow`, then a tone curve, vignette, and grain.
 */
/** how far toward an S-curve the tone curve bends */
const CONTRAST = 0.3

export function lensGrade(u: LensUniforms, scene: TextureNode, glow: Node<'vec4'>) {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y)
    const frame = vec2(aspect, 1)
    const t = u.clock
    const col = scene.rgb.mul(u.exposure).toVar()

    const s = u.sunUv
      .sub(0.5)
      .mul(frame)
      .add(
        vec2(
          sin(t.mul(0.37)).add(sin(t.mul(1.1)).mul(0.5)),
          t
            .mul(0.23)
            .cos()
            .add(sin(t.mul(0.83)).mul(0.5)),
        ).mul(u.drift.mul(0.012)),
      )
      .toVar()
    const sunUv = s.div(frame).add(0.5).toVar()
    const bright = float(0).toVar()
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      bright.addAssign(
        dot(scene.sample(clamp(sunUv.add(vec2(x, y).mul(0.004)), 0, 1)).rgb, vec3(1 / 3)),
      )
    }
    const outside = max(abs(sunUv.sub(0.5)).sub(0.5), 0)
    const visible = smoothstep(0.35, 1.2, bright.mul(0.25))
      .mul(float(1).sub(smoothstep(0, 0.12, max(outside.x, outside.y))))
      .mul(
        sin(t.mul(2.3))
          .mul(sin(t.mul(0.7).add(1)))
          .mul(0.1)
          .add(0.9),
      )

    const p = screenUV.sub(0.5).mul(frame).toVar()
    const d = p.sub(s).toVar()
    const flare = vec3(1, 0.85, 0.65)
      .mul(float(0.018).div(length(d).mul(6).add(0.08)))
      .add(
        vec3(0.35, 0.55, 1).mul(
          exp(abs(d.y).mul(-90))
            .mul(exp(abs(d.x).mul(-1.9)))
            .mul(0.9),
        ),
      )
      .add(
        vec3(1, 0.4, 0.2).mul(
          exp(abs(d.y).mul(-160))
            .mul(exp(abs(d.x).mul(-3.5)))
            .mul(0.35),
        ),
      )
      .add(ghost(p, s, -0.3, 0.045, [1, 0.55, 0.35], 0.05).mul(0.34))
      .add(ghost(p, s, -0.62, 0.085, [0.45, 0.85, 1], 0.06).mul(0.22))
      .add(ghost(p, s, -1.05, 0.03, [1, 0.9, 0.6], 0.08).mul(0.45))
      .add(ghost(p, s, -1.45, 0.13, [0.7, 0.45, 1], 0.05).mul(0.16))
      .add(ghost(p, s, 0.42, 0.06, [0.5, 1, 0.7], 0.07).mul(0.2))
      .add(ghost(p, s, -1.95, 0.06, [1, 0.5, 0.8], 0.09).mul(0.26))
      .toVar()
    // a rainbow halo ring, each channel at its own radius
    const halo = p.add(s.mul(0.45)).toVar()
    const hr = length(halo)
    const ring = vec3(
      float(1).sub(smoothstep(0, 0.03, abs(hr.sub(0.34)))),
      float(1).sub(smoothstep(0, 0.03, abs(hr.sub(0.355)))),
      float(1).sub(smoothstep(0, 0.03, abs(hr.sub(0.37)))),
    )
    flare.addAssign(
      ring
        .mul(
          sin(atan(halo.y, halo.x).mul(5).add(t.mul(0.3)))
            .mul(0.4)
            .add(0.6),
        )
        .mul(0.1),
    )
    col.addAssign(flare.mul(visible).mul(u.flare))
    col.addAssign(glow.rgb)

    col.assign(col.div(col.mul(0.35).add(1)))
    // a gentle S-curve, so the twilight's darks read deep rather than lifted
    col.assign(mix(col, smoothstep(0, 1, col), CONTRAST))
    col.mulAssign(float(1).sub(pow(length(screenUV.sub(0.5).mul(vec2(1.1, 1))), 2.6).mul(0.25)))
    col.addAssign(
      hash12(screenUV.mul(screenSize).add(fract(t).mul(61)))
        .sub(0.5)
        .mul(u.grain),
    )
    return vec4(col, 1)
  })()
}
