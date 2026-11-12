/**
 * Spread on an example's canvas. Fixed to the viewport and opted out of the
 * sidebar's inset, so a docked sidebar floats over the scene instead of
 * squeezing it beside the body padding.
 */
export const FULLSCREEN_CANVAS = {
  'data-tiao-no-inset': '',
  style: { position: 'fixed', inset: 0, width: '100%', height: '100%' },
} as const
