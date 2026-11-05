// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShopClient } from '../api/client'
import { StorefrontProvider, type RenderMode } from '../store/context'
import { completeStore } from '../store/store'
import { Link } from './link'
import { setRouterBase } from './router'

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

  it('hands its anchor to a ref, so a theme can move focus to it', () => {
    const ref = createRef<HTMLAnchorElement>()
    render(
      <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode: 'live', poweredBy: null }}>
        <Link href="/cart/" ref={ref}>
          Go
        </Link>
      </StorefrontProvider>,
    )
    expect(ref.current).toBe(screen.getByText('Go'))
  })

  it('keeps a link on this store, or outside the studio, in the same tab', () => {
    expect(link('studio', '/collections/linen').getAttribute('target')).toBeNull()
    cleanup()
    expect(link('live', 'https://instagram.com/juniper').getAttribute('target')).toBeNull()
  })

  it('in the studio frame keeps a click on a store link under the frame’s session path, and leaves a modified click to the browser', () => {
    const base = '/__studio/abcdefghijklmnopqrstuv/'
    setRouterBase(base)
    history.replaceState(null, '', base)
    const a = link('studio', '/collections/linen/')
    expect(fireEvent.click(a, { button: 0, ctrlKey: true })).toBe(true)
    history.replaceState(null, '', base)
    cleanup()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign, origin: window.location.origin, pathname: base } as unknown as Location)
    expect(fireEvent.click(link('studio', '/collections/linen/'))).toBe(false)
    expect(assign).toHaveBeenCalledWith(`${base}collections/linen/`)
    vi.restoreAllMocks()
    setRouterBase(null)
  })

  it('takes tel: and a dialable number, and no other tel: address', () => {
    expect(link('live', 'tel:+919700000001').closest('a')?.getAttribute('href')).toBe('tel:+919700000001')
    cleanup()
    expect(link('studio', 'tel:9700000001').closest('a')?.getAttribute('target')).toBeNull()
    cleanup()
    for (const href of ['tel:', 'tel:12', 'tel:+91 97000 00001', 'tel:+9197000000011234567', 'tel:+91;ext=1', 'tel:+91,2', 'tel:*123#', 'tel://+919700000001', 'sms:+919700000001', 'mailto:a@b.co']) {
      expect(link('live', href).closest('a')).toBeNull()
      cleanup()
    }
  })

  it('never carries a script, data or protocol-relative address', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '/\\evil.example', '/\t/evil.example', ' https://evil.example']) {
      expect(link('studio', href).closest('a')).toBeNull()
      cleanup()
    }
  })
})
