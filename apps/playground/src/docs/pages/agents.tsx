import AGENTS from '../agents.md?raw'
import { Code } from '../ui'

export function Agents() {
  return (
    <>
      <header className="docs-hero">
        <h1>Agents</h1>
        <p>
          Paste this into your <code>AGENTS.md</code>, <code>CLAUDE.md</code>, or a Cursor rule, so
          coding agents use tiao well.
        </p>
      </header>
      <Code lang="text" title="AGENTS.md">
        {AGENTS}
      </Code>
    </>
  )
}
