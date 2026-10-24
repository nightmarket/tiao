/**
 * A low orbit over a unit planet at sunrise: a wide camera just above the
 * surface, tilted toward the horizon, so the limb curves across the frame with
 * the sun sitting on it, seen through the shared atmosphere.
 */
import {
  abs,
  clamp,
  cross,
  dot,
  Fn,
  float,
  fract,
  If,
  int,
  length,
  max,
  mix,
  modelNormalMatrix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  positionWorldDirection,
  pow,
  select,
  smoothstep,
  step,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl'
import { Color, MeshBasicNodeMaterial, type Node, Vector2, Vector3 } from 'three/webgpu'
import { createAir, sphereHit } from './atmosphere'
import { fbm3, hash13, noise3 } from './noise'

/** every earth uniform; the sun and its screen position are worked out on the CPU each frame */
export const earth = {
  /** the camera, in world space */
  eye: uniform(new Vector3(0, 1.12, 0)),
  time: uniform(0),
  /** degrees per second the planet turns, which also drifts the clouds */
  orbit: uniform(0),
  morph: uniform(0),
  /** how much the coastlines breathe; too much and the turning reads as morphing */
  wobble: uniform(0),
  seed: uniform(0),
  sea: uniform(0.47),
  landScale: uniform(2.4),
  clouds: uniform(1),
  relief: uniform(0.025),
  /** toward the sun, and toward the raised copy of it that lights the ground */
  sun: uniform(new Vector3(0, 0, -1)),
  lit: uniform(new Vector3(0, 0, -1)),
  density: uniform(1),
  haze: uniform(1),
  water: uniform(new Color()),
  ground: uniform(new Color()),
  /** the sun in screen uv (origin top left), far off screen when it is behind the camera */
  sunUv: uniform(new Vector2(-10, -10)),
  flare: uniform(1),
  /** how far the flare wanders */
  drift: uniform(1),
  exposure: uniform(1),
  grain: uniform(0),
  clock: uniform(0),
}

// ---- terrain ---------------------------------------------------------------

/** land height on the unit sphere; a slow drift morphs the continents and a flowing field makes coasts breathe */
const terrain = Fn(([n]: [Node<'vec3'>]) => {
  const drift = vec3(0, 0, earth.time.mul(earth.morph)).add(earth.seed)
  const base = mix(
    fbm3(n.mul(earth.landScale).add(drift), int(5)),
    fbm3(n.mul(earth.landScale.mul(0.35)).add(drift.mul(0.5)).add(40), int(2)),
    0.35,
  )
  const t = earth.time.mul(0.12)
  const wobble = fbm3(
    n
      .mul(earth.landScale.mul(1.4))
      .add(vec3(t.mul(0.9), t.mul(0.6), t.mul(-0.7)))
      .add(80),
    int(3),
  ).sub(0.5)
  const ripple = noise3(
    n
      .mul(earth.landScale.mul(4))
      .add(vec3(t.mul(-1.3), t.mul(1.1), t.mul(0.8)))
      .add(160),
  ).sub(0.5)
  return base.add(wobble.mul(0.075).add(ripple.mul(0.03)).mul(earth.wobble))
})

const landHeight = (h: Node<'float'>) =>
  smoothstep(earth.sea, earth.sea.add(0.18), h).mul(earth.relief)

const air = createAir(earth)

// ---- space -----------------------------------------------------------------

/** stars and the sun seen through the air; rays that reach the ground are left to the planet mesh */
export const spaceNode = Fn(() => {
  const rd = positionWorldDirection
  const col = vec3(0).toVar()
  If(sphereHit(earth.eye, rd, float(1)).x.lessThanEqual(0), () => {
    const cell = rd.mul(260)
    const star = step(0.985, hash13(cell.floor()))
      .mul(float(1).sub(smoothstep(0.05, 0.25, length(fract(cell).sub(0.5)))))
      .mul(hash13(cell.floor().add(3)).mul(0.6).add(0.4))
    col.addAssign(vec3(star.mul(0.6)))
    const toward = max(dot(rd, earth.sun), 0).toVar()
    col.addAssign(vec3(1, 0.98, 0.94).mul(smoothstep(0.9993, 0.9997, toward).mul(4)))
    col.addAssign(vec3(1, 0.95, 0.85).mul(pow(toward, 600).mul(1.2)))
    col.addAssign(vec3(0.9, 0.86, 0.8).mul(pow(toward, 60).mul(0.4)))
    col.assign(air.throughAir(earth.eye, rd, float(1e4), col))
  })
  return vec4(col, 1)
})()

// ---- planet ----------------------------------------------------------------

/** Pale water with a sun glint, dark rock, coast-hugging clouds, and a night side, seen through the air. */
export function planetMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  const n = normalize(positionGeometry)
  // the sphere pushed out by the land
  const surfacePoint = n.mul(landHeight(terrain(n)).add(1))
  material.positionNode = surfacePoint
  const worldPoint = varying(modelWorldMatrix.mul(vec4(surfacePoint, 1)).xyz)

  // the shading normal, from finite differences of the same field, worked out per vertex
  const displaced = varying(
    Fn(() => {
      const tangent = normalize(
        cross(n, select(abs(n.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0))),
      )
      const bitangent = cross(n, tangent)
      const e = 0.005
      const nt = normalize(n.add(tangent.mul(e)))
      const nb = normalize(n.add(bitangent.mul(e)))
      const p = n.mul(landHeight(terrain(n)).add(1))
      const pt = nt.mul(landHeight(terrain(nt)).add(1))
      const pb = nb.mul(landHeight(terrain(nb)).add(1))
      const normal = normalize(cross(pt.sub(p), pb.sub(p))).toVar()
      If(dot(normal, n).lessThan(0), () => {
        normal.assign(normal.negate())
      })
      return normal
    })(),
  )
  const objectNormal = varying(n)

  material.colorNode = Fn(() => {
    const objN = normalize(objectNormal).toVar()
    const toEye = earth.eye.sub(worldPoint).toVar()
    const view = normalize(toEye).toVar()
    const ng = normalize(modelNormalMatrix.mul(displaced)).toVar()
    const ns = normalize(modelNormalMatrix.mul(objN)).toVar()
    const highlights = 0.2

    const h = terrain(objN).toVar()
    const land = smoothstep(earth.sea.sub(0.006), earth.sea.add(0.006), h)
    const coast = float(1).sub(smoothstep(0, 0.06, abs(h.sub(earth.sea))))
    const relief = smoothstep(earth.sea, earth.sea.add(0.18), h).toVar()

    const ndl = dot(ng, earth.lit).toVar()
    const ndls = dot(ns, earth.lit).toVar()
    const day = smoothstep(-0.15, 0.25, ndls).toVar()
    const ndv = max(dot(ns, view), 0)
    const glint = pow(max(dot(ns, normalize(earth.lit.add(view))), 0), mix(180, 90, highlights))

    const water = earth.water
      .mul(mix(0.58, 0.78, highlights))
      .mul(day.mul(0.65).add(0.35))
      .add(vec3(1, 0.97, 0.9).mul(glint.mul(0.7 * highlights).mul(day)))
      .add(earth.water.mul(pow(float(1).sub(ndv), 2).mul(0.25)))

    const rock = fbm3(
      objN.mul(earth.landScale.mul(6)).add(vec3(0, 0, earth.time.mul(earth.morph))),
      int(3),
    )
    const ground = earth.ground.mul(relief.mul(1.1).add(0.45)).mul(rock.mul(0.45).add(0.55)).toVar()
    ground.assign(mix(ground, ground.mul(vec3(0.7, 0.75, 0.85)), float(1).sub(day)))
    ground.mulAssign(max(ndl, 0).mul(0.95).add(0.25))
    ground.assign(
      mix(
        ground,
        vec3(0.8, 0.82, 0.85).mul(max(ndl, 0).mul(0.6).add(0.4)),
        smoothstep(0.86, 0.98, relief).mul(mix(0.3, 0.5, highlights)),
      ),
    )

    const surface = mix(water, ground, land).toVar()
    // clouds drift a touch faster than the ground and gather at the coasts
    const turn = earth.time.mul(earth.orbit).mul((0.12 * Math.PI) / 180)
    const pc = vec3(
      objN.x,
      objN.y.mul(turn.cos()).add(objN.z.mul(turn.sin())),
      objN.y.mul(turn.sin().negate()).add(objN.z.mul(turn.cos())),
    )
    const cloud = smoothstep(
      0.6,
      0.74,
      fbm3(pc.mul(earth.landScale.mul(2.6)).add(vec3(0, earth.time.mul(0.01), 7)), int(4)).add(
        coast.mul(0.1),
      ),
    ).mul(earth.clouds)
    surface.assign(
      mix(
        surface,
        vec3(
          max(ndls, 0)
            .mul(0.55)
            .add(0.55)
            .mul(mix(0.7, 1, highlights)),
        ),
        clamp(cloud, 0, 1),
      ),
    )
    surface.assign(mix(surface.mul(vec3(0.12, 0.15, 0.22)), surface, day))

    return vec4(air.throughAir(earth.eye, view.negate(), length(toEye), surface), 1)
  })()
  return material
}
