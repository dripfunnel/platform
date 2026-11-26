import { describe, expect, it } from 'vitest'
import { isDemoHost, liveSlugOf, previewSlugOf } from './shopCaller'

// #1732: demo.<SHOP_DOMAIN> is the templates' demos, never a store's live or preview address (storefront PREVIEW.md §9).

const domain = 'my-store.one'

describe('the demo host', () => {
  it('is demo.<SHOP_DOMAIN> alone, in any case', () => {
    expect(isDemoHost('demo.my-store.one', domain)).toBe(true)
    expect(isDemoHost('DEMO.my-store.one', domain)).toBe(true)
    expect(isDemoHost('demo-preview.my-store.one', domain)).toBe(false)
    expect(isDemoHost('demo.other.one', domain)).toBe(false)
    expect(isDemoHost('demo.my-store.one', null)).toBe(false)
  })

  it('names no store’s live or preview address', () => {
    expect(liveSlugOf('demo.my-store.one', domain)).toBeNull()
    expect(previewSlugOf('demo.my-store.one', domain)).toBeNull()
    expect(liveSlugOf('demos.my-store.one', domain)).toBe('demos')
    expect(liveSlugOf('acme.my-store.one', domain)).toBe('acme')
  })
})
