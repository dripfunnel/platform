import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// happy-dom has no layout, so this reads the rules (#1651), as #1398's carts test does.
describe('the Offers list’s row Actions menu', () => {
  const css = readFileSync(new URL('./offers.css', import.meta.url), 'utf8').replace(/\s+/g, ' ')

  it('is not clipped by the table once the table is wide enough to need no sideways scroll', () => {
    expect(/\.df-offers-rows \{([^}]*)\}/.exec(css)?.[1]).toContain('container-type: inline-size;')
    expect(/@container \(min-width: 822px\) \{ \.df-offers-table \{([^}]*)\}/.exec(css)?.[1]).toContain('overflow: visible;')
  })

  it('keeps the sideways scroll below that width, where the rows are 820px wide', () => {
    expect(/\.df-offers-table \{([^}]*)\}/.exec(css)?.[1]).toContain('overflow-x: auto;')
    expect(css).toMatch(/\.df-offers-row \{[^}]*min-width: 820px;/)
  })
})

describe('the row Actions menu’s link rows', () => {
  const css = readFileSync(createRequire(import.meta.url).resolve('@dripfunnel/shared/ui/detail.css'), 'utf8').replace(/\s+/g, ' ')

  it('put the description under the heading, as the button rows do (#1676)', () => {
    expect(/\.df-more-panel a\.df-button \{([^}]*)\}/.exec(css)?.[1]).toContain('display: block;')
  })
})
