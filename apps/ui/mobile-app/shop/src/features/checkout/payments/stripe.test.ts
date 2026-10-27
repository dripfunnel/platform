import { initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native'
import type { PaymentStart } from '../../../api/cart'
import type { SheetFacts } from './stripe'
import { presentStripe, stripeApiVersion } from './stripe'

jest.mock('@stripe/stripe-react-native', () => ({
  Constants: { API_VERSIONS: { CORE: '2099-01-01' } },
  PaymentSheetError: { Canceled: 'Canceled', Failed: 'Failed', Timeout: 'Timeout' },
  initStripe: jest.fn(),
  initPaymentSheet: jest.fn(),
  presentPaymentSheet: jest.fn(),
}))

const mockInitStripe = jest.mocked(initStripe)
const mockInitSheet = jest.mocked(initPaymentSheet)
const mockPresent = jest.mocked(presentPaymentSheet)

const start = (over: Partial<PaymentStart> = {}): PaymentStart => ({
  providerRef: 'pi_1',
  publicKey: 'pk_from_the_api',
  accountId: 'acct_from_the_api',
  clientSecret: 'pi_1_secret_from_the_api',
  customerId: 'cus_from_the_api',
  ephemeralKeySecret: 'ek_from_the_api',
  redirectUrl: null,
  mode: 'test',
  ...over,
})
const facts = (over: Partial<SheetFacts> = {}): SheetFacts => ({ build: { scheme: 'devshop', appName: 'Dev Shop', appleMerchantId: null }, storeName: 'Juniper', email: 'ana@example.com', country: null, ...over })

beforeEach(() => {
  jest.clearAllMocks()
  mockInitStripe.mockResolvedValue(undefined)
  mockInitSheet.mockResolvedValue({})
  mockPresent.mockResolvedValue({})
})

describe('the Stripe sheet', () => {
  it('speaks the API version its SDK reports, which the API makes the shopper’s ephemeral key with', () => {
    expect(stripeApiVersion()).toBe('2099-01-01')
  })

  it('is set up only from what the API answered: the connected account’s key and id, the intent’s secret, the shopper’s customer and key', async () => {
    expect(await presentStripe(start(), facts())).toBe('done')
    expect(mockInitStripe).toHaveBeenCalledWith({ publishableKey: 'pk_from_the_api', stripeAccountId: 'acct_from_the_api', urlScheme: 'devshop' })
    expect(mockInitSheet).toHaveBeenCalledWith({
      merchantDisplayName: 'Juniper',
      paymentIntentClientSecret: 'pi_1_secret_from_the_api',
      returnURL: 'devshop://stripe-redirect',
      customerId: 'cus_from_the_api',
      customerEphemeralKeySecret: 'ek_from_the_api',
      defaultBillingDetails: { email: 'ana@example.com' },
    })
    expect(mockPresent).toHaveBeenCalledTimes(1)
  })

  it('has no saved cards for a guest, and no wallets without the store’s country', async () => {
    await presentStripe(start({ customerId: null, ephemeralKeySecret: null }), facts({ email: null }))
    const config = mockInitSheet.mock.calls[0]?.[0]
    expect(config).not.toHaveProperty('customerId')
    expect(config).not.toHaveProperty('customerEphemeralKeySecret')
    expect(config).not.toHaveProperty('googlePay')
    expect(config).not.toHaveProperty('applePay')
  })

  it('offers Google Pay with the store’s country and the payment’s mode, and Apple Pay only for a store with a merchant identifier', async () => {
    await presentStripe(start({ mode: 'test' }), facts({ country: 'US' }))
    expect(mockInitSheet.mock.calls[0]?.[0]).toMatchObject({ googlePay: { merchantCountryCode: 'US', testEnv: true } })
    expect(mockInitSheet.mock.calls[0]?.[0]).not.toHaveProperty('applePay')

    await presentStripe(start({ mode: 'live' }), facts({ country: 'US', build: { scheme: 'devshop', appName: 'Dev Shop', appleMerchantId: 'merchant.com.juniper' } }))
    expect(mockInitSheet.mock.calls[1]?.[0]).toMatchObject({ googlePay: { merchantCountryCode: 'US', testEnv: false }, applePay: { merchantCountryCode: 'US' } })
  })

  it('names a close, a failure and a timeout by their codes, never by Stripe’s own sentence', async () => {
    mockPresent.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'The payment flow has been canceled' } } as never)
    expect(await presentStripe(start(), facts())).toBe('cancelled')
    mockPresent.mockResolvedValueOnce({ error: { code: 'Failed', message: 'Your card was declined.' } } as never)
    expect(await presentStripe(start(), facts())).toBe('declined')
    mockPresent.mockResolvedValueOnce({ error: { code: 'Timeout', message: 'x' } } as never)
    expect(await presentStripe(start(), facts())).toBe('timeout')
  })

  it('does not open for an answer without a key or a secret, or a sheet Stripe could not set up', async () => {
    expect(await presentStripe(start({ clientSecret: null }), facts())).toBe('unavailable')
    expect(await presentStripe(start({ publicKey: null }), facts())).toBe('unavailable')
    expect(mockInitStripe).not.toHaveBeenCalled()
    mockInitSheet.mockResolvedValueOnce({ error: { code: 'Failed', message: 'bad secret' } } as never)
    expect(await presentStripe(start(), facts())).toBe('unavailable')
    expect(mockPresent).not.toHaveBeenCalled()
  })
})
