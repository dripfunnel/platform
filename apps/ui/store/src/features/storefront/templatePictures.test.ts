import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sampleTemplates } from './storefrontStates'

// Card #681: each offered template ships one WebP picture of at most 150 KB in public/templates (FIRST-RELEASE §14).
describe('template pictures', () => {
  const keys = sampleTemplates('gallery').map((t) => t.key)

  it.each(keys)('has a picture for %s', (key) => {
    const file = new URL(`../../../public/templates/${key}.webp`, import.meta.url)
    expect(existsSync(file), `public/templates/${key}.webp`).toBe(true)
    const bytes = readFileSync(file)
    expect(bytes.subarray(0, 4).toString('latin1') + bytes.subarray(8, 12).toString('latin1')).toBe('RIFFWEBP')
    expect(bytes.length).toBeLessThanOrEqual(150 * 1024)
  })

  it('reads the offered templates from the gallery’s fixture', () => {
    expect(keys.length).toBeGreaterThan(0)
  })
})
