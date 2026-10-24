/**
 * A desert on a small planet that turns under a low camera, so it flies down
 * a winding valley between mesas, under the sky in sky.ts and through its air.
 * The land is a patch of the sphere ahead of the camera, raised by noise as
 * it's drawn. The patch turns by less than a pair of rows and the noise under
 * it by whole pairs, so each vertex keeps to the same spot of land as it passes.
 */
import {
  abs,
  atan,
  Break,
  cameraPosition,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  Fn,
  float,
  fract,
  fwidth,
  hash,
  If,
  instanceIndex,
  int,
  Loop,
  length,
  max,
  min,
  mix,
  modelNormalMatrix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  positionGeometry,
  positionWorld,
  select,
  sin,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type Node,
  Vector3,
} from 'three/webgpu'
import { turnX } from './atmosphere'
import { fbm3, noise3 } from './noise'
import { ALTITUDE, air, RADIUS_METERS, sky } from './sky'

const meters = (m: number) => m / RADIUS_METERS
/** how often noise repeats on the unit sphere for features `size` meters across */
const cells = (size: number) => RADIUS_METERS / size

/** every mesa uniform; its air is the sky's */
export const mesa = {
  /**
   * Toward the sun or moon that shades the land: as high over the land as it
   * shows over the limb, which sits lower than level from up here.
   */
  light: uniform(new Vector3(0, 0, -1)),
  sand: uniform(new Color()),
  rock: uniform(new Color()),
  /** share of the land the mesas cover */
  mesas: uniform(0.5),
  /** how tall the dunes are */
  dunes: uniform(1),
  /** radians the noise has turned under the land patch, a whole number of row pairs */
  snap: uniform(0),
}

// ---- land ------------------------------------------------------------------

/** how far the valley wanders either side of the flight path, and its half width */
const VALLEY_WANDER = meters(120)
const VALLEY_WIDTH = meters(260)
/** times the valley winds on the way around the planet, about every 12 km */
const VALLEY_WINDS = Math.max(1, Math.round((2 * Math.PI * RADIUS_METERS) / 12_000))
/** dunes, and the mesas' first and second tiers */
const DUNE_HEIGHT = meters(40)
const MESA_HEIGHT = meters(200)
const TIER_HEIGHT = meters(120)
const TALLEST = DUNE_HEIGHT + (MESA_HEIGHT + TIER_HEIGHT) * 1.04

/** the land at p on the unit sphere: its height in radii, and how much of it is rock */
const landAt = (p: Node<'vec3'>) => {
  const along = atan(p.z, p.y)
  const valley = smoothstep(
    VALLEY_WIDTH * 0.6,
    VALLEY_WIDTH * 1.5,
    abs(p.x.sub(sin(along.mul(VALLEY_WINDS)).mul(VALLEY_WANDER))),
  )
  const mass = fbm3(p.mul(cells(700)).add(5), int(3)).toVar()
  const edge = mix(0.68, 0.46, mesa.mesas).toVar()
  // a talus that steepens into a cliff with a sharp rim, a few rows wide so it holds its light
  const rise = clamp(mass.sub(edge).div(0.12), 0, 1).mul(valley).toVar()
  const tier = clamp(mass.sub(edge).sub(0.15).div(0.08), 0, 1).mul(valley)
  const rock = rise
    .mul(rise)
    .mul(MESA_HEIGHT)
    .add(tier.mul(tier).mul(TIER_HEIGHT))
    .mul(
      noise3(p.mul(cells(1000)))
        .mul(0.12)
        .add(0.92),
    )
  // the sand drifts in the valley and leaves the mesas' caps flat
  const dunes = fbm3(p.mul(cells(450)), int(3)).mul(
    mesa.dunes.mul(DUNE_HEIGHT).mul(float(1).sub(rise.mul(0.85))),
  )
  return vec2(dunes.add(rock), rise)
}

/** meters between rows of the land */
const ROW_METERS = 16
/** rows around the whole planet, even so the noise can turn by pairs of them */
const AROUND = 2 * Math.round((Math.PI * RADIUS_METERS) / ROW_METERS)
/** radians between rows */
export const ROW = (2 * Math.PI) / AROUND
/**
 * How far the land reaches ahead and to either side, radians: to the horizon
 * from the highest flight, and on as far as the tallest mesa still shows over it.
 */
const REACH = Math.acos(1 / (1 + meters(ALTITUDE.max))) + Math.sqrt(2 * TALLEST)
/** rows behind the camera, for the corners of a steep frame */
const BEHIND = 6
/** columns across, packed toward the flight path so they meet it about square */
const ACROSS = 2 * Math.ceil((0.4 * REACH) / ROW)

/** the land at p on the patch, which the noise has turned under */
const patchAt = (p: Node<'vec3'>) => landAt(turnX(p, mesa.snap.negate()))

/**
 * The slope of the patch's land at n, with height h, from neighbours a row
 * away, so the light follows the faces the land is drawn with.
 */
const patchNormal = (n: Node<'vec3'>, h: Node<'float'>) => {
  const tangent = normalize(cross(n, select(abs(n.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0))))
  const bitangent = cross(n, tangent)
  const nt = normalize(n.add(tangent.mul(ROW)))
  const nb = normalize(n.add(bitangent.mul(ROW)))
  const p0 = n.mul(h.add(1))
  const pt = nt.mul(patchAt(nt).x.add(1))
  const pb = nb.mul(patchAt(nb).x.add(1))
  const normal = normalize(cross(pt.sub(p0), pb.sub(p0))).toVar()
  return select(dot(normal, n).lessThan(0), normal.negate(), normal)
}

/** the first step toward the light, how much each step outreaches the last, and how many: out to about 2 km, finely enough that a ridge's shade doesn't step */
const SHADOW_START = meters(24)
const SHADOW_GROWTH = 1.28
const SHADOW_STEPS = 18
/** how hard the light cuts off past a ridge: the cotangent of the penumbra's angle */
const SHADOW_HARDNESS = 20
/** how far off the surface the march starts, so a cliff doesn't shade itself where the light runs up it */
const SHADOW_OFFSET = meters(8)

/**
 * How much light reaches p from toward `toLight`, both in the frame of the
 * land `heightAt` describes: marched out toward it until the ray clears the
 * tallest mesa, soft where it grazes a ridge.
 */
const sunlitOver = (heightAt: (q: Node<'vec3'>) => Node<'float'>) =>
  Fn(([p, toLight]: [Node<'vec3'>, Node<'vec3'>]) => {
    const lit = float(1).toVar()
    const t = float(SHADOW_START).toVar()
    Loop(SHADOW_STEPS, () => {
      const q = p.add(toLight.mul(t)).toVar()
      const r = length(q).toVar()
      If(r.greaterThan(TALLEST + 1), () => {
        Break()
      })
      lit.assign(
        min(
          lit,
          r
            .sub(heightAt(q.div(r)).add(1))
            .div(t)
            .mul(SHADOW_HARDNESS),
        ),
      )
      t.mulAssign(SHADOW_GROWTH)
    })
    return smoothstep(0, 1, lit)
  })

/** the land's light in the frame of the mesh being drawn */
const localLight = () => normalize(modelWorldMatrixInverse.mul(vec4(mesa.light, 0)).xyz)

/** one normal per face, from how the position changes across it, turned toward the eye */
const facet = (world: Node<'vec3'>) => {
  const n = normalize(cross(dFdx(world), dFdy(world))).toVar()
  return select(dot(n, cameraPosition.sub(world)).lessThan(0), n.negate(), n)
}

/** cel shading: a face is in the sun or moon, past a narrow edge and out of the shadows, or in the shade */
const sunSide = (n: Node<'vec3'>, sunlit: Node<'float'>) =>
  smoothstep(0, 0.06, dot(n, mesa.light)).mul(smoothstep(0.35, 0.65, sunlit))

/**
 * A face's color: flat in the sun or moon, and in the shade lit by the sky,
 * brighter where it faces up. `rim` brightens the silhouette on the lit side,
 * the way rock catches the light at its edges. Then the air in between.
 */
const lit = (
  albedo: Node<'vec3'>,
  n: Node<'vec3'>,
  world: Node<'vec3'>,
  direct: Node<'float'>,
  rim: Node<'float'>,
) => {
  const toEye = cameraPosition.sub(world).toVar()
  const dist = length(toEye).max(1e-5)
  const view = toEye.div(dist)
  const shade = sky.ambient.mul(dot(n, normalize(world)).mul(0.4).add(1.2))
  const edge = smoothstep(0.55, 0.85, float(1).sub(max(dot(n, view), 0)))
    .mul(direct.mul(0.75).add(0.25))
    .mul(rim)
  const color = albedo
    .mul(sky.lightColor.mul(direct).add(shade))
    .add(sky.lightColor.mul(edge.mul(0.3)))
  return air.throughAir(cameraPosition, view.negate(), dist, color)
}

/** sedimentary bands up the cliffs, meters apart */
const STRATA_METERS = 36

/**
 * Bands of rock by height at `ground`, a point fixed to the land, warped a
 * little. Both edges of each band are filtered, they even out to their mean
 * before they're finer than a pixel, and they stay off flat ground and out of
 * the shade (`direct`), where they'd read as stripes.
 */
const strataAt = (
  ground: Node<'vec3'>,
  height: Node<'float'>,
  steep: Node<'float'>,
  direct: Node<'float'>,
) => {
  const layer = height
    .div(meters(STRATA_METERS))
    .add(noise3(ground.mul(cells(500))).mul(0.6))
    .add(noise3(ground.mul(cells(90))).mul(0.25))
    .toVar()
  const w = max(fwidth(layer), 1e-4).toVar()
  const band = smoothstep(w.mul(-0.5), w.mul(0.5), abs(fract(layer).sub(0.5)).sub(0.25))
  const show = float(1)
    .sub(smoothstep(0.25, 0.5, w))
    .mul(smoothstep(0.25, 0.55, steep))
    .mul(direct)
  return mix(0.94, mix(0.88, 1, band), show)
}

/**
 * A patch of the unit sphere from just behind the camera to `REACH` ahead and
 * either side of the great circle x = 0. Its rows lie a whole `ROW` apart, so
 * turning the noise by pairs of them lands every vertex where another just
 * was, and their diagonals alternate so the faces don't all lean one way.
 */
function patchGeometry(): BufferGeometry {
  const ahead = Math.ceil(REACH / ROW)
  const rows = ahead + BEHIND + 1
  const columns = ACROSS + 1
  const positions = new Float32Array(rows * columns * 3)
  for (let i = 0; i < rows; i++) {
    const u = (i - ahead) * ROW
    for (let j = 0; j < columns; j++) {
      const s = (j / ACROSS) * 2 - 1
      const v = REACH * (0.4 * s + 0.6 * s ** 3)
      positions.set(
        [Math.sin(v), Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u)],
        (i * columns + j) * 3,
      )
    }
  }
  const indices: number[] = []
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * columns + j
      const b = a + columns
      if ((i + j) % 2) indices.push(a, b, a + 1, b, b + 1, a + 1)
      else indices.push(a, b, b + 1, a, b + 1, a + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}

/**
 * The land, sand in the valley and rock in the mesas, laid down in bands up
 * their cliffs and shadowed by them. Turn it by the flight less `mesa.snap`.
 */
export function createLand(): Mesh<BufferGeometry, MeshBasicNodeMaterial> {
  const material = new MeshBasicNodeMaterial()
  const land = patchAt(positionGeometry).toVar()
  const surface = positionGeometry.mul(land.x.add(1)).toVar()
  material.positionNode = surface
  const height = varying(land.x)
  const rock = varying(land.y)
  const ground = varying(turnX(surface, mesa.snap.negate()))
  const world = varying(modelWorldMatrix.mul(vec4(surface, 1)).xyz)
  const normal = patchNormal(positionGeometry, land.x).toVar()
  const slope = varying(normal)
  const shadowAt = sunlitOver((q) => patchAt(q).x)
  const position = varying(surface)
  const vertexLit = varying(shadowAt(surface.add(normal.mul(SHADOW_OFFSET)), localLight()))
  material.colorNode = Fn(() => {
    // a triangle a shadow's edge crosses marches its own pixels, so the edge follows the land rather than the triangles
    const sunlit = vertexLit.toVar()
    If(sunlit.greaterThan(0.01).and(sunlit.lessThan(0.99)), () => {
      sunlit.assign(shadowAt(position.add(normalize(slope).mul(SHADOW_OFFSET)), localLight()))
    })
    const n = normalize(modelNormalMatrix.mul(slope)).toVar()
    const steep = float(1)
      .sub(dot(n, normalize(world)))
      .toVar()
    const stone = max(rock, smoothstep(0.4, 0.7, steep)).toVar()
    const direct = sunSide(n, sunlit).toVar()
    const sand = mesa.sand.mul(mix(0.88, 1.04, smoothstep(0, DUNE_HEIGHT, height)))
    const layered = mesa.rock.mul(strataAt(ground, height, steep, direct))
    return vec4(lit(mix(sand, layered, stone), n, world, direct, stone), 1)
  })()
  return new Mesh(patchGeometry(), material)
}

/** boulders all the way around, about one every 40 m along the valley; fewer where it's rock */
const BOULDERS = Math.round((2 * Math.PI * RADIUS_METERS) / 42)

/** low-poly boulders scattered near the flight path, set on the land below them; turn them by the whole flight */
export function createBoulders(): Mesh<InstancedBufferGeometry, MeshBasicNodeMaterial> {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new IcosahedronGeometry(1, 0).getAttribute('position'))
  geometry.instanceCount = BOULDERS
  const material = new MeshBasicNodeMaterial()
  const id = float(instanceIndex)
  const random = (k: number) => hash(id.mul(8).add(k))
  const along = random(1).mul(Math.PI * 2)
  const across = random(2).sub(0.5).mul(meters(1600))
  const up = vec3(sin(across), cos(across).mul(cos(along)), cos(across).mul(sin(along))).toVar()
  const ground = landAt(up).toVar()
  // mostly stones, a few blocks
  const size = mix(meters(10), meters(70), random(3).pow(3)).mul(float(1).sub(ground.y))
  const shape = vec3(mix(0.7, 1.6, random(4)), mix(0.45, 1.1, random(5)), mix(0.6, 1.4, random(6)))
    .mul(size)
    .toVar()
  // a frame on the ground under the boulder, turned about the up
  const yaw = random(7).mul(Math.PI * 2)
  const east = normalize(cross(vec3(1, 0, 0), up))
  const side = east
    .mul(cos(yaw))
    .add(cross(up, east).mul(sin(yaw)))
    .toVar()
  const local = positionGeometry.mul(shape)
  const base = up.mul(ground.x.add(1)).toVar()
  material.positionNode = base
    .sub(up.mul(shape.y.mul(0.35)))
    .add(side.mul(local.x))
    .add(up.mul(local.y))
    .add(cross(side, up).mul(local.z))
  // the same for the whole boulder, from the ground it sits on
  const sunlit = varying(
    sunlitOver((q) => landAt(q).x)(base.add(up.mul(SHADOW_OFFSET)), localLight()),
  )
  material.colorNode = Fn(() => {
    const albedo = mix(mesa.rock, vec3(0.62, 0.56, 0.62), 0.45)
    const n = facet(positionWorld).toVar()
    return vec4(lit(albedo, n, positionWorld, sunSide(n, sunlit), float(1)), 1)
  })()
  const mesh = new Mesh(geometry, material)
  // placed in the shader, so the geometry's bounds say nothing about where it is
  mesh.frustumCulled = false
  return mesh
}
