import { Color, MathUtils, type Vector3 } from 'three/webgpu'

/** how far the sun's path leans off overhead, so midday light rakes across the desert */
const LEAN = MathUtils.degToRad(28)

/**
 * The direction to the sun at `hour` (0 to 24): it rises straight ahead at
 * six, passes high and a little to the right at noon, and sets behind the
 * camera at eighteen, when the moon, always opposite, rises ahead.
 */
export function sunAt(out: Vector3, hour: number): Vector3 {
  const a = ((hour - 6) / 24) * Math.PI * 2
  return out.set(Math.sin(a) * Math.sin(LEAN), Math.sin(a) * Math.cos(LEAN), -Math.cos(a))
}

/** the light over the desert at one moment, in linear color */
export interface DayLight {
  sun: Color
  moon: Color
  /** the sky's light from every direction */
  ambient: Color
  stars: number
  /** brightens the night so it reads, and calms the noon */
  exposure: number
}

export const createDayLight = (): DayLight => ({
  sun: new Color(),
  moon: new Color(),
  ambient: new Color(),
  stars: 0,
  exposure: 1,
})

type Rgb = [number, number, number]

interface Key {
  /** sun elevation, degrees */
  at: number
  sun: Rgb
  moon: Rgb
  ambient: Rgb
  stars: number
  exposure: number
}

const NIGHT: Omit<Key, 'at'> = {
  sun: [0, 0, 0],
  moon: [0.09, 0.11, 0.17],
  ambient: [0.006, 0.009, 0.02],
  stars: 1,
  exposure: 2.2,
}

const NOON: Omit<Key, 'at'> = {
  sun: [2.1, 2, 1.85],
  moon: [0, 0, 0],
  ambient: [0.28, 0.36, 0.5],
  stars: 0,
  exposure: 0.55,
}

/** by sun elevation, low to high; values between keys mix linearly */
const KEYS: Key[] = [
  { at: -90, ...NIGHT },
  { at: -20, ...NIGHT },
  {
    at: -9,
    sun: [0, 0, 0],
    moon: [0.05, 0.06, 0.09],
    ambient: [0.02, 0.025, 0.05],
    stars: 0.75,
    exposure: 1.4,
  },
  {
    at: -3,
    sun: [0.25, 0.08, 0.04],
    moon: [0, 0, 0],
    ambient: [0.06, 0.055, 0.08],
    stars: 0.2,
    exposure: 0.95,
  },
  {
    at: 2,
    sun: [1.3, 0.55, 0.25],
    moon: [0, 0, 0],
    ambient: [0.12, 0.11, 0.14],
    stars: 0,
    exposure: 0.85,
  },
  {
    at: 10,
    sun: [1.8, 1.3, 0.9],
    moon: [0, 0, 0],
    ambient: [0.2, 0.24, 0.32],
    stars: 0,
    exposure: 0.7,
  },
  { at: 35, ...NOON },
  { at: 90, ...NOON },
]

const mixRgb = (out: Color, a: Rgb, b: Rgb, t: number) =>
  out.setRGB(
    MathUtils.lerp(a[0], b[0], t),
    MathUtils.lerp(a[1], b[1], t),
    MathUtils.lerp(a[2], b[2], t),
  )

/** the light when the sun stands `elevation` degrees above the horizon */
export function lightAt(elevation: number, out: DayLight): DayLight {
  const next = Math.max(
    1,
    KEYS.findIndex((key) => key.at >= elevation),
  )
  const a = KEYS[next - 1]!
  const b = KEYS[next]!
  const t = MathUtils.clamp((elevation - a.at) / (b.at - a.at), 0, 1)
  mixRgb(out.sun, a.sun, b.sun, t)
  mixRgb(out.moon, a.moon, b.moon, t)
  mixRgb(out.ambient, a.ambient, b.ambient, t)
  out.stars = MathUtils.lerp(a.stars, b.stars, t)
  out.exposure = MathUtils.lerp(a.exposure, b.exposure, t)
  return out
}
