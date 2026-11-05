import { spring } from 'motion'
import css from './styles.css'

const STYLES_MARKER = '--tiao-styles-loaded'

/**
 * Motion springs: [visual duration in s, bounce]. CSS transitions run them as
 * `--tiao-spring-<name>` timings ("<ms> linear(…)"), falling back to plain
 * eases where these aren't injected; JS animations use them through motion.
 */
export const SPRINGS = {
  /** pane and folder bodies opening and closing, and their carets turning */
  collapse: [0.24, 0],
  /** a tab strip's pill sliding to the picked tab */
  select: [0.22, 0],
  /** a row's changed dot growing in as its label makes room */
  changed: [0.2, 0],
  /** slider readouts hopping clear of a handlebar, and moving there as a quiet row is hovered */
  dodge: [0.2, 0],
} as const

const SPRINGS_CSS = `:root { ${Object.entries(SPRINGS)
  .map(
    ([name, [duration, bounce]]) =>
      `--tiao-spring-${name}: ${spring(duration, bounce).toString()};`,
  )
  .join(' ')} }`

/** Inject a stylesheet once per document, keyed by a data attribute (for plugins). */
export function injectCss(doc: Document, key: string, cssText: string): void {
  if (doc.querySelector(`style[${key}], link[${key}]`)) return
  const style = doc.createElement('style')
  style.setAttribute(key, '')
  style.textContent = cssText
  doc.head.append(style)
}

/** Inject the core stylesheet once per document (no-op if styles.css was imported manually). */
export function injectStyles(doc: Document): void {
  // springs come from JS, so they're injected even beside a manually imported stylesheet
  injectCss(doc, 'data-tiao-springs', SPRINGS_CSS)

  if (doc.querySelector('style[data-tiao], link[data-tiao]')) return
  const stylesLoaded = doc.defaultView
    ?.getComputedStyle(doc.documentElement)
    .getPropertyValue(STYLES_MARKER)
    .trim()
  if (stylesLoaded) return

  // css is a string when bundled by tsup; test environments may stub css modules
  injectCss(doc, 'data-tiao', typeof css === 'string' ? css : '')
}
