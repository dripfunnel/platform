import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { coreRoutes, defineTheme } from '../contracts/theme'
import { manifestProblems, pageProblems } from '../testing/index'
import { createI18n } from './i18n/i18n'
import { ConsentBanner, LegalNotices, PoweredBy, PreviewBanner, Price } from './required'

const { t } = createI18n('en-US')

describe('Price', () => {
  it('always shows the tax label, and a compare-at price only when it is higher', () => {
    const html = renderToStaticMarkup(<Price money={{ amount: '2800', currency: 'USD' }} compareAt={{ amount: '3500', currency: 'USD' }} includesTax={false} locale="en-US" t={t} />)
    expect(html).toContain('$28.00')
    expect(html).toContain('Was $35.00')
    expect(html).toContain('+ tax')
    expect(html).toContain('data-df-required="price"')
    const lower = renderToStaticMarkup(<Price money={{ amount: '2800', currency: 'INR' }} compareAt={{ amount: '2000', currency: 'INR' }} includesTax locale="en-IN" t={t} />)
    expect(lower).not.toContain('Was')
    expect(lower).toContain('incl. tax')
    const otherCurrency = renderToStaticMarkup(<Price money={{ amount: '1000', currency: 'USD' }} compareAt={{ amount: '5000', currency: 'JPY' }} includesTax={false} locale="en-US" t={t} />)
    expect(otherCurrency).not.toContain('Was')
  })
})

describe('required components and the contract checks', () => {
  it('passes a page that renders what its route requires, and names what is missing', () => {
    const html = renderToStaticMarkup(
      <>
        <PreviewBanner t={t} />
        <PoweredBy brand="Northstar" t={t} />
        <LegalNotices notices={[{ title: 'Seller', body: 'Juniper LLC' }]} t={t} />
        <Price money={{ amount: '100', currency: 'USD' }} includesTax={false} locale="en-US" t={t} />
        <ConsentBanner t={t} />
      </>,
    )
    expect(pageProblems('product', html, { preview: true, poweredBy: true, legal: true })).toEqual([])
    expect(pageProblems('product', '<main></main>', { preview: true, poweredBy: false, legal: false })).toEqual([
      'The product page must render the required "consent" component.',
      'The product page must render the required "preview" component.',
      'The product page must render the required "price" component.',
    ])
  })

  it('keeps two legal notices with the same title', () => {
    const html = renderToStaticMarkup(<LegalNotices notices={[{ title: 'Seller', body: 'India' }, { title: 'Seller', body: 'US' }]} t={t} />)
    expect(html).toContain('India')
    expect(html).toContain('US')
  })

  it('renders nothing for "Powered by" when the brand hides it', () => {
    expect(renderToStaticMarkup(<PoweredBy brand={null} t={t} />)).toBe('')
  })

  it('lists the routes a theme has not mapped', () => {
    expect(manifestProblems(defineTheme({ name: 'x', version: '1', routes: Object.fromEntries(coreRoutes.map((r) => [r, 'Page'])) }))).toEqual([])
    expect(manifestProblems(defineTheme({ name: 'x', version: '1', routes: { home: 'Home' } }))).toHaveLength(coreRoutes.length - 1)
  })
})
