import { CFPaymentGatewayService } from 'react-native-cashfree-pg-sdk'
import { CFEnvironment, CFSession } from 'cashfree-pg-api-contract'
import type { PaymentStart } from '../../../api/cart'
import { presentCashfree } from './cashfree'

jest.mock('react-native-cashfree-pg-sdk', () => ({ CFPaymentGatewayService: { setCallback: jest.fn(), removeCallback: jest.fn(), doWebPayment: jest.fn() } }))

type Callback = Parameters<typeof CFPaymentGatewayService.setCallback>[0]
type SdkError = Parameters<Callback['onError']>[0]

const mockSet = jest.mocked(CFPaymentGatewayService.setCallback)
const mockRemove = jest.mocked(CFPaymentGatewayService.removeCallback)
const mockPay = jest.mocked(CFPaymentGatewayService.doWebPayment)

const start = (over: Partial<PaymentStart> = {}): PaymentStart => ({
  providerRef: 'order_from_the_api',
  publicKey: null,
  accountId: null,
  clientSecret: null,
  customerId: null,
  ephemeralKeySecret: null,
  redirectUrl: null,
  mode: 'test',
  amount: null,
  sessionId: 'session_from_the_api',
  providerOrderId: null,
  token: null,
  ...over,
})

const failing = (code: string, message: string): SdkError => ({ getCode: () => code, getMessage: () => message }) as SdkError

// The checkout answers through the callback the app set, as the SDK does.
const answers = (answer: (callback: Callback) => void) => {
  let callback: Callback | null = null
  mockSet.mockImplementation((set) => void (callback = set))
  mockPay.mockImplementation(() => {
    if (callback) answer(callback)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSet.mockReset()
  mockPay.mockReset()
})

describe('the Cashfree checkout', () => {
  it('opens from the API’s payment session and order, in the sandbox for a test store, and is done when the SDK says verify', async () => {
    answers((callback) => callback.onVerify('order_from_the_api'))
    expect(await presentCashfree(start())).toBe('done')
    expect(mockPay).toHaveBeenCalledWith(new CFSession('session_from_the_api', 'order_from_the_api', CFEnvironment.SANDBOX))
  })

  it('uses production only for a live store, and never guesses the environment', async () => {
    answers((callback) => callback.onVerify('order_from_the_api'))
    await presentCashfree(start({ mode: 'live' }))
    expect(mockPay).toHaveBeenLastCalledWith(new CFSession('session_from_the_api', 'order_from_the_api', CFEnvironment.PRODUCTION))
    mockPay.mockClear()
    expect(await presentCashfree(start({ mode: null }))).toBe('unavailable')
    expect(await presentCashfree(start({ mode: 'demo' }))).toBe('unavailable')
    expect(mockPay).not.toHaveBeenCalled()
  })

  it('is declined for a failure, and a cancel when the SDK names a closed or dropped checkout', async () => {
    answers((callback) => callback.onError(failing('payment_failed', 'Payment has failed'), 'order_from_the_api'))
    expect(await presentCashfree(start())).toBe('declined')
    answers((callback) => callback.onError(failing('payment_cancelled', 'Cancelled'), 'order_from_the_api'))
    expect(await presentCashfree(start())).toBe('cancelled')
    answers((callback) => callback.onError(failing('request_failed', 'User dropped'), 'order_from_the_api'))
    expect(await presentCashfree(start())).toBe('cancelled')
  })

  it('does not open for an answer missing its session or order', async () => {
    expect(await presentCashfree(start({ sessionId: null }))).toBe('unavailable')
    expect(await presentCashfree(start({ providerRef: null }))).toBe('unavailable')
    expect(mockPay).not.toHaveBeenCalled()
  })

  it('leaves no callback behind once the checkout answered, so the next attempt is not answered twice', async () => {
    answers((callback) => callback.onVerify('order_from_the_api'))
    await presentCashfree(start())
    expect(mockRemove).toHaveBeenCalledTimes(2)
  })

  it('rejects, with the callback removed, when the SDK cannot open (it is not linked in this build)', async () => {
    mockSet.mockImplementation(() => undefined)
    mockPay.mockImplementation(() => {
      throw new Error('The package doesn’t seem to be linked')
    })
    await expect(presentCashfree(start())).rejects.toThrow('linked')
    expect(mockRemove).toHaveBeenCalledTimes(2)
  })
})
