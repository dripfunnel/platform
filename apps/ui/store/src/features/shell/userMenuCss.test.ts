import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// happy-dom has no layout and the shared package has no Node types, so this reads the rule (#1183).
describe('the account menu identity lines', () => {
  it('wrap a long word instead of running past the 260px menu', () => {
    const css = readFileSync(new URL('../../../../shared/ui/shell.css', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    expect(/\.df-user-identity p \{([^}]*)\}/.exec(css)?.[1]).toContain('overflow-wrap: anywhere;')
    expect(css).toMatch(/\.df-user-menu \{[^}]*width: 260px;/)
  })
})
