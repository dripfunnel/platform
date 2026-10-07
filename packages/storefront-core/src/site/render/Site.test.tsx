import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalize } from '../normalize'
import { buildTemplate, templateOrder, type TemplateKey } from '../presets'
import { hrefForLabel, type SiteLinks } from './links'
import { SiteAbout, SiteContact, SiteHome, SiteLayout, type SiteProduct } from './Site'

const ctx = { store: 'Juniper & Co.', city: 'Austin', email: 'hello@juniper.example', phone: '+1 512 555 0100' }
const links: SiteLinks = {
  home: '/',
  shop: '/shop',
  cart: '/cart',
  about: '/about',
  contact: '/contact',
  search: (q) => `/search?q=${encodeURIComponent(q)}`,
  policy: (k) => `/policies/${k}`,
}
const products: SiteProduct[] = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}`, href: `/products/p${i}`, price: `$${i + 10}.00`, image: { url: `/img/p${i}.jpg`, alt: `Product ${i}` } }))

const page = (key: TemplateKey, items = products, poweredBy: string | null = null) => {
  const site = buildTemplate(key, ctx)
  return renderToStaticMarkup(
    <SiteLayout site={site} store={ctx.store} links={links} current="home" poweredBy={poweredBy} year={2026}>
      <SiteHome site={site} store={ctx.store} links={links} products={items} onSubscribe={() => undefined} />
    </SiteLayout>,
  )
}

describe('SiteLayout and SiteHome', () => {
  it('renders every template with its theme, header, sections and footer', () => {
    for (const key of ['blank', ...templateOrder] as TemplateKey[]) {
      const html = page(key)
      expect(html, key).toContain('--dfs-accent:')
      expect(html, key).toContain('<header')
      expect(html, key).toContain('<footer')
      expect(html.match(/<h1/g), key).toHaveLength(1)
    }
  })

  it('shows only the catalogue’s products, never samples, and drops an empty product grid', () => {
    const html = page('minimal')
    expect(html).toContain('href="/products/p0"')
    expect(html).toContain('$10.00')
    expect(page('minimal', [])).not.toContain('New arrivals')
  })

  it('shows "Powered by" only when the brand’s rule asks', () => {
    expect(page('minimal', products, 'Northstar Shops')).toContain('© 2026 Juniper &amp; Co. · Powered by Northstar Shops')
    expect(page('minimal')).not.toContain('Powered by')
  })

  it('leaves the newsletter form out when nothing can take the address', () => {
    const site = buildTemplate('minimal', ctx)
    const html = renderToStaticMarkup(<SiteHome site={site} store={ctx.store} links={links} products={products} />)
    expect(html).toContain('Hear about new pieces first')
    expect(html).not.toContain('<form')
  })

  it('names the store in a hidden h1 when the home page has no hero', () => {
    const site = normalize({ sections: [{ id: 't', type: 'text', headline: 'Hello', body: '', align: 'left' }] }, buildTemplate('minimal', ctx))
    expect(renderToStaticMarkup(<SiteHome site={site} store={ctx.store} links={links} products={[]} />)).toContain('<h1 class="dfs-sr">Juniper &amp; Co.</h1>')
  })

  it('escapes the merchant’s words', () => {
    const site = normalize({ announce: { on: true, text: '<script>alert(1)</script>' } }, buildTemplate('minimal', ctx))
    const html = renderToStaticMarkup(
      <SiteLayout site={site} store={ctx.store} links={links} current="home" poweredBy={null} year={2026}>
        {null}
      </SiteLayout>,
    )
    expect(html).not.toContain('<script>alert')
  })
})

describe('About and Contact', () => {
  it('splits About into paragraphs and lists only the contact details given', () => {
    const site = normalize({ pages: { about: { headline: 'Us', body: 'One.\n\nTwo.' }, contact: { phone: '' } } }, buildTemplate('minimal', ctx))
    expect(renderToStaticMarkup(<SiteAbout site={site} image={null} />).match(/<p /g)).toHaveLength(2)
    const contact = renderToStaticMarkup(<SiteContact site={site} />)
    expect(contact).toContain('mailto:hello@juniper.example')
    expect(contact).not.toContain('tel:')
  })
})

describe('hrefForLabel', () => {
  it('sends About and Contact by name, policies by name, and the rest to the shop', () => {
    expect(hrefForLabel('Our story', links)).toBe('/about')
    expect(hrefForLabel('Support', links)).toBe('/contact')
    expect(hrefForLabel('Returns', links)).toBe('/policies/returns')
    expect(hrefForLabel('Delivery areas', links)).toBe('/policies/shipping')
    expect(hrefForLabel('New in', links)).toBe('/shop')
  })
})
