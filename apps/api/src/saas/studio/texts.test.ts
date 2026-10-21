import { describe, expect, it } from 'vitest'
import { pageTexts, withText } from './texts'

const theme = new Map([
  ['content/en/pages.json', JSON.stringify({ home: { lead: 'Lead' }, about: { lead: 'About us' } })],
  ['content/en/common.json', JSON.stringify({ header: { shop: 'Shop' } })],
  ['content/en/home.json', JSON.stringify({ hero: { title: 'Welcome to Your Shop' } })],
  ['content/en/shop.json', JSON.stringify({ product: { add: 'Add to cart' } })],
  ['content/hi/home.json', JSON.stringify({ hero: { title: 'स्वागत है' } })],
])

describe('Edit text’s words', () => {
  it('offer every content file’s words in the language, as the frame names them, and only this page’s part of pages.json', () => {
    expect(pageTexts(theme, 'home', 'en')).toEqual([
      { key: 'pages:home.lead', text: 'Lead' },
      { key: 'common:header.shop', text: 'Shop' },
      { key: 'home:hero.title', text: 'Welcome to Your Shop' },
      { key: 'shop:product.add', text: 'Add to cart' },
    ])
  })

  it('save a key from any of those files', () => {
    expect(withText(theme, 'en', 'home:hero.title', 'Hello')).toEqual({ path: 'content/en/home.json', content: `${JSON.stringify({ hero: { title: 'Hello' } }, null, 2)}\n` })
  })
})
