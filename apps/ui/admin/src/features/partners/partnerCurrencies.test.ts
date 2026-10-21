import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// partnerCurrencies.ts copies the API's table (the SPA can't import apps/api), so this pins the two together.
const pairsIn = (path: URL) => [...readFileSync(path, 'utf8').matchAll(/\b([A-Z]{2}): '([A-Z]{3})'/g)].map(([, country, currency]) => `${country}:${currency}`).sort()

describe('partnerCurrencies', () => {
  it('pairs every country with the currency apps/api/src/core/countries.ts gives it', () => {
    const api = pairsIn(new URL('../../../../../api/src/core/countries.ts', import.meta.url))
    expect(api.length).toBeGreaterThan(0)
    expect(pairsIn(new URL('./partnerCurrencies.ts', import.meta.url))).toEqual(api)
  })
})
