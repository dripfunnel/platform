import PhonePe from 'react-native-phonepe-pg'
import type { PaymentStart } from '../../../api/cart'
import { presentPhonePe } from './phonepe'
import type { SheetFacts } from './stripe'

jest.mock('react-native-phonepe-pg', () => ({ __esModule: true, default: { init: jest.fn(), startTransaction: jest.fn() } }))

const mockInit = jest.mocked(PhonePe.init)
const mockStart = jest.mocked(PhonePe.startTransaction)

const start = (over: Partial<PaymentStart> = {}): PaymentStart => ({
  providerRef: 'ORD-1051',
  publicKey: 'MERCHANT_FROM_THE_API',
  accountId: null,
  clientSecret: null,
  customerId: null,
  ephemeralKeySecret: null,
  redirectUrl: null,
  mode: 'test',
  amount: null,
  sessionId: null,
  providerOrderId: 'OMO_from_the_api',
  token: 'token_from_the_api',
  ...over,
})
const facts: SheetFacts = { build: { scheme: 'devshop', appName: 'Dev Shop', appleMerchantId: null }, storeName: 'Juniper', email: null, phone: null, country: null }

beforeEach(() => {
  mockInit.mockReset()
  mockStart.mockReset()
  mockInit.mockResolvedValue(true)
  mockStart.mockResolvedValue({ status: 'SUCCESS' })
})

describe('the PhonePe checkout', () => {
  it('starts from the API’s SDK order, token and merchant id, in the sandbox for a test store, with logging off', async () => {
    expect(await presentPhonePe(start(), facts)).toBe('done')
    expect(mockInit).toHaveBeenCalledWith('SANDBOX', 'MERCHANT_FROM_THE_API', 'ORD1051', false)
    const [request, scheme] = mockStart.mock.calls[0] ?? []
    expect(JSON.parse(String(request))).toEqual({ orderId: 'OMO_from_the_api', merchantId: 'MERCHANT_FROM_THE_API', token: 'token_from_the_api', paymentMode: { type: 'PAY_PAGE' } })
    expect(scheme).toBe('devshop')
  })

  it('uses production only for a live store, and never guesses the environment', async () => {
    await presentPhonePe(start({ mode: 'live' }), facts)
    expect(mockInit).toHaveBeenLastCalledWith('PRODUCTION', 'MERCHANT_FROM_THE_API', 'ORD1051', false)
    mockInit.mockClear()
    expect(await presentPhonePe(start({ mode: null }), facts)).toBe('unavailable')
    expect(await presentPhonePe(start({ mode: 'demo' }), facts)).toBe('unavailable')
    expect(mockInit).not.toHaveBeenCalled()
  })

  it('gives the SDK a flow id of letters and digits only, and one even when the answer has no reference', async () => {
    await presentPhonePe(start({ providerRef: null }), facts)
    expect(mockInit).toHaveBeenLastCalledWith('SANDBOX', 'MERCHANT_FROM_THE_API', 'order', false)
  })

  it('is a cancel when the shopper left the checkout, and declined for a failure or an answer it does not understand', async () => {
    mockStart.mockResolvedValueOnce({ status: 'INTERRUPTED' })
    expect(await presentPhonePe(start(), facts)).toBe('cancelled')
    mockStart.mockResolvedValueOnce({ status: 'FAILURE', error: 'x' })
    expect(await presentPhonePe(start(), facts)).toBe('declined')
    mockStart.mockResolvedValueOnce('nonsense')
    expect(await presentPhonePe(start(), facts)).toBe('declined')
  })

  it('does not start when the SDK could not be set up', async () => {
    mockInit.mockResolvedValueOnce(false)
    expect(await presentPhonePe(start(), facts)).toBe('unavailable')
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('does not start for an answer missing its order, token or merchant id', async () => {
    for (const missing of [{ providerOrderId: null }, { token: null }, { publicKey: null }]) {
      expect(await presentPhonePe(start(missing), facts)).toBe('unavailable')
    }
    expect(mockInit).not.toHaveBeenCalled()
  })
})
