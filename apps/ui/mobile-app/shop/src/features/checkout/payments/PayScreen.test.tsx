import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import Constants from 'expo-constants'
import PhonePe from 'react-native-phonepe-pg'
import { act } from 'react-test-renderer'
import RazorpayCheckout from 'react-native-razorpay'
import { CFPaymentGatewayService } from 'react-native-cashfree-pg-sdk'
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native'
import * as WebBrowser from 'expo-web-browser'
import { cartOperation, type Cart, type PaymentStart, type PlacedOrder } from '../../../api/cart'
import { t } from '../../../messages'
import { cartRead, inr } from '../../../testing/fixtures'
import { fakeShop, hasText, press, render, type Request } from '../../../testing/harness'
import type { Clock } from './settle'
import { PayScreen } from './PayScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { name: 'Dev Shop', extra: { APP_SCHEME: 'devshop' } } } }))
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }))
jest.mock('react-native-razorpay', () => ({ __esModule: true, default: { open: jest.fn() } }))
jest.mock('react-native-cashfree-pg-sdk', () => ({ CFPaymentGatewayService: { setCallback: jest.fn(), removeCallback: jest.fn(), doWebPayment: jest.fn() } }))
jest.mock('react-native-phonepe-pg', () => ({ __esModule: true, default: { init: jest.fn(), startTransaction: jest.fn() } }))
jest.mock('@stripe/stripe-react-native', () => ({
  Constants: { API_VERSIONS: { CORE: '2099-01-01' } },
  PaymentSheetError: { Canceled: 'Canceled', Failed: 'Failed', Timeout: 'Timeout' },
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
}))

const mockPresent = jest.mocked(presentPaymentSheet)
const mockInitSheet = jest.mocked(initPaymentSheet)
const mockOpen = jest.mocked(WebBrowser.openAuthSessionAsync)
const mockRazorpay = jest.mocked(RazorpayCheckout.open)
const mockCashfreeCallback = jest.mocked(CFPaymentGatewayService.setCallback)
const mockCashfreePay = jest.mocked(CFPaymentGatewayService.doWebPayment)
const mockPhonePeInit = jest.mocked(PhonePe.init)
const mockPhonePeStart = jest.mocked(PhonePe.startTransaction)

const stripeStart = (suffix = '1'): PaymentStart => ({
  providerRef: `pi_${suffix}`, publicKey: 'pk_api', accountId: 'acct_api', clientSecret: `secret_${suffix}`, customerId: null, ephemeralKeySecret: null, redirectUrl: null, mode: 'test', amount: null, sessionId: null, providerOrderId: null, token: null,
})
const paypalStart: PaymentStart = { providerRef: 'T1', publicKey: null, accountId: null, clientSecret: null, customerId: null, ephemeralKeySecret: null, redirectUrl: 'https://www.paypal.com/checkoutnow?token=T1', mode: 'test', amount: null, sessionId: null, providerOrderId: null, token: null }

const nothing: PaymentStart = { providerRef: null, publicKey: null, accountId: null, clientSecret: null, customerId: null, ephemeralKeySecret: null, redirectUrl: null, mode: 'test', amount: null, sessionId: null, providerOrderId: null, token: null }
const razorpayStart = (suffix = '1'): PaymentStart => ({ ...nothing, providerRef: `order_${suffix}`, publicKey: 'rzp_test_api', amount: inr('155000') })
const cashfreeStart = (suffix = '1'): PaymentStart => ({ ...nothing, providerRef: `cf_order_${suffix}`, sessionId: `session_${suffix}` })
const phonepeStart = (suffix = '1'): PaymentStart => ({ ...nothing, providerRef: 'ORD-1', providerOrderId: `OMO_${suffix}`, token: `token_${suffix}`, publicKey: 'MERCHANT_API' })

const placed = (provider: string, payment: PaymentStart): PlacedOrder => ({ orderId: 'o-1', number: 'ORD-1', total: inr('155000'), provider, instructions: null, payment })
const cart: Cart = (() => {
  const read = cartOperation().parse({ cart: cartRead({ email: 'ana@example.com' }) })
  if (!read) throw new Error('no cart')
  return read
})()

// The poll's clock moves only when it waits, so the limit costs no time.
const clock = (): Clock => {
  let at = 0
  return { now: () => at, wait: async (ms) => void (at += ms) }
}

const answers = (state: { paid: boolean; retried?: PaymentStart | Error; cancelled?: boolean }) => (r: Request): unknown => {
  if (r.query.includes('confirmPayment')) return { confirmPayment: { state: state.cancelled ? 'cancelled' : 'placed', paymentState: state.paid ? 'paid' : 'pending' } }
  if (r.query.includes('payOrder')) {
    if (state.retried instanceof Error) throw state.retried
    return { payOrder: state.retried }
  }
  if (r.query.includes('address { country }')) return { store: { address: { country: 'US' } } }
  throw new Error(`Unexpected request: ${r.query}`)
}
const sent = (requests: Request[], text: string) => requests.filter((r) => r.query.includes(text))

const open = async (order: PlacedOrder, state: Parameters<typeof answers>[0], extra: { paid?: () => void; leave?: () => void } = {}) => {
  const shop = fakeShop(answers(state), { signedIn: false })
  const onPaid = extra.paid ?? jest.fn()
  const onLeave = extra.leave ?? jest.fn()
  const screen = await render(<PayScreen order={order} cart={cart} onPaid={onPaid} onLeave={onLeave} clock={clock()} />, shop)
  return { screen, shop, onPaid, onLeave }
}

type CashfreeCallback = Parameters<typeof CFPaymentGatewayService.setCallback>[0]

// The checkout answers through the callback the app set, as the SDK does.
const answerCashfree = (answer: (callback: CashfreeCallback) => void) => {
  let callback: CashfreeCallback | null = null
  mockCashfreeCallback.mockImplementation((set) => void (callback = set))
  mockCashfreePay.mockImplementation(() => {
    if (callback) answer(callback)
  })
}

beforeEach(() => {
  mockPresent.mockClear()
  mockPresent.mockResolvedValue({})
  mockInitSheet.mockClear()
  mockOpen.mockReset()
  mockRazorpay.mockReset()
  mockRazorpay.mockResolvedValue({ razorpay_payment_id: 'pay_1' })
  mockCashfreeCallback.mockReset()
  mockCashfreePay.mockReset()
  answerCashfree((callback) => callback.onVerify('cf_order_1'))
  mockPhonePeInit.mockReset()
  mockPhonePeInit.mockResolvedValue(true)
  mockPhonePeStart.mockReset()
  mockPhonePeStart.mockResolvedValue({ status: 'SUCCESS' })
})

describe('paying by Stripe', () => {
  it('opens the sheet from the API’s answer alone, and shows the order paid once the webhook has marked it', async () => {
    const { shop, onPaid } = await open(placed('stripe', stripeStart()), { paid: true })
    expect(mockInitSheet).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'secret_1', defaultBillingDetails: { email: 'ana@example.com' }, googlePay: { merchantCountryCode: 'US', testEnv: true } }))
    expect(onPaid).toHaveBeenCalledTimes(1)
    // The app never places an order or starts a payment here, and never marks one paid: it only reads.
    expect(sent(shop.requests, 'placeOrder')).toHaveLength(0)
    expect(sent(shop.requests, 'payOrder')).toHaveLength(0)
  })

  it('comes back with its reason when the sheet is closed, and tries again on the same order: payOrder, never a second order', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'x' } } as never)
    const { screen, shop, onPaid } = await open(placed('stripe', stripeStart()), { paid: true, retried: stripeStart('2') })
    expect(hasText(screen, t('checkout.pay.stoppedTitle'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.cancelled'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.orderNote', { number: 'ORD-1' }))).toBe(true)
    expect(onPaid).not.toHaveBeenCalled()

    await press(screen, t('checkout.pay.retry'))
    expect(sent(shop.requests, 'payOrder')[0]?.variables).toEqual({ orderId: 'o-1', app: { scheme: 'devshop', stripeApiVersion: '2099-01-01' } })
    expect(mockInitSheet).toHaveBeenLastCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'secret_2' }))
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(sent(shop.requests, 'placeOrder')).toHaveLength(0)
  })

  it('words a declined payment and one the sheet could not start, each as nothing charged', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Failed', message: 'Your card was declined.' } } as never)
    const declined = await open(placed('stripe', stripeStart()), { paid: false })
    expect(hasText(declined.screen, t('checkout.pay.declined'))).toBe(true)
    expect(hasText(declined.screen, 'Your card was declined.')).toBe(false)

    const noKey = await open(placed('stripe', { ...stripeStart(), clientSecret: null }), { paid: false })
    expect(hasText(noKey.screen, t('checkout.pay.unavailable'))).toBe(true)
  })

  it('treats a retry for an order that was paid meanwhile as paid', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'x' } } as never)
    const { screen, onPaid } = await open(placed('stripe', stripeStart()), { paid: true, retried: new ApiError('ALREADY_PAID', 'x') })
    await press(screen, t('checkout.pay.retry'))
    expect(onPaid).toHaveBeenCalledTimes(1)
  })

  it('says why a retry is refused, and stays where it was', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'x' } } as never)
    const { screen, onPaid } = await open(placed('stripe', stripeStart()), { paid: false, retried: new ApiError('PAYMENT_PENDING', 'x') })
    await press(screen, t('checkout.pay.retry'))
    expect(hasText(screen, t('errors.PAYMENT_PENDING'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.retry'))).toBe(true)
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('lets the shopper leave without paying', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'x' } } as never)
    const { screen, onLeave } = await open(placed('stripe', stripeStart()), { paid: false })
    await press(screen, t('checkout.pay.leave'))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })
})

describe('an order the API placed with nothing to pay it with', () => {
  it('opens no sheet and says it could not start, never that it is paid, and pays on a new attempt', async () => {
    const order: PlacedOrder = { ...placed('stripe', stripeStart()), payment: null }
    const { screen, shop, onPaid } = await open(order, { paid: true, retried: stripeStart('3') })
    expect(mockInitSheet).not.toHaveBeenCalled()
    expect(hasText(screen, t('checkout.pay.unavailable'))).toBe(true)
    expect(onPaid).not.toHaveBeenCalled()
    expect(sent(shop.requests, 'confirmPayment')).toHaveLength(0)

    await press(screen, t('checkout.pay.retry'))
    expect(sent(shop.requests, 'payOrder')).toHaveLength(1)
    expect(mockInitSheet).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'secret_3' }))
    expect(onPaid).toHaveBeenCalledTimes(1)
  })
})

describe('when the payment is not confirmed in time', () => {
  it('says it is still confirming and offers no second payment, only to check again or finish', async () => {
    const { screen, onPaid, onLeave } = await open(placed('stripe', stripeStart()), { paid: false })
    expect(hasText(screen, t('checkout.pay.pendingTitle'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.pendingBody'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.retry'))).toBe(false)
    expect(onPaid).not.toHaveBeenCalled()
    await press(screen, t('checkout.pay.done'))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it('reads the order again on Check again, and shows it paid once the webhook has come', async () => {
    let paid = false
    const shop = fakeShop((r) => answers({ paid })(r))
    const onPaid = jest.fn()
    const screen = await render(<PayScreen order={placed('stripe', stripeStart())} cart={cart} onPaid={onPaid} onLeave={jest.fn()} clock={clock()} />, shop)
    expect(hasText(screen, t('checkout.pay.pendingTitle'))).toBe(true)
    paid = true
    await press(screen, t('checkout.pay.checkAgain'))
    expect(onPaid).toHaveBeenCalledTimes(1)
  })

  it('says an order cancelled meanwhile is cancelled, and offers no new attempt it would refuse', async () => {
    const { screen, shop } = await open(placed('stripe', stripeStart()), { paid: false, cancelled: true })
    expect(hasText(screen, t('checkout.pay.orderCancelled'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.retry'))).toBe(false)
    expect(hasText(screen, t('checkout.pay.leave'))).toBe(true)
    expect(sent(shop.requests, 'payOrder')).toHaveLength(0)
  })

  it('keeps the shopper on the screen with the API’s refusal when a new attempt is refused as not pending', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'x' } } as never)
    const { screen, onPaid } = await open(placed('stripe', stripeStart()), { paid: false, retried: new ApiError('NOT_PENDING', 'x') })
    await press(screen, t('checkout.pay.retry'))
    expect(hasText(screen, t('errors.NOT_PENDING'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.retry'))).toBe(true)
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('says it could not start, with a way to try again, when the build has no scheme to start with', async () => {
    const config = Constants.expoConfig
    if (!config) throw new Error('no config')
    const extra = { ...config.extra }
    config.extra = {}
    try {
      const { screen } = await open(placed('stripe', stripeStart()), { paid: true, retried: stripeStart('2') })
      expect(hasText(screen, t('checkout.pay.unavailable'))).toBe(true)
      expect(mockInitSheet).not.toHaveBeenCalled()
      await press(screen, t('checkout.pay.retry'))
      expect(hasText(screen, t('errors.UNKNOWN'))).toBe(true)
    } finally {
      config.extra = extra
    }
  })
})

describe('paying by PayPal', () => {
  it('opens the approval page from the API’s answer, then reads the order back before it says paid', async () => {
    mockOpen.mockResolvedValue({ type: 'success', url: 'devshop://orders/o-1' })
    const { shop, onPaid } = await open(placed('paypal', paypalStart), { paid: true })
    expect(mockOpen).toHaveBeenCalledWith('https://www.paypal.com/checkoutnow?token=T1', 'devshop://')
    expect(sent(shop.requests, 'confirmPayment').length).toBeGreaterThan(0)
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(mockPresent).not.toHaveBeenCalled()
  })

  it('comes back as cancelled when the shopper cancels on PayPal, and retries with the scheme alone', async () => {
    mockOpen.mockResolvedValueOnce({ type: 'success', url: 'devshop://checkout' }).mockResolvedValueOnce({ type: 'success', url: 'devshop://orders/o-1' })
    const { screen, shop, onPaid } = await open(placed('paypal', paypalStart), { paid: true, retried: paypalStart })
    expect(hasText(screen, t('checkout.pay.cancelled'))).toBe(true)
    await press(screen, t('checkout.pay.retry'))
    expect(sent(shop.requests, 'payOrder')[0]?.variables).toEqual({ orderId: 'o-1', app: { scheme: 'devshop' } })
    expect(onPaid).toHaveBeenCalledTimes(1)
  })
})

describe('paying by Razorpay, Cashfree or PhonePe', () => {
  it('opens Razorpay’s checkout from the API’s answer, then shows the order paid only once the webhook has marked it', async () => {
    const { shop, onPaid } = await open(placed('razorpay', razorpayStart()), { paid: true })
    expect(mockRazorpay).toHaveBeenCalledWith(expect.objectContaining({ key: 'rzp_test_api', order_id: 'order_1', amount: '155000', currency: 'INR' }))
    expect(sent(shop.requests, 'confirmPayment').length).toBeGreaterThan(0)
    expect(sent(shop.requests, 'payOrder')).toHaveLength(0)
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(mockPresent).not.toHaveBeenCalled()
  })

  it('does the same for Cashfree and for PhonePe', async () => {
    const cashfree = await open(placed('cashfree', cashfreeStart()), { paid: true })
    expect(mockCashfreePay).toHaveBeenCalledTimes(1)
    expect(cashfree.onPaid).toHaveBeenCalledTimes(1)

    const phonepe = await open(placed('phonepe', phonepeStart()), { paid: true })
    expect(mockPhonePeInit).toHaveBeenCalledWith('SANDBOX', 'MERCHANT_API', 'ORD1', false)
    expect(phonepe.onPaid).toHaveBeenCalledTimes(1)
  })

  it('says it is still confirming, and offers no second payment, when the checkout closed well but the order is not yet paid', async () => {
    const { screen, onPaid } = await open(placed('razorpay', razorpayStart()), { paid: false })
    expect(hasText(screen, t('checkout.pay.pendingTitle'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.retry'))).toBe(false)
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('comes back as cancelled, and retries the same order with the scheme alone, never with the Stripe version', async () => {
    mockRazorpay.mockRejectedValueOnce({ code: 2, description: 'Payment Cancelled' })
    const { screen, shop, onPaid } = await open(placed('razorpay', razorpayStart()), { paid: true, retried: razorpayStart('2') })
    expect(hasText(screen, t('checkout.pay.cancelled'))).toBe(true)
    expect(onPaid).not.toHaveBeenCalled()
    await press(screen, t('checkout.pay.retry'))
    expect(sent(shop.requests, 'payOrder')[0]?.variables).toEqual({ orderId: 'o-1', app: { scheme: 'devshop' } })
    expect(mockRazorpay).toHaveBeenLastCalledWith(expect.objectContaining({ order_id: 'order_2' }))
    expect(onPaid).toHaveBeenCalledTimes(1)
  })

  it('words a failure and a left checkout from the code, never from the provider’s own sentence', async () => {
    answerCashfree((callback) => callback.onError({ getCode: () => 'payment_failed', getMessage: () => 'Your bank said no' } as never, 'cf_order_1'))
    const declined = await open(placed('cashfree', cashfreeStart()), { paid: false })
    expect(hasText(declined.screen, t('checkout.pay.declined'))).toBe(true)
    expect(hasText(declined.screen, 'Your bank said no')).toBe(false)
    expect(hasText(declined.screen, t('checkout.pay.retry'))).toBe(true)

    mockPhonePeStart.mockResolvedValueOnce({ status: 'INTERRUPTED' })
    const left = await open(placed('phonepe', phonepeStart()), { paid: false })
    expect(hasText(left.screen, t('checkout.pay.cancelled'))).toBe(true)
  })

  it('says it could not start, with a way to try again, when the SDK is not in this build', async () => {
    mockRazorpay.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'open')"))
    const { screen, onPaid } = await open(placed('razorpay', razorpayStart()), { paid: true })
    expect(hasText(screen, t('checkout.pay.unavailable'))).toBe(true)
    expect(hasText(screen, t('checkout.pay.retry'))).toBe(true)
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('names the provider while its checkout opens', async () => {
    let release: (value: { razorpay_payment_id: string }) => void = () => undefined
    mockRazorpay.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const { screen } = await open(placed('razorpay', razorpayStart()), { paid: true })
    expect(hasText(screen, t('checkout.pay.opening', { method: t('checkout.pay.method.razorpay') }))).toBe(true)
    await act(async () => release({ razorpay_payment_id: 'pay_1' }))
  })
})
