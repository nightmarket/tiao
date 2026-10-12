Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
})

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => null,
})
