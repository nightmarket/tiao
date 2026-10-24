import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

// links from the hash router this replaced (#/controls) land on their clean path
if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1))

/** Go to `path` without a reload; the dev server and the host serve index.html for every path. */
export function navigate(path: string): void {
  if (path === location.pathname) return
  history.pushState(null, '', path)
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

/** An in-app link: a real href for new tabs and copying, routed without a reload on a plain click. */
export function Link({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return
    e.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={follow} {...props} />
}
