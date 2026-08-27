import type { ComponentType } from 'react'
import { ParticlesExample } from './particles'
import { ShowcaseExample } from './showcase'
import { ThreePerfExample } from './three-perf'

export interface Example {
  slug: string
  title: string
  Component: ComponentType
  /** artwork for the nav pane's thumbnail grid */
  thumb: string
}

const SHOWCASE_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20">
  <rect width="32" height="20" fill="#18181b"/>
  <rect x="3" y="3" width="26" height="3" rx="0.6" fill="#3f3f46"/>
  <rect x="3" y="8" width="26" height="3" rx="0.6" fill="#3f3f46"/>
  <rect x="3" y="13" width="16" height="3" rx="0.6" fill="#a78bfa"/>
  <circle cx="26" cy="14.5" r="2" fill="#a78bfa"/>
</svg>`

const PARTICLES_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20">
  <rect width="32" height="20" fill="#0b1120"/>
  <g fill="#7dd3fc">
    <circle cx="7" cy="6" r="1.6"/><circle cx="16" cy="10" r="2.6"/>
    <circle cx="24" cy="6" r="1.2"/><circle cx="12" cy="15" r="1"/>
    <circle cx="22" cy="15" r="1.9"/><circle cx="28" cy="12" r="0.9"/>
  </g>
</svg>`

const THREE_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20">
  <rect width="32" height="20" fill="#111827"/>
  <path d="M16 3l7 4v6l-7 4-7-4V7z" fill="none" stroke="#fb923c" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M9 7l7 4 7-4M16 11v6" fill="none" stroke="#fb923c" stroke-width="1" opacity="0.55"/>
</svg>`

export const examples: Example[] = [
  { slug: 'showcase', title: 'Showcase', Component: ShowcaseExample, thumb: SHOWCASE_THUMB },
  { slug: 'particles', title: 'Particles', Component: ParticlesExample, thumb: PARTICLES_THUMB },
  { slug: 'three-perf', title: 'three.js perf', Component: ThreePerfExample, thumb: THREE_THUMB },
]
