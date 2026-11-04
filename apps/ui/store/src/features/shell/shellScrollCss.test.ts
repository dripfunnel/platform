import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// happy-dom has no layout and the shared package has no Node types, so this reads the rule (#1221).
describe('the shell scroll area', () => {
  it('is the containing block for what is positioned absolutely inside it, so the window never scrolls', () => {
    const css = readFileSync(new URL('../../../../shared/ui/shell.css', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    expect(/\.df-shell-main \{([^}]*)\}/.exec(css)?.[1]).toContain('position: relative;')
    expect(/\.df-shell-main \{([^}]*)\}/.exec(css)?.[1]).toContain('overflow-y: auto;')
    expect(css).toMatch(/\.df-shell \{[^}]*height: 100dvh;/)
  })
})
