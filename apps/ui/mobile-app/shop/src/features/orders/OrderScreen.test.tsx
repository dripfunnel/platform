import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, texts } from '../../testing/harness'
import { deliveryRead, orderRead, rider } from '../../testing/orders'
import { OrderScreen } from './OrderScreen'

jest.setTimeout(60_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
const mockPush = jest.fn()
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const open = (answer: unknown) => render(<OrderScreen orderId="o-1" />, fakeShop(() => answer, { signedIn: true }))

beforeEach(() => mockPush.mockClear())

describe('an order', () => {
  it('shows its number, status, date, lines and the totals the API worked out', async () => {
    const screen = await open(orderRead({ discounts: [{ name: 'WELCOME', amount: { amount: '10000', currency: 'INR' } }] }))
    expect(hasText(screen, t('orders.order', { number: 'ORD-1005' }))).toBe(true)
    expect(hasText(screen, t('orders.status.paid'))).toBe(true)
    expect(hasText(screen, t('orders.placedOn', { date: 'Oct 27, 2026' }))).toBe(true)
    expect(hasText(screen, 'Linen Shirt')).toBe(true)
    expect(hasText(screen, 'Sand / M')).toBe(true)
    expect(hasText(screen, t('orders.quantity', { count: 2 }))).toBe(true)
    expect(hasText(screen, '₹1,499.00')).toBe(true)
    expect(hasText(screen, '₹398.00')).toBe(true)
    expect(hasText(screen, '−₹100.00')).toBe(true)
    expect(hasText(screen, '₹49.00')).toBe(true)
    expect(hasText(screen, '₹1,946.00')).toBe(true)
    expect(hasText(screen, t('orders.summary.taxIncluded', { tax: '₹296.00' }))).toBe(true)
  })

  it('adds the tax as its own row when prices do not include it', async () => {
    const screen = await open(orderRead({ pricesIncludeTax: false }))
    expect(hasText(screen, t('orders.summary.tax'))).toBe(true)
    expect(hasText(screen, t('orders.summary.taxIncluded', { tax: '₹296.00' }))).toBe(false)
  })

  it('names how it is paid and delivered, as the API gives them', async () => {
    const screen = await open(orderRead())
    expect(hasText(screen, 'Razorpay')).toBe(true)
    expect(hasText(screen, 'Own delivery')).toBe(true)
  })

  it('has no delivery to follow when it is not an own delivery', async () => {
    const screen = await open(orderRead({ shippingMethod: 'Standard delivery · Delhivery' }, null))
    expect(hasText(screen, t('orders.delivery.track'))).toBe(false)
  })

  it('shows where an own delivery stands, and opens its tracking', async () => {
    const screen = await open(orderRead({}, deliveryRead('assigned', { rider, handoverCode: '2580' })))
    expect(hasText(screen, t('orders.delivery.title'))).toBe(true)
    expect(hasText(screen, t('tracking.lead.assigned', { name: 'Asha' }))).toBe(true)
    await press(screen, t('orders.delivery.track'))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/orders/[id]/track', params: { id: 'o-1' } })
  })

  it('never shows the handover code or the rider’s number here: they are on the tracking screen, for the order’s own reader', async () => {
    const screen = await open(orderRead({}, deliveryRead('assigned', { rider, handoverCode: '2580' })))
    expect(texts(screen).join(' ')).not.toContain('2580')
    expect(texts(screen).join(' ')).not.toContain('98765')
  })

  it('says a delivery was not made, and that one was', async () => {
    expect(hasText(await open(orderRead({}, deliveryRead('failed'))), t('tracking.state.failed'))).toBe(true)
    expect(hasText(await open(orderRead({}, deliveryRead('delivered'))), t('tracking.state.delivered'))).toBe(true)
  })

  it('says it was cancelled, and asks for no payment', async () => {
    const screen = await open(orderRead({ state: 'cancelled', paymentState: 'pending', paymentMethod: 'bank_transfer', paymentDueBy: '2026-10-30T00:00:00Z' }))
    expect(hasText(screen, t('orders.cancelledNote'))).toBe(true)
    expect(hasText(screen, t('orders.status.cancelled'))).toBe(true)
    expect(hasText(screen, t('orders.payBy', { date: 'Oct 30, 2026' }))).toBe(false)
  })

  it('says when a transfer is due, and that cash is paid on delivery', async () => {
    const bank = await open(orderRead({ paymentState: 'pending', paymentMethod: 'bank_transfer', paymentDueBy: '2026-10-30T00:00:00Z' }))
    expect(hasText(bank, t('orders.status.bankWaiting'))).toBe(true)
    expect(hasText(bank, t('orders.payBy', { date: 'Oct 30, 2026' }))).toBe(true)
    const cod = await open(orderRead({ paymentState: 'pending', paymentMethod: 'cod' }))
    expect(hasText(cod, t('orders.status.payOnDelivery'))).toBe(true)
  })

  it('is not found for a shopper the API finds no such order for', async () => {
    const screen = await open({ order: null, store: { timeZone: null } })
    expect(hasText(screen, t('orders.notFound.title'))).toBe(true)
  })

  it('has its error and offline states, each with a way to try again', async () => {
    const failing = await render(<OrderScreen orderId="o-1" />, fakeShop(() => { throw new ApiError('SERVER', 'x') }, { signedIn: true }))
    expect(hasText(failing, t('states.error.title'))).toBe(true)
    const offline = await render(<OrderScreen orderId="o-1" />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }, { signedIn: true }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
  })
})
