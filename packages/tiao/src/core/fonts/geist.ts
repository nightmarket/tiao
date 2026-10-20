import geistSrc from './Geist-Variable.woff2'
import geistMonoSrc from './GeistMono-Variable.woff2'

/**
 * Geist and Geist Mono (SIL OFL 1.1, see OFL.txt), under tiao's own family names so they
 * never merge with a Geist the page declares itself. The sources are data URLs once built,
 * so this module is only ever loaded through a dynamic import.
 */
export const GEIST_FACES = [
  { family: 'tiao Geist', src: geistSrc },
  { family: 'tiao Geist Mono', src: geistMonoSrc },
]
