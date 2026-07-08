import css from './styles.css'

const injected = new WeakSet<Document>()

/** Inject the stylesheet once per document (no-op if styles.css was imported manually). */
export function injectStyles(doc: Document): void {
  if (injected.has(doc)) return
  injected.add(doc)
  if (doc.querySelector('style[data-tiao], link[data-tiao]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-tiao', '')
  // css is a string when bundled by tsup; test environments may stub css modules
  style.textContent = typeof css === 'string' ? css : ''
  doc.head.append(style)
}
