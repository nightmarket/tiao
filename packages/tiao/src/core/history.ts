import type { BindingApi } from './blade'

/** how many steps undo can walk back */
export const HISTORY_LIMIT = 10

interface Change {
  binding: BindingApi<unknown>
  from: unknown
  to: unknown
}

/**
 * Undo/redo over settled value changes. Each step is one edit, or one batch
 * (a global reset or an import) that undoes as a unit. Only the last
 * HISTORY_LIMIT steps are kept, and a new edit drops anything redoable.
 */
export class ValueHistory {
  private steps: Change[][] = []
  /** steps[0 .. index) can be undone; steps[index ..] can be redone */
  private index = 0
  private pending: Change[] | null = null
  private applying = false

  constructor(private readonly onChange: () => void) {}

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.steps.length
  }

  /** a binding settled on `to`, replacing `from`; ignored while undo/redo applies */
  record(binding: BindingApi<unknown>, from: unknown, to: unknown): void {
    if (this.applying) return
    const change = { binding, from, to }
    if (this.pending) this.pending.push(change)
    else this.push([change])
  }

  /** every change `fn` makes becomes a single step */
  batch(fn: () => void): void {
    if (this.pending) {
      fn()
      return
    }
    const changes: Change[] = []
    this.pending = changes
    try {
      fn()
    } finally {
      this.pending = null
      if (changes.length > 0) this.push(changes)
    }
  }

  undo(): void {
    const step = this.steps[this.index - 1]
    if (!step) return
    this.index--
    this.apply([...step].reverse(), 'from')
  }

  redo(): void {
    const step = this.steps[this.index]
    if (!step) return
    this.index++
    this.apply(step, 'to')
  }

  private push(step: Change[]): void {
    this.steps.length = this.index
    this.steps.push(step)
    if (this.steps.length > HISTORY_LIMIT) this.steps.shift()
    this.index = this.steps.length
    this.onChange()
  }

  private apply(changes: Change[], side: 'from' | 'to'): void {
    this.applying = true
    try {
      // rows disposed since (a pane torn down) have nothing left to restore
      for (const c of changes) if (c.binding.element.isConnected) c.binding.value.set(c[side])
    } finally {
      this.applying = false
    }
    this.onChange()
  }
}
