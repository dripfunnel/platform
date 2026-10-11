import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createShopClient } from '../api/client'
import { StorefrontProvider, useStorefront } from './context'
import { completeStore } from './store'

// A theme reads the brand and the home page's search words from core, never as literals (storefront ARCHITECTURE §3.4).
const Footer = () => {
  const { store } = useStorefront()
  return (
    <footer>
      <p>{store.tagline}</p>
      <p>{store.seo?.title}</p>
      {store.social.map((l) => (
        <a key={l.network} href={l.url}>
          {l.network}
        </a>
      ))}
    </footer>
  )
}

describe('useStorefront', () => {
  it('gives a theme the brand and search words the Shop API sent', () => {
    const store = completeStore({
      name: 'Juniper',
      mainLanguage: 'en',
      pricingCurrency: 'USD',
      pricesIncludeTax: false,
      timeZone: 'UTC',
      tagline: 'Linen for slow days',
      social: [{ network: 'instagram', url: 'https://www.instagram.com/juniper' }],
      seo: { title: 'Juniper linen', description: null, image: null },
    })
    const html = renderToStaticMarkup(
      <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode: 'live', poweredBy: null }}>
        <Footer />
      </StorefrontProvider>,
    )
    expect(html).toBe('<footer><p>Linen for slow days</p><p>Juniper linen</p><a href="https://www.instagram.com/juniper">instagram</a></footer>')
  })
})
