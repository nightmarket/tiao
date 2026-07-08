import type { ComponentType } from 'react'
import { ParticlesExample } from './particles'
import { ThreePerfExample } from './three-perf'

export interface Example {
  slug: string
  title: string
  Component: ComponentType
}

export const examples: Example[] = [
  { slug: 'particles', title: 'Particles', Component: ParticlesExample },
  { slug: 'three-perf', title: 'three.js perf', Component: ThreePerfExample },
]
