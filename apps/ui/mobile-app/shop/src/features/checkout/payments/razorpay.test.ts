import RazorpayCheckout from 'react-native-razorpay'
import type { PaymentStart } from '../../../api/cart'
import { inr } from '../../../testing/fixtures'
import { presentRazorpay } from './razorpay'
import type { SheetFacts } from './stripe'

jest.mock('react-native-razorpay', () => ({ __esModule: true, default: { open: jest.fn() } }))

const mockOpen = jest.mocked(RazorpayCheckout.open)

const start = (over: Partial<PaymentStart> = {}): PaymentStart => ({
  providerRef: 'order_from_the_api',
  publicKey: 'rzp_test_from_the_api',
  accountId: null,
  clientSecret: null,
  customerId: null,
  ephemeralKeySecret: null,
  redirectUrl: null,
  mode: 'test',
  amount: inr('155000'),
  sessionId: null,
  providerOrderId: null,
  token: null,
  ...over,
})
const facts = (over: Partial<SheetFacts> = {}): SheetFacts => ({ build: { scheme: 'devshop', appName: 'Dev Shop', appleMerchantId: null }, storeName: 'Juniper', email: 'ana@example.com', phone: '9876543210', country: null, ...over })

beforeEach(() => {
  mockOpen.mockReset()
  mockOpen.mockResolvedValue({ razorpay_payment_id: 'pay_1' })
})

describe('the Razorpay checkout', () => {
  it('opens from what the API answered alone: its order, its key, and the amount it says is due', async () => {
    expect(await presentRazorpay(start(), facts())).toBe('done')
    expect(mockOpen).toHaveBeenCalledWith({
      key: 'rzp_test_from_the_api',
      order_id: 'order_from_the_api',
      amount: '155000',
      currency: 'INR',
      name: 'Juniper',
      prefill: { email: 'ana@example.com', contact: '9876543210' },
    })
  })

  it('shows the app’s name when the store has none, and prefills nothing the shopper has not given', async () => {
    await presentRazorpay(start(), facts({ storeName: '', email: null, phone: null }))
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dev Shop', prefill: {} }))
  })

  it('is a cancel when the shopper closed the checkout, and declined for any other failure it names', async () => {
    mockOpen.mockRejectedValueOnce({ code: 2, description: 'Payment Cancelled' })
    expect(await presentRazorpay(start(), facts())).toBe('cancelled')
    mockOpen.mockRejectedValueOnce({ code: 0, description: 'Network error' })
    expect(await presentRazorpay(start(), facts())).toBe('declined')
    mockOpen.mockRejectedValueOnce({ code: 100, description: 'Something else' })
    expect(await presentRazorpay(start(), facts())).toBe('declined')
  })

  it('does not open for an answer missing its order, key or amount', async () => {
    for (const missing of [{ providerRef: null }, { publicKey: null }, { amount: null }]) {
      expect(await presentRazorpay(start(missing), facts())).toBe('unavailable')
    }
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('lets a failure that is not the SDK’s own (the SDK is not linked in this build) reach the caller, which words it as not started', async () => {
    mockOpen.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'open')"))
    await expect(presentRazorpay(start(), facts())).rejects.toThrow(TypeError)
  })
})
