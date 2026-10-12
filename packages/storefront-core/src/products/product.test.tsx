// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../test/shop'
import { formatMoney } from '../pricing/money'
import { useProduct } from './product'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => history.replaceState(null, '', '/'))

const usd = (amount: number) => ({ amount: String(amount), currency: 'USD' })
const tee = {
  id: 'p1',
  name: 'Organic Cotton Tee',
  slug: 'organic-cotton-tee',
  description: 'Soft, heavyweight organic cotton.',
  highlights: ['Pre-washed'],
  inStock: true,
  price: usd(2800),
  compareAt: usd(3400),
  maxPrice: usd(3200),
  badges: [{ label: 'Bestseller', tone: null }, { label: '', tone: null }],
  photos: [
    { alt: 'Front', versionId: null, image: { url: 'https://shop.example/shop-api/assets/a' } },
    { alt: 'Sage', versionId: 'v-sage-m', image: { url: 'https://shop.example/shop-api/assets/b' } },
    { alt: 'No address', versionId: null, image: null },
  ],
  video: null,
  options: [
    { id: 'colour', name: 'Colour', values: [{ id: 'sand', name: 'Sand' }, { id: 'sage', name: 'Sage' }] },
    { id: 'size', name: 'Size', values: [{ id: 's', name: 'S' }, { id: 'm', name: 'M' }] },
  ],
  versions: [
    { id: 'v-sand-s', name: null, choices: [{ optionId: 'colour', valueId: 'sand' }, { optionId: 'size', valueId: 's' }], price: usd(2800), compareAt: usd(3400), inStock: true, available: 4 },
    { id: 'v-sand-m', name: null, choices: [{ optionId: 'colour', valueId: 'sand' }, { optionId: 'size', valueId: 'm' }], price: usd(2800), compareAt: null, inStock: false, available: 0 },
    { id: 'v-sage-m', name: null, choices: [{ optionId: 'colour', valueId: 'sage' }, { optionId: 'size', valueId: 'm' }], price: usd(3200), compareAt: null, inStock: true, available: null },
  ],
  specs: [],
  faqs: [],
  compliance: [
    { region: 'ALL', field: 'origin', value: 'India' },
    { region: 'US', field: 'origin', value: 'Made in India' },
    { region: 'US', field: 'fibre', value: '100% cotton' },
    { region: 'IN', field: 'care', value: 'Hand wash' },
  ],
  returns: null,
  warranty: null,
  seoTitle: null,
  seoDescription: 'A tee for every day.',
  related: [],
}
const answer = (product: unknown) => ({ data: { product, store: { marketId: 'm-us', markets: [{ id: 'm-us', countries: ['US'] }, { id: 'm-in', countries: ['IN'] }] } } })

const Page = () => {
  const p = useProduct()
  return (
    <div>
      <h1>{p.product?.name ?? p.status}</h1>
      <p data-testid="price">
        {p.from ? 'From ' : ''}
        {p.price ? formatMoney(p.price, 'en-US') : ''} {p.compareAt ? formatMoney(p.compareAt, 'en-US') : ''}
      </p>
      <p data-testid="stock">{p.stock ? `${p.stock.inStock}:${p.stock.available}` : ''}</p>
      <p data-testid="missing">{p.missing.map((m) => m.name).join()}</p>
      <p data-testid="photos">{p.photos.map((ph) => `${ph.alt}${ph.main ? '*' : ''}`).join()}</p>
      <p data-testid="legal">{p.product?.legal.map((l) => `${l.title}=${l.body}`).join('|')}</p>
      <p data-testid="badges">{p.product?.badges.map((b) => b.label).join()}</p>
      {p.options.map((o) =>
        o.values.map((v) => (
          <button key={v.id} type="button" onClick={() => p.choose(o.id, v.id)} data-state={`${v.selected ? 'on' : 'off'}-${v.available ? 'ok' : 'gone'}`}>
            {v.name}
          </button>
        )),
      )}
    </div>
  )
}

const state = (name: string) => screen.getByText(name).getAttribute('data-state')

describe('useProduct', () => {
  it('shows the product the address names, priced "from" until every option is chosen', async () => {
    history.replaceState(null, '', '/products/organic-cotton-tee/')
    const asked = shopAnswering(() => answer(tee))
    render(<Provided><Page /></Provided>)
    await screen.findByText('Organic Cotton Tee')
    expect(asked[0]?.variables).toEqual({ slug: 'organic-cotton-tee' })
    expect(screen.getByTestId('price').textContent).toBe('From $28.00 $34.00')
    expect(screen.getByTestId('missing').textContent).toBe('Colour,Size')
    expect(screen.getByTestId('photos').textContent).toBe('Front*,Sage')
    expect(screen.getByTestId('badges').textContent).toBe('Bestseller')
    expect(document.title).toBe('Organic Cotton Tee')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('A tee for every day.')
  })

  it('keeps a partial choice in the page and gives a complete one its version address', async () => {
    history.replaceState(null, '', '/products/organic-cotton-tee/')
    shopAnswering(() => answer(tee))
    render(<Provided><Page /></Provided>)
    await screen.findByText('Organic Cotton Tee')
    act(() => screen.getByText('Sand').click())
    expect(location.pathname).toBe('/products/organic-cotton-tee/')
    expect(screen.getByTestId('missing').textContent).toBe('Size')
    // M in sand is sold out; the sage M is still there.
    expect([state('S'), state('M'), state('Sage')]).toEqual(['off-ok', 'off-gone', 'off-ok'])
    act(() => screen.getByText('M').click())
    expect(location.pathname).toBe('/products/organic-cotton-tee/v-sand-m/')
    expect(screen.getByTestId('stock').textContent).toBe('false:0')
    act(() => screen.getByText('Sage').click())
    expect(location.pathname).toBe('/products/organic-cotton-tee/v-sage-m/')
    expect(screen.getByTestId('price').textContent).toBe('$32.00 ')
    expect(screen.getByTestId('photos').textContent).toBe('Sage,Front*')
  })

  it('opens a version address with that version chosen, and keeps the canonical on the product', async () => {
    history.replaceState(null, '', '/products/organic-cotton-tee/v-sand-s/')
    shopAnswering(() => answer(tee))
    render(<Provided mode="live"><Page /></Provided>)
    await screen.findByText('Organic Cotton Tee')
    expect([state('Sand'), state('S')]).toEqual(['on-ok', 'on-ok'])
    expect(screen.getByTestId('stock').textContent).toBe('true:4')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${location.origin}/products/organic-cotton-tee/`)
  })

  it("gives the legal details of the shopper's market, over the ones for everywhere", async () => {
    history.replaceState(null, '', '/products/organic-cotton-tee/')
    shopAnswering(() => answer(tee))
    render(<Provided><Page /></Provided>)
    await screen.findByText('Organic Cotton Tee')
    expect(screen.getByTestId('legal').textContent).toBe('Country of origin=Made in India|Fibre content=100% cotton')
  })

  it('names a product the store has not got as missing, and an outage as an error with its code', async () => {
    history.replaceState(null, '', '/products/gone/')
    shopAnswering(() => answer(null))
    render(<Provided><Page /></Provided>)
    await screen.findByText('missing')
    cleanup()
    shopAnswering(() => ({ errors: [{ message: 'Down', extensions: { code: 'UNAVAILABLE' } }] }))
    render(<Provided><Page /></Provided>)
    await screen.findByText('error')
  })
})
