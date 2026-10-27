import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { cartLine, cartRead, inr } from '../testing/fixtures'
import { applyCode, cartOperation, payOrder, paymentOptionsOperation, placeOrder, problemsOf, readPayment, setShippingAddress, setShippingOption, setQuantity } from './cart'

const client = (answer: unknown) => {
  const requests: { query: string; variables: Record<string, unknown> | undefined }[] = []
  return { requests, request: async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => (requests.push({ query, variables }), answer as T) }
}

describe('the cart read', () => {
  it("keeps the engine's prices and totals as sent, and is never kept on the phone", () => {
    const operation = cartOperation()
    expect(operation.slot).toBeNull()
    const cart = operation.parse({ cart: cartRead({ subtotal: inr('200000'), total: inr('210000'), lines: [cartLine('1', { quantity: 2, lineTotal: inr('299800') })] }) })
    expect(cart?.subtotal).toEqual(inr('200000'))
    expect(cart?.total).toEqual(inr('210000'))
    expect(cart?.lines[0]).toMatchObject({ quantity: 2, lineTotal: inr('299800') })
  })

  it('is no cart when the API has none', () => {
    expect(cartOperation().parse({ cart: null })).toBeNull()
  })

  it('keeps the address pin and the options the API offers, and drops a code or problem it has no name for', () => {
    const cart = cartOperation().parse({
      cart: cartRead({
        shippingAddress: { name: 'Ana', line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, latitude: 26.9, longitude: 75.8 },
        shippingOptions: [{ id: 'own_delivery', service: null, amount: inr('4900'), minDays: null, maxDays: null, hours: null }, { id: 'pickup', service: null, amount: inr('0'), minDays: null, maxDays: null, hours: '10:00–18:00' }],
        codes: [{ code: 'SAVE10', state: 'APPLIED' }, { code: 'ODD', state: 'FROM_THE_FUTURE' }],
        lines: [cartLine('1', { problem: 'short' }), cartLine('2', { problem: 'from_the_future' })],
      }),
    })
    expect(cart?.shippingAddress?.pin).toEqual({ latitude: 26.9, longitude: 75.8 })
    expect(cart?.shippingOptions.map((o) => o.id)).toEqual(['own_delivery', 'pickup'])
    expect(cart?.codes).toEqual([{ code: 'SAVE10', state: 'APPLIED' }])
    expect(cart?.lines.map((l) => l.problem)).toEqual(['short', null])
  })

  it('is a bad answer when its shape drifts', () => {
    expect(() => cartOperation().parse({ cart: { ...cartRead(), subtotal: { amount: 5, currency: 'INR' } } })).toThrow(ApiError)
  })
})

describe('the payment options', () => {
  it("keep the API's order and a transfer's instructions", () => {
    const options = paymentOptionsOperation().parse({ paymentOptions: [{ provider: 'razorpay', kind: 'card', instructions: null }, { provider: 'bank_transfer', kind: 'bank_transfer', instructions: 'A/C 123' }] })
    expect(options.map((o) => o.provider)).toEqual(['razorpay', 'bank_transfer'])
    expect(options[1]?.instructions).toBe('A/C 123')
  })
})

describe('the writes', () => {
  it('send the shopper’s choice and answer the cart the API priced, with a guest’s new token', async () => {
    const api = client({ setCartQuantity: { cart: cartRead({ total: inr('1') }), cartToken: 'cart-9' } })
    const change = await setQuantity(api, 'ver-1', 0)
    expect(api.requests[0]?.variables).toEqual({ versionId: 'ver-1', quantity: 0 })
    expect(change.cartToken).toBe('cart-9')
    expect(change.cart?.total).toEqual(inr('1'))
  })

  it('send the address with its pin, and the option as a name', async () => {
    const api = client({ setShippingAddress: { cart: cartRead(), cartToken: null }, setShippingOption: { cart: cartRead(), cartToken: null } })
    await setShippingAddress(api, { name: ' Ana ', line1: '1 Lake Rd', line2: '', city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: '', pin: { latitude: 26.9, longitude: 75.8 } })
    await setShippingOption(api, 'own_delivery')
    expect(api.requests[0]?.variables).toEqual({ address: { name: 'Ana', line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, latitude: 26.9, longitude: 75.8 } })
    expect(api.requests[1]?.variables).toEqual({ option: 'own_delivery' })
  })

  it('answer what a code did, and take a state it has no name for as a code that did not work', async () => {
    expect((await applyCode(client({ applyCode: { state: 'USED_UP', cart: cartRead() } }), 'X')).state).toBe('USED_UP')
    expect((await applyCode(client({ applyCode: { state: 'FROM_THE_FUTURE', cart: cartRead() } }), 'X')).state).toBe('INVALID')
  })

  it('place the order by the way chosen, and answer its number and the transfer’s instructions', async () => {
    const api = client({ placeOrder: { orderId: 'o1', number: 'ORD-1001', total: inr('149900'), provider: 'bank_transfer', instructions: 'A/C 123' } })
    expect(await placeOrder(api, 'bank_transfer')).toEqual({ orderId: 'o1', number: 'ORD-1001', total: inr('149900'), provider: 'bank_transfer', instructions: 'A/C 123', payment: null })
    expect(api.requests[0]?.variables).toEqual({ provider: 'bank_transfer' })
  })
})

describe('paying by a provider’s own sheet', () => {
  const start = { providerRef: 'pi_1', publicKey: 'pk_1', accountId: 'acct_1', clientSecret: 'secret_1', customerId: null, ephemeralKeySecret: null, redirectUrl: null, mode: 'test' }

  it('places the order with the app’s scheme and API version, and answers what the provider’s sheet needs', async () => {
    const api = client({ placeOrder: { orderId: 'o1', number: 'ORD-1', total: inr('149900'), provider: 'stripe', instructions: null, payment: start } })
    const placed = await placeOrder(api, 'stripe', { scheme: 'devshop', stripeApiVersion: '2099-01-01' })
    expect(api.requests[0]?.variables).toEqual({ provider: 'stripe', app: { scheme: 'devshop', stripeApiVersion: '2099-01-01' } })
    expect(placed.payment).toEqual(start)
  })

  it('starts a new attempt for the same order with payOrder, and refuses an answer with nothing to start', async () => {
    const api = client({ payOrder: start })
    expect(await payOrder(api, 'o1', { scheme: 'devshop' })).toEqual(start)
    expect(api.requests[0]?.variables).toEqual({ orderId: 'o1', app: { scheme: 'devshop' } })
    await expect(payOrder(client({ payOrder: null }), 'o1', { scheme: 'devshop' })).rejects.toThrow(ApiError)
  })

  it('reads whether an order is paid or cancelled, and does not call an authorised payment paid', async () => {
    expect(await readPayment(client({ confirmPayment: { state: 'placed', paymentState: 'paid' } }), 'o1')).toEqual({ cancelled: false, paid: true })
    expect(await readPayment(client({ confirmPayment: { state: 'placed', paymentState: 'authorised' } }), 'o1')).toEqual({ cancelled: false, paid: false })
    expect(await readPayment(client({ confirmPayment: { state: 'cancelled', paymentState: 'pending' } }), 'o1')).toEqual({ cancelled: true, paid: false })
    expect(await readPayment(client({ confirmPayment: null }), 'o1')).toBeNull()
  })
})

describe('the problems a refusal names', () => {
  it('are read from the refusal’s details, and are none for anything else', () => {
    expect(problemsOf(new ApiError('NOT_READY', 'x', { problems: ['NO_CONTACT', 7, 'NO_ADDRESS'] }))).toEqual(['NO_CONTACT', 'NO_ADDRESS'])
    expect(problemsOf(new ApiError('NOT_READY', 'x'))).toEqual([])
    expect(problemsOf(new Error('x'))).toEqual([])
  })
})
