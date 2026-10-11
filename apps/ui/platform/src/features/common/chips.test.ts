import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// jsdom has no cascade from imported stylesheets, so this reads the one chip style both screens load (#372).
describe('the filter chips', () => {
  it('are one style, for a link or a button, in --df-* colours only', () => {
    const css = read('./chips.css').replace(/\s+/g, ' ')
    const chip = /\.df-list \.df-chips \.df-chip \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(chip).toContain('border-radius: 999px;')
    expect(chip).toContain('font: inherit;')
    expect(chip).toMatch(/background: var\(--df-color-[a-z-]+\);/)
    expect(css).toMatch(/\.df-list \.df-chips \.df-chip:hover \{/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })

  it('are loaded by both screens that draw them, and styled nowhere else', () => {
    for (const screen of ['../activity/ActivityLog.tsx', '../stores/FilterChips.tsx']) expect(read(screen)).toContain("import '../common/chips.css'")
    expect(read('../stores/stores.css')).not.toMatch(/\.df-chip\b/)
  })
})
