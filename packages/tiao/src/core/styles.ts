import css from './styles.css'

const STYLES_MARKER = '--tiao-styles-loaded'

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
  const stylesLoaded = doc.defaultView
    ?.getComputedStyle(doc.documentElement)
    .getPropertyValue(STYLES_MARKER)
    .trim()
  if (stylesLoaded) return

  // css is a string when bundled by tsup; test environments may stub css modules
  injectCss(doc, 'data-tiao', typeof css === 'string' ? css : '')
}
