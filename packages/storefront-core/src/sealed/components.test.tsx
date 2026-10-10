// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { coreRoutes, defineTheme } from '../contracts/theme'
import { createI18n } from '../platform/i18n/i18n'
import { moneySchema } from '../pricing/money'
import { manifestProblems, pageProblems, visibilityProblems } from '../testing/index'
import { Breadcrumbs, ConsentBanner, ConsentSettingsButton, LegalNotices, PoweredBy, PreviewBanner, Price } from './components'
import { rootOf } from './element'
import { visibilityProblem } from './visibility'

const { t } = createI18n('en-US')
const money = (amount: string, currency: string) => moneySchema.parse({ amount, currency })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const hostIn = (container: HTMLElement) => {
  const host = container.querySelector<HTMLElement>('df-sealed')
  if (!host) throw new Error('No sealed host rendered.')
  return host
}

describe('Price', () => {
  it('always shows the tax label, and a compare-at price only when it is higher', () => {
    const html = renderToStaticMarkup(<Price money={money('2800', 'USD')} compareAt={money('3500', 'USD')} includesTax={false} locale="en-US" t={t} />)
    expect(html).toContain('$28.00')
    expect(html).toContain('Was $35.00')
    expect(html).toContain('+ tax')
    expect(html).toContain('data-df-sealed="price"')
    const lower = renderToStaticMarkup(<Price money={money('2800', 'INR')} compareAt={money('2000', 'INR')} includesTax locale="en-IN" t={t} />)
    expect(lower).not.toContain('Was')
    expect(lower).toContain('incl. tax')
    const otherCurrency = renderToStaticMarkup(<Price money={money('1000', 'USD')} compareAt={money('5000', 'JPY')} includesTax={false} locale="en-US" t={t} />)
    expect(otherCurrency).not.toContain('Was')
  })
})

describe('sealed components', () => {
  const each: [string, ReactElement][] = [
    ['$28.00', <Price money={money('2800', 'USD')} includesTax={false} locale="en-US" t={t} className="theme-price" />],
    ['Preview', <PreviewBanner t={t} className="theme-preview" />],
    ['Powered by Northstar', <PoweredBy brand="Northstar" t={t} className="theme-powered" />],
    ['Juniper LLC', <LegalNotices notices={[{ title: 'Seller', body: 'Juniper LLC' }]} t={t} className="theme-legal" />],
    ['Cookies on this site', <ConsentBanner t={t} className="theme-consent" />],
    ['Cookie settings', <ConsentSettingsButton t={t} className="theme-settings" />],
    ['Linen', <Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Linen', href: '/collections/linen' }]} t={t} className="theme-crumbs" />],
  ]

  it.each(each)('render "%s" in a closed shadow root, the theme holding only the host', (text, element) => {
    const { container } = render(element)
    const host = hostIn(container)
    expect(host.shadowRoot).toBeNull()
    expect(host.className).toMatch(/^theme-/)
    expect(host.textContent).toBe('')
    expect(rootOf(host)?.textContent).toContain(text)
  })

  it('send their words in the HTML too, for crawlers and pages without JavaScript', () => {
    expect(renderToStaticMarkup(<LegalNotices notices={[{ title: 'Seller', body: 'India' }, { title: 'Seller', body: 'US' }]} t={t} />)).toMatch(/India.*US/)
  })

  it('render nothing for "Powered by" when the brand hides it', () => {
    expect(renderToStaticMarkup(<PoweredBy brand={null} t={t} />)).toBe('')
  })
})

describe('the visibility check without layout', () => {
  it('finds one hidden or faded by an ancestor, and passes one left alone', () => {
    const { container } = render(
      <>
        <div id="hidden" style={{ display: 'none' }}>
          <Price money={money('100', 'USD')} includesTax={false} locale="en-US" t={t} />
        </div>
        <div id="faded" style={{ opacity: 0.2 }}>
          <Price money={money('100', 'USD')} includesTax={false} locale="en-US" t={t} />
        </div>
        <div id="fine">
          <Price money={money('100', 'USD')} includesTax={false} locale="en-US" t={t} />
        </div>
      </>,
    )
    const at = (id: string) => hostIn(container.querySelector<HTMLElement>(`#${id}`) ?? container)
    expect(visibilityProblem(at('hidden'), 'price', { layout: false })).toBe('hidden')
    expect(visibilityProblem(at('faded'), 'price', { layout: false })).toBe('transparent')
    expect(visibilityProblem(at('fine'), 'price', { layout: false })).toBeNull()
  })
})

describe('the contract checks', () => {
  it('pass a page that renders what its route requires, and name what is missing', () => {
    const page = (
      <>
        <PreviewBanner t={t} />
        <PoweredBy brand="Northstar" t={t} />
        <LegalNotices notices={[{ title: 'Seller', body: 'Juniper LLC' }]} t={t} />
        <Price money={money('100', 'USD')} includesTax={false} locale="en-US" t={t} />
        <ConsentBanner t={t} />
      </>
    )
    const facts = { preview: true, poweredBy: true, legal: true }
    expect(pageProblems('product', renderToStaticMarkup(page), facts)).toEqual([])
    expect(pageProblems('product', '<main></main>', { preview: true, poweredBy: false, legal: false })).toEqual([
      'The product page must render the required "consent" component.',
      'The product page must render the required "preview" component.',
      'The product page must render the required "price" component.',
    ])
    render(page)
    expect(visibilityProblems('product', document, facts, { layout: false })).toEqual([])
  })

  it('fail a page whose theme hides a required component', () => {
    render(
      <div style={{ display: 'none' }}>
        <ConsentBanner t={t} />
      </div>,
    )
    expect(visibilityProblems('home', document, { preview: false, poweredBy: false, legal: false }, { layout: false })).toEqual([`The "consent" component on the home page isn't seen: it is hidden.`])
  })

  it('list the routes a theme has not mapped', () => {
    expect(manifestProblems(defineTheme({ name: 'x', version: '1', routes: Object.fromEntries(coreRoutes.map((r) => [r, 'Page'])) }))).toEqual([])
    expect(manifestProblems(defineTheme({ name: 'x', version: '1', routes: { home: 'Home' } }))).toHaveLength(coreRoutes.length - 1)
  })
})
