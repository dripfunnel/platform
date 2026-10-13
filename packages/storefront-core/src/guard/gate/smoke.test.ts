import { describe, expect, it } from 'vitest'
import { productQuery } from '../../products/product'
import { cartSchema } from '../../cart/cart'
import { smokeProblems, smokeProductSlug, smokeShop, smokeShopper } from './smoke'
import { catalogueSnapshotSchema } from './snapshot'

const snapshot = catalogueSnapshotSchema.parse({
  version: 1,
  origin: 'https://shop.northstar.example',
  store: { name: 'Northstar Linen', description: null, language: 'en', mainLanguage: 'en', languages: ['en'], currency: 'INR', pricingCurrency: 'INR', currencies: [{ code: 'INR' }], pricesIncludeTax: true, timeZone: 'Asia/Kolkata', contactEmail: null, contactPhone: null, logo: null, address: { street: null, city: null, region: null, postal: null, country: 'IN' } },
  poweredBy: null,
  guard: { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
  csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
  assetBase: null,
})

describe('the smoke test’s offline Shop API', () => {
  it('sells its test product through the cart and checkout to an order paid on delivery, in the store’s currency', () => {
    const { answer, state, country } = smokeShop(snapshot)
    const ask = (query: string, variables: Record<string, unknown> = {}) => answer({ query, variables }) as { data?: Record<string, { cart?: unknown } & Record<string, unknown>>; errors?: { extensions: { code: string } }[] }
    expect(country).toBe('IN')
    expect(ask(productQuery, { slug: smokeProductSlug }).data?.['product']).toMatchObject({ slug: smokeProductSlug, price: { amount: '2500', currency: 'INR' } })
    expect(ask(productQuery, { slug: 'anything-else' }).data?.['product']).toBeNull()
    const added = ask('mutation Add($versionId: ID!, $quantity: Int!) { addToCart(versionId: $versionId, quantity: $quantity) { cartToken cart { id } } }', { versionId: 'df-smoke-version', quantity: 1 })
    expect(added.data?.['addToCart']?.['cartToken']).toBe('df-smoke-cart-token')
    expect(cartSchema.safeParse(added.data?.['addToCart']?.cart).success).toBe(true)
    ask('mutation Contact { setCartContact(email: $email) { cart { id } } }', { email: smokeShopper('IN')['email'] })
    ask('mutation Address { setShippingAddress(address: $address) { cart { id } } }', { address: { name: 'Test Shopper' } })
    ask('mutation Delivery { setShippingOption(option: $option) { cart { id } } }', { option: 'flat' })
    expect(ask('mutation Checkout { checkout { id } }').data?.['checkout']).toMatchObject({ readyToPay: true })
    expect(ask('mutation Place { placeOrder(provider: $provider) { orderId } }', { provider: 'cod' }).data?.['placeOrder']).toMatchObject({ orderId: 'df-smoke-order', payment: null })
    expect(state.placed).toBe('df-smoke-order')
    expect(ask('query Cart { cart { id } }').data?.['cart']).toBeNull()
    expect(ask('mutation Order { confirmPayment(orderId: $orderId) { id } }', { orderId: 'df-smoke-order' }).data?.['confirmPayment']).toMatchObject({ number: 'SMOKE-1', paymentMethod: 'cod' })
  })

  it('answers anything else as an outage, and refuses to place an order without a cart', () => {
    const { answer } = smokeShop(snapshot)
    expect(answer({ query: 'query Collections { collections { id } }', variables: {} })).toMatchObject({ errors: [{ extensions: { code: 'UNAVAILABLE' } }] })
    expect(answer({ query: 'mutation Place { placeOrder(provider: $provider) { orderId } }', variables: { provider: 'cod' } })).toMatchObject({ errors: [{ extensions: { code: 'NOT_READY' } }] })
  })

  it('types an address that passes core’s checks for India, the US, the UK and elsewhere', () => {
    expect(smokeShopper('IN')['postal-code']).toMatch(/^\d{6}$/)
    expect(smokeShopper('US')['postal-code']).toMatch(/^\d{5}$/)
    expect(smokeShopper('GB')['postal-code']).toBe('SW1A 1AA')
    expect(smokeShopper('FR')['address-level2']).toBe('Testville')
  })

  it('words a test purchase that stopped, or wasn’t tried, at any of the gate’s widths', () => {
    expect(smokeProblems([390, 768, 1440].map((width) => ({ width, problem: null })))).toEqual([])
    expect(smokeProblems([{ width: 390, problem: 'Place order never went through.' }, { width: 768, problem: null }])).toEqual([
      "The test purchase at 390 px didn't complete: Place order never went through.",
      "The test purchase wasn't tried at 1440 px.",
    ])
  })
})
