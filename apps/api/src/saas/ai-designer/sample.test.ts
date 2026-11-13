import { describe, expect, it } from 'vitest'
import { siteIn } from './sample'

describe('siteIn: a sample site named in the request', () => {
  it.each([
    ['Make my home page like https://skclassical.my-store.one/ please', 'https://skclassical.my-store.one/'],
    ['copy (https://shop.example/products?x=1).', 'https://shop.example/products?x=1'],
    ['look at www.shop.example, it is nice', 'https://www.shop.example'],
    ['http://shop.example', 'https://shop.example'],
  ])('finds the site in %j', (text, site) => {
    expect(siteIn(text, 2048)).toBe(site)
  })

  it('finds none in words without an address, or one past the longest it takes', () => {
    expect(siteIn('Make the header darker', 2048)).toBeNull()
    expect(siteIn('like example.com', 2048)).toBeNull()
    expect(siteIn(`https://shop.example/${'a'.repeat(40)}`, 30)).toBeNull()
  })
})
