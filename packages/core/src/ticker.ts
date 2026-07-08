type TickFn = (time: number) => void

const fns = new Set<TickFn>()
let rafId = 0

function loop(time: number): void {
  // Sets tolerate delete-during-iteration, so no defensive copy per frame
  for (const fn of fns) fn(time)
  rafId = fns.size > 0 ? requestAnimationFrame(loop) : 0
}

/** Shared rAF loop so N monitors cost one rAF subscription. */
export function onTick(fn: TickFn): () => void {
  fns.add(fn)
  if (!rafId && typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(loop)
  }
  return () => {
    fns.delete(fn)
    if (fns.size === 0 && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}

/** Calls `fn` at most every `interval` ms, driven by the shared ticker. */
export function onInterval(fn: () => void, interval: number): () => void {
  let last = 0
  return onTick((t) => {
    if (t - last < interval) return
    last = t
    fn()
  })
}
