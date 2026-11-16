import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// happy-dom has no layout, so this reads the rule (#1501), as #1398's carts test does.
describe('the order page’s header row', () => {
  it('centres the status pill with the order number and the payment chip, over the shared pill’s flex-start', () => {
    const css = readFileSync(new URL('./order.css', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    expect(/\.df-order-head \.df-pill \{([^}]*)\}/.exec(css)?.[1]).toContain('align-self: center;')
  })
})
