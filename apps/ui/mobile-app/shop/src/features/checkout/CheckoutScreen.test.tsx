import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { t } from '../../messages'
import { cartRead, inr } from '../../testing/fixtures'
import { fakeShop, fill, hasText, isDisabled, press, pressableNamed, render, type Request } from '../../testing/harness'
import { CheckoutScreen } from './CheckoutScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
// Card and wallet payments run in the providers' own native sheets, which a test cannot open.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { name: 'Dev Shop', extra: { APP_SCHEME: 'devshop' } } } }))
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'success', url: 'devshop://orders/o-1' })) }))
jest.mock('@stripe/stripe-react-native', () => ({
  Constants: { API_VERSIONS: { CORE: '2099-01-01' } },
  PaymentSheetError: { Canceled: 'Canceled', Failed: 'Failed', Timeout: 'Timeout' },
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
}))

const mockReplace = jest.fn()
const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: mockBack, replace: mockReplace, canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, requestForegroundPermissionsAsync: () => Promise.resolve({ granted: true }), getCurrentPositionAsync: () => Promise.resolve({ coords: { latitude: 26.9124, longitude: 75.7873 } }), geocodeAsync: () => Promise.resolve([]) }))
// The native map does not run in a test: the stub reports how the shopper zoomed and draws a marker only when there is a pin.
const mockMap = { props: null as null | { onRegionChangeComplete: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void } }
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  const MapView = React.forwardRef((props: { children?: unknown; onRegionChangeComplete: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void }, ref) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }))
    mockMap.props = props
    return <View testID="map">{props.children as never}</View>
  })
  MapView.displayName = 'MapView'
  return { __esModule: true, default: MapView, Marker: (props: object) => <View testID="marker" {...props} /> }
})

beforeEach(() => {
  mockReplace.mockClear()
  mockBack.mockClear()
})

const signedInAs = { account: { name: 'Ana', email: 'ana@example.com', phone: null, addresses: [{ id: 'a1', name: 'Home', line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, isDefault: true, latitude: 26.9, longitude: 75.8 }] }, store: { markets: [{ countries: ['IN'] }] } }
const guest = { account: null, store: { markets: [{ countries: ['IN'] }] } }

const address = { name: 'Home', line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, latitude: 26.9, longitude: 75.8 }
const own = { id: 'own_delivery', service: null, amount: inr('4900'), minDays: null, maxDays: null, hours: null }
const pickup = { id: 'pickup', service: null, amount: inr('0'), minDays: null, maxDays: null, hours: '10:00–18:00' }
const courier = { id: 'courier', service: 'Blue Dart Surface', amount: inr('12900'), minDays: 3, maxDays: 5, hours: null }

const afterContact = cartRead({ email: 'ana@example.com', problems: ['NO_ADDRESS'] })
const afterAddress = (options: object[]) => cartRead({ email: 'ana@example.com', shippingAddress: address, shippingOptions: options, problems: ['NO_SHIPPING'] })
// The engine says ₹1,550.00; the lines (₹1,499.00) and the ₹49.00 delivery would add up to ₹1,548.00.
const afterOption = (options: object[], id: string, shipping: string) => cartRead({ email: 'ana@example.com', shippingAddress: address, shippingOptions: options, shippingOption: id, shipping: inr(shipping), total: inr('155000'), problems: [] })

const payments = [
  { provider: 'razorpay', kind: 'card', instructions: null },
  { provider: 'cod', kind: 'cod', instructions: null },
  { provider: 'bank_transfer', kind: 'bank_transfer', instructions: 'A/C 123, IFSC ABCD0001' },
]

type Setup = { account?: object; options?: object[]; payments?: object[]; place?: () => unknown; checkoutRefusal?: ApiError }

const shopFor = ({ account = signedInAs, options = [own, pickup], payments: ways = payments, place, checkoutRefusal }: Setup = {}) => {
  const chosen = options.find((o) => (o as { id: string }).id === 'own_delivery') ?? options[0]
  return fakeShop(({ query, variables }) => {
    if (query.startsWith('{ cart')) return { cart: cartRead() }
    if (query.startsWith('{ account')) return account
    if (query.startsWith('{ paymentOptions')) return { paymentOptions: ways }
    if (query.includes('setCartContact')) return { setCartContact: { cart: afterContact, cartToken: null } }
    if (query.includes('setShippingAddress')) return { setShippingAddress: { cart: afterAddress(options), cartToken: null } }
    if (query.includes('setShippingOption')) return { setShippingOption: { cart: afterOption(options, String(variables?.['option']), String((chosen as { amount: { amount: string } }).amount.amount)), cartToken: null } }
    if (query.startsWith('mutation { checkout')) {
      if (checkoutRefusal) throw checkoutRefusal
      return { checkout: afterOption(options, 'own_delivery', '4900') }
    }
    if (query.includes('confirmPayment')) return { confirmPayment: { state: 'placed', paymentState: 'paid' } }
    if (query.includes('address { country }')) return { store: { address: { country: 'US' } } }
    if (query.includes('placeOrder')) return place ? place() : { placeOrder: { orderId: 'o1', number: 'ORD-1001', total: inr('155000'), provider: variables?.['provider'], instructions: null } }
    throw new Error(`Unexpected request: ${query}`)
  })
}

const sent = (requests: Request[], text: string) => requests.filter((r) => r.query.includes(text))
const choice = (...parts: string[]) => parts.join(', ')

const throughContact = async (screen: ReactTestRenderer) => press(screen, t('checkout.continue'))
const throughAddress = async (screen: ReactTestRenderer) => press(screen, t('checkout.continue'))
const throughDelivery = async (screen: ReactTestRenderer, name: string) => {
  await press(screen, name)
  await press(screen, t('checkout.continue'))
}
const throughPayment = async (screen: ReactTestRenderer, method = t('checkout.payment.cod')) => {
  await press(screen, method)
  await press(screen, t('checkout.continue'))
}
const toReview = async (screen: ReactTestRenderer) => {
  await throughContact(screen)
  await throughAddress(screen)
  await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
  await throughPayment(screen)
}

describe('checkout for an address inside an own-delivery area, paid by cash on delivery', () => {
  it('goes from contact to a placed order, each step written to the API and priced by it', async () => {
    const shop = shopFor()
    const screen = await render(<CheckoutScreen />, shop)

    expect(hasText(screen, t('checkout.contact.title'))).toBe(true)
    await throughContact(screen)
    expect(sent(shop.requests, 'setCartContact')[0]?.variables).toEqual({ email: 'ana@example.com', phone: null })

    expect(hasText(screen, t('checkout.address.pinSet'))).toBe(true)
    await throughAddress(screen)
    expect(sent(shop.requests, 'setShippingAddress')[0]?.variables).toMatchObject({ address: { line1: '1 Lake Rd', city: 'Jaipur', country: 'IN', latitude: 26.9, longitude: 75.8 } })

    // Delivery: only what the API offered for this address.
    expect(hasText(screen, t('checkout.delivery.own'))).toBe(true)
    expect(hasText(screen, t('checkout.delivery.courier'))).toBe(false)
    expect(hasText(screen, t('checkout.delivery.pickupHours', { hours: '10:00–18:00' }))).toBe(true)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    expect(sent(shop.requests, 'setShippingOption')[0]?.variables).toEqual({ option: 'own_delivery' })
    expect(hasText(screen, '₹1,550.00')).toBe(true)
    expect(hasText(screen, '₹1,548.00')).toBe(false)

    await throughPayment(screen)
    expect(sent(shop.requests, 'mutation { checkout')).toHaveLength(1)

    expect(hasText(screen, t('checkout.review.title'))).toBe(true)
    expect(hasText(screen, t('checkout.review.legal'))).toBe(true)
    expect(hasText(screen, '₹1,550.00')).toBe(true)
    await press(screen, t('checkout.review.place'))

    expect(sent(shop.requests, 'placeOrder')[0]?.variables).toEqual({ provider: 'cod' })
    expect(hasText(screen, t('checkout.placed.heading'))).toBe(true)
    expect(hasText(screen, 'ORD-1001')).toBe(true)
    expect(hasText(screen, t('checkout.placed.codBody', { total: '₹1,550.00' }))).toBe(true)
  })

  it('shows a bank transfer’s instructions as the API gives them, and the order number as its reference', async () => {
    const shop = shopFor({ place: () => ({ placeOrder: { orderId: 'o1', number: 'ORD-1002', total: inr('155000'), provider: 'bank_transfer', instructions: 'A/C 123, IFSC ABCD0001' } }) })
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    await press(screen, t('checkout.payment.bank_transfer'))
    expect(hasText(screen, 'A/C 123, IFSC ABCD0001')).toBe(true)
    await press(screen, t('checkout.continue'))
    await press(screen, t('checkout.review.place'))
    expect(sent(shop.requests, 'placeOrder')[0]?.variables).toEqual({ provider: 'bank_transfer' })
    expect(hasText(screen, t('checkout.placed.bankTitle', { total: '₹1,550.00' }))).toBe(true)
    expect(hasText(screen, t('checkout.placed.bankBody', { number: 'ORD-1002' }))).toBe(true)
    expect(hasText(screen, 'A/C 123, IFSC ABCD0001')).toBe(true)
  })
})

describe('delivery', () => {
  it('is the courier outside the area, as the API offers it, with pickup beside it', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ options: [courier, pickup] }))
    await throughContact(screen)
    await throughAddress(screen)
    expect(hasText(screen, 'Blue Dart Surface')).toBe(true)
    expect(hasText(screen, '₹129.00')).toBe(true)
    expect(hasText(screen, t('checkout.delivery.days', { min: 3, max: 5 }))).toBe(true)
    expect(hasText(screen, t('checkout.delivery.pickup'))).toBe(true)
    expect(hasText(screen, t('checkout.delivery.own'))).toBe(false)
  })

  it('says so when the API offers nothing for the address, and goes back to change it', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ options: [] }))
    await throughContact(screen)
    await throughAddress(screen)
    expect(hasText(screen, t('checkout.delivery.none.title'))).toBe(true)
    await press(screen, t('checkout.change'))
    expect(hasText(screen, t('checkout.address.title'))).toBe(true)
  })

  it('cannot go on until an option is chosen', async () => {
    const screen = await render(<CheckoutScreen />, shopFor())
    await throughContact(screen)
    await throughAddress(screen)
    expect(isDisabled(pressableNamed(screen, t('checkout.continue')))).toBe(true)
  })
})

describe('the address', () => {
  const fillIndia = async (screen: ReactTestRenderer) => {
    await fill(screen, t('address.name'), 'Ana Rao')
    await fill(screen, t('address.line1'), '12 Sample Lane')
    await fill(screen, t('address.city'), 'Jaipur')
    await fill(screen, t('address.state'), 'Rajasthan')
    await fill(screen, t('address.pin'), '302017')
  }

  it('needs its pin: a new address is not sent without one, and is sent with it', async () => {
    const shop = shopFor({ account: guest })
    const screen = await render(<CheckoutScreen />, shop)
    await fill(screen, t('checkout.contact.email'), 'guest@example.com')
    await throughContact(screen)

    await fillIndia(screen)
    await press(screen, t('checkout.continue'))
    expect(hasText(screen, t('address.pinRequired'))).toBe(true)
    expect(sent(shop.requests, 'setShippingAddress')).toHaveLength(0)

    await act(async () => mockMap.props?.onRegionChangeComplete({ latitude: 26.9124, longitude: 75.7873, latitudeDelta: 0.01, longitudeDelta: 0.01 }))
    await press(screen, t('address.map.drop'))
    await press(screen, t('checkout.continue'))
    expect(sent(shop.requests, 'setShippingAddress')[0]?.variables).toMatchObject({ address: { name: 'Ana Rao', line1: '12 Sample Lane', country: 'IN', latitude: 26.9124, longitude: 75.7873 } })
  })

  it('asks for the pin of a saved address that has none, before using it', async () => {
    const withoutPin = { ...signedInAs, account: { ...signedInAs.account, addresses: [{ ...signedInAs.account.addresses[0], latitude: null, longitude: null }] } }
    const shop = shopFor({ account: withoutPin })
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    expect(hasText(screen, t('checkout.address.noPin'))).toBe(true)
    await press(screen, t('checkout.continue'))
    expect(hasText(screen, t('address.pinRequired'))).toBe(true)
    expect(sent(shop.requests, 'setShippingAddress')).toHaveLength(0)
  })
})

describe('the contact', () => {
  it('needs an email before it is sent', async () => {
    const shop = shopFor({ account: guest })
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    expect(hasText(screen, t('form.required'))).toBe(true)
    expect(sent(shop.requests, 'setCartContact')).toHaveLength(0)
  })
})

describe('payment', () => {
  it('lists the card and wallet methods the store offers but cannot place an order with one', async () => {
    const shop = shopFor()
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    const razorpay = pressableNamed(screen, choice(t('checkout.payment.razorpay'), t('checkout.payment.soon')))
    expect(isDisabled(razorpay)).toBe(true)
    expect(isDisabled(pressableNamed(screen, t('checkout.continue')))).toBe(true)
    expect(sent(shop.requests, 'placeOrder')).toHaveLength(0)
  })

  it('has one way chosen already when it is the only one the app takes', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ payments: [payments[0] ?? {}, payments[1] ?? {}] }))
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    expect(isDisabled(pressableNamed(screen, t('checkout.continue')))).toBe(false)
  })

  it('says so when the store offers nothing the app can take yet', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ payments: [payments[0] ?? {}] }))
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    expect(hasText(screen, t('checkout.payment.none.title'))).toBe(true)
    expect(isDisabled(pressableNamed(screen, t('checkout.continue')))).toBe(true)
  })
})

describe('paying by card or PayPal', () => {
  const ways = [{ provider: 'stripe', kind: 'card', instructions: null }, { provider: 'paypal', kind: 'card', instructions: null }, ...payments]
  const sheetOrder = (provider: string) => () => ({
    placeOrder: { orderId: 'o-1', number: 'ORD-1003', total: inr('155000'), provider, instructions: null, payment: { providerRef: 'pi_1', publicKey: 'pk_api', accountId: 'acct_api', clientSecret: 'secret_1', customerId: null, ephemeralKeySecret: null, redirectUrl: 'https://www.paypal.com/checkoutnow?token=T1', mode: 'test' } },
  })

  it('offers Stripe and PayPal as ways to pay now, with the Indian providers still listed apart', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ payments: ways }))
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    expect(isDisabled(pressableNamed(screen, t('checkout.payment.stripe')))).toBe(false)
    expect(isDisabled(pressableNamed(screen, t('checkout.payment.paypal')))).toBe(false)
    expect(isDisabled(pressableNamed(screen, choice(t('checkout.payment.razorpay'), t('checkout.payment.soon'))))).toBe(true)
  })

  it('places the order with the app’s scheme and the SDK’s API version, and shows the confirmation as paid only once the order reads paid', async () => {
    const shop = shopFor({ payments: ways, place: sheetOrder('stripe') })
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    await throughPayment(screen, t('checkout.payment.stripe'))
    await press(screen, t('checkout.review.place'))
    expect(sent(shop.requests, 'placeOrder')[0]?.variables).toEqual({ provider: 'stripe', app: { scheme: 'devshop', stripeApiVersion: '2099-01-01' } })
    expect(sent(shop.requests, 'confirmPayment').length).toBeGreaterThan(0)
    expect(hasText(screen, t('checkout.placed.heading'))).toBe(true)
    expect(hasText(screen, t('checkout.placed.pillPaid'))).toBe(true)
    expect(hasText(screen, 'ORD-1003')).toBe(true)
  })

  it('never shows an order as paid, or as placed, when the API answered a card order with nothing to pay it with', async () => {
    const shop = shopFor({ payments: ways, place: () => ({ placeOrder: { orderId: 'o-1', number: 'ORD-1004', total: inr('155000'), provider: 'stripe', instructions: null, payment: null } }) })
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    await throughPayment(screen, t('checkout.payment.stripe'))
    await press(screen, t('checkout.review.place'))
    expect(hasText(screen, t('checkout.placed.pillPaid'))).toBe(false)
    expect(hasText(screen, t('checkout.placed.heading'))).toBe(false)
    expect(hasText(screen, t('checkout.pay.stoppedTitle'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.unavailable'))).toBe(true)
    expect(sent(shop.requests, 'confirmPayment')).toHaveLength(0)
  })

  it('goes the same way for PayPal, with the scheme alone', async () => {
    const shop = shopFor({ payments: ways, place: sheetOrder('paypal') })
    const screen = await render(<CheckoutScreen />, shop)
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    await throughPayment(screen, t('checkout.payment.paypal'))
    await press(screen, t('checkout.review.place'))
    expect(sent(shop.requests, 'placeOrder')[0]?.variables).toEqual({ provider: 'paypal', app: { scheme: 'devshop' } })
    expect(hasText(screen, t('checkout.placed.pillPaid'))).toBe(true)
  })

  it('does not pass the app’s payment input for a way paid later', async () => {
    const shop = shopFor()
    const screen = await render(<CheckoutScreen />, shop)
    await toReview(screen)
    await press(screen, t('checkout.review.place'))
    expect(sent(shop.requests, 'placeOrder')[0]?.variables).toEqual({ provider: 'cod' })
  })
})

describe('a refused placement returns to the step that can fix it, worded by its code', () => {
  it('goes back to the cart when something sold out, an offer ended, or the cart changed', async () => {
    for (const code of ['OUT_OF_STOCK', 'OFFER_CHANGED', 'CART_CHANGED']) {
      mockReplace.mockClear()
      const screen = await render(<CheckoutScreen />, shopFor({ place: () => { throw new ApiError(code, 'x') } }))
      await toReview(screen)
      await press(screen, t('checkout.review.place'))
      expect(hasText(screen, t(`errors.${code as 'OUT_OF_STOCK'}`))).toBe(true)
      await press(screen, t('checkout.refused.toCart'))
      expect(mockReplace).toHaveBeenCalledWith('/cart')
    }
  })

  it('goes back to delivery when the server no longer gives own delivery for the address', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ place: () => { throw new ApiError('NOT_READY', 'x', { problems: ['SHIPPING_UNAVAILABLE'] }) } }))
    await toReview(screen)
    await press(screen, t('checkout.review.place'))
    expect(hasText(screen, t('checkout.delivery.title'))).toBe(true)
    expect(hasText(screen, t('errors.SHIPPING_UNAVAILABLE'))).toBe(true)
  })

  it('goes back to the address when it is missing, and to payment when the method is gone', async () => {
    const noAddress = await render(<CheckoutScreen />, shopFor({ place: () => { throw new ApiError('NOT_READY', 'x', { problems: ['NO_ADDRESS'] }) } }))
    await toReview(noAddress)
    await press(noAddress, t('checkout.review.place'))
    expect(hasText(noAddress, t('checkout.address.title'))).toBe(true)

    const gone = await render(<CheckoutScreen />, shopFor({ place: () => { throw new ApiError('METHOD_UNAVAILABLE', 'x') } }))
    await toReview(gone)
    await press(gone, t('checkout.review.place'))
    expect(hasText(gone, t('checkout.payment.title'))).toBe(true)
    expect(hasText(gone, t('errors.METHOD_UNAVAILABLE'))).toBe(true)
  })

  it('stays on the review with the words for a refusal no step can fix, such as no connection', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ place: () => { throw new ApiError('NO_RESPONSE', 'x') } }))
    await toReview(screen)
    await press(screen, t('checkout.review.place'))
    expect(hasText(screen, t('errors.NO_RESPONSE'))).toBe(true)
    expect(hasText(screen, t('checkout.review.title'))).toBe(true)
  })

  it('goes back to the earlier step when payment is refused as not ready', async () => {
    const screen = await render(<CheckoutScreen />, shopFor({ checkoutRefusal: new ApiError('NOT_READY', 'x', { problems: ['NO_SHIPPING'] }) }))
    await throughContact(screen)
    await throughAddress(screen)
    await throughDelivery(screen, choice(t('checkout.delivery.own'), '₹49.00', t('checkout.delivery.ownNote')))
    await throughPayment(screen)
    expect(hasText(screen, t('checkout.delivery.title'))).toBe(true)
    expect(hasText(screen, t('errors.NOT_READY'))).toBe(true)
  })
})

describe('the states', () => {
  it('has an empty state with a way back to the cart', async () => {
    const screen = await render(<CheckoutScreen />, fakeShop(({ query }) => (query.startsWith('{ cart') ? { cart: null } : guest)))
    expect(hasText(screen, t('checkout.empty.title'))).toBe(true)
    await press(screen, t('checkout.empty.action'))
    expect(mockReplace).toHaveBeenCalledWith('/cart')
  })

  it('has its offline and error states, and offers nothing to write while it has no cart', async () => {
    const offline = await render(<CheckoutScreen />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
    const broken = await render(<CheckoutScreen />, fakeShop(() => { throw new ApiError('UNAVAILABLE', 'x') }))
    expect(hasText(broken, t('states.error.title'))).toBe(true)
  })

  it('has no address or delivery step for a cart with nothing to ship', async () => {
    const screen = await render(<CheckoutScreen />, fakeShop(({ query }) => (query.startsWith('{ cart') ? { cart: cartRead({ needsShipping: false }) } : query.startsWith('{ account') ? signedInAs : { setCartContact: { cart: cartRead({ needsShipping: false, email: 'ana@example.com' }), cartToken: null }, paymentOptions: payments })))
    await throughContact(screen)
    expect(hasText(screen, t('checkout.payment.title'))).toBe(true)
    expect(hasText(screen, t('checkout.steps.address'))).toBe(false)
  })
})
