// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createShopClient } from '../api/client'
import { StorefrontProvider, type RenderMode } from '../store/context'
import { completeStore } from '../store/store'
import { Link } from './link'

afterEach(cleanup)

const store = completeStore({ name: 'Juniper', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC' })

const provided = (mode: RenderMode, href: string) => (
  <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode, poweredBy: null }}>
    <Link href={href}>Go</Link>
  </StorefrontProvider>
)

const link = (mode: RenderMode, href: string) => {
  render(provided(mode, href))
  return screen.getByText('Go')
}

describe('Link', () => {
  it('opens another host in a new tab carrying nothing from the studio frame', () => {
    const a = link('studio', 'https://instagram.com/juniper')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noreferrer noopener')
  })

  it('renders the same on the server, so the static HTML and the browser agree', () => {
    expect(renderToStaticMarkup(provided('studio', 'https://instagram.com/juniper'))).toBe('<a href="https://instagram.com/juniper" target="_blank" rel="noreferrer noopener">Go</a>')
  })

  it('keeps a link on this store, or outside the studio, in the same tab', () => {
    expect(link('studio', '/collections/linen').getAttribute('target')).toBeNull()
    cleanup()
    expect(link('live', 'https://instagram.com/juniper').getAttribute('target')).toBeNull()
  })

  it('never carries a script, data or protocol-relative address', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '/\\evil.example', '/\t/evil.example', ' https://evil.example']) {
      expect(link('studio', href).closest('a')).toBeNull()
      cleanup()
    }
  })
})
