import { angleInputPlugin } from './angle'
import { booleanInputPlugin } from './boolean'
import { colorInputPlugin } from './color'
import { graphMonitorPlugin, textMonitorPlugin } from './monitor'
import { intervalInputPlugin } from './interval'
import { numberInputPlugin } from './number'
import { pointInputPlugin } from './point'
import { selectInputPlugin } from './select'
import { stringInputPlugin } from './string'
import type { PluginRegistry } from '../plugin'

let registered = false

/** Idempotently register built-ins on the global registry (called by the Pane constructor). */
export function ensureBuiltins(registry: PluginRegistry): void {
  if (registered) return
  registered = true
  registerBuiltins(registry)
}

/**
 * Registration order matters: the registry scans most-recently-registered
 * first, so more specific plugins (select, color, angle) are registered last.
 */
export function registerBuiltins(registry: PluginRegistry): void {
  registry.register(textMonitorPlugin)
  registry.register(graphMonitorPlugin)
  registry.register(numberInputPlugin)
  registry.register(stringInputPlugin)
  registry.register(booleanInputPlugin)
  registry.register(pointInputPlugin)
  registry.register(intervalInputPlugin)
  registry.register(colorInputPlugin)
  registry.register(selectInputPlugin)
  registry.register(angleInputPlugin)
}
