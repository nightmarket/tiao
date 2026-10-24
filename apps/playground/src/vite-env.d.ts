/// <reference types="vite/client" />

/** the @nightmarket/tiao version, from its package.json (vite.config.ts) */
declare const __TIAO_VERSION__: string

declare module '*.css' {
  const css: string
  export default css
}
