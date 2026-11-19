import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// happy-dom has no layout, so this reads the rule (#1398), as #1183's account menu test does.
describe('the Abandoned carts list’s Shopper cell', () => {
  it('breaks a long email or name inside its column instead of running into the Cart column', () => {
    const css = readFileSync(new URL('./carts.css', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    expect(/\.df-carts-shopper \{([^}]*)\}/.exec(css)?.[1]).toContain('overflow-wrap: anywhere;')
    expect(css).toMatch(/\.df-carts-cell \{[^}]*min-width: 0;/)
  })
})
