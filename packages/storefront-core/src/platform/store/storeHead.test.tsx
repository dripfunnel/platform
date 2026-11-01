// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createShopClient } from '../api/client'
import { StorefrontProvider, type RenderMode } from './context'
import { completeStore } from './store'

const store = completeStore({ name: 'Juniper', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC', favicon: { url: '/shop-api/assets/f1' } })
const icon = (mode: RenderMode) => {
  render(<StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode, poweredBy: null }}>{null}</StorefrontProvider>)
  return document.head.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null
}

afterEach(cleanup)

// Card #1129: the store's favicon is in the head of every page a browser tab shows.
describe("the store's favicon", () => {
  it('is in the head on the live site and in the preview', () => {
    expect(icon('live')).toBe('/shop-api/assets/f1')
    cleanup()
    expect(icon('preview')).toBe('/shop-api/assets/f1')
  })

  it('is left out of the studio frame, which has no tab and no session for the Shop API', () => {
    expect(icon('studio')).toBeNull()
  })
})
