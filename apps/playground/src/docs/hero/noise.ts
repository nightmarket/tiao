import { dot, Fn, float, floor, fract, Loop, mix, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

/** a cheap 3D hash in [0, 1) */
export const hash13 = Fn(([q]: [Node<'vec3'>]) => {
  const p = fract(q.mul(0.3183099).add(vec3(0.1, 0.2, 0.3)))
    .mul(17)
    .toVar()
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)))
}).setLayout({ name: 'hash13', type: 'float', inputs: [{ name: 'q', type: 'vec3' }] })

/** a cheap 2D hash in [0, 1), without a sine */
export const hash12 = Fn(([q]: [Node<'vec2'>]) => {
  const p = fract(vec3(q.x, q.y, q.x).mul(0.1031)).toVar()
  p.addAssign(dot(p, p.yzx.add(33.33)))
  return fract(p.x.add(p.y).mul(p.z))
}).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'q', type: 'vec2' }] })

/** smooth value noise in 3D */
export const noise3 = Fn(([x]: [Node<'vec3'>]) => {
  const i = floor(x).toVar()
  const f = fract(x).toVar()
  f.assign(f.mul(f).mul(f.mul(-2).add(3)))
  const corner = (a: number, b: number, c: number) => hash13(i.add(vec3(a, b, c)))
  return mix(
    mix(
      mix(corner(0, 0, 0), corner(1, 0, 0), f.x),
      mix(corner(0, 1, 0), corner(1, 1, 0), f.x),
      f.y,
    ),
    mix(
      mix(corner(0, 0, 1), corner(1, 0, 1), f.x),
      mix(corner(0, 1, 1), corner(1, 1, 1), f.x),
      f.y,
    ),
    f.z,
  )
}).setLayout({ name: 'noise3', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] })

/** normalized fbm of noise3 over `octaves` octaves */
export const fbm3 = Fn(([start, octaves]: [Node<'vec3'>, Node<'int'>]) => {
  const p = vec3(start).toVar()
  const amplitude = float(0.5).toVar()
  const sum = float(0).toVar()
  const norm = float(0).toVar()
  Loop({ start: 0, end: octaves }, () => {
    sum.addAssign(amplitude.mul(noise3(p)))
    norm.addAssign(amplitude)
    p.assign(p.mul(2.03).add(vec3(1.7, 9.2, 3.1)))
    amplitude.mulAssign(0.5)
  })
  return sum.div(norm)
}).setLayout({
  name: 'fbm3',
  type: 'float',
  inputs: [
    { name: 'start', type: 'vec3' },
    { name: 'octaves', type: 'int' },
  ],
})
