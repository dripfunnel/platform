import * as WebBrowser from 'expo-web-browser'
import type { PaymentStart } from '../../../api/cart'
import { presentPaypal } from './paypal'

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }))

const mockOpen = jest.mocked(WebBrowser.openAuthSessionAsync)
const start = (redirectUrl: string | null = 'https://www.paypal.com/checkoutnow?token=T1'): PaymentStart => ({
  providerRef: 'T1', publicKey: null, accountId: null, clientSecret: null, customerId: null, ephemeralKeySecret: null, redirectUrl, mode: 'test',
})

beforeEach(() => mockOpen.mockReset())

describe('the PayPal approval page', () => {
  it('opens the address the API gave in the in-app browser, to return to the app’s own scheme', async () => {
    mockOpen.mockResolvedValue({ type: 'success', url: 'devshop://orders/o-1' })
    expect(await presentPaypal(start(), 'devshop')).toBe('done')
    expect(mockOpen).toHaveBeenCalledWith('https://www.paypal.com/checkoutnow?token=T1', 'devshop://')
  })

  it('is a cancel when the shopper cancelled on PayPal, closed the browser, or it was dismissed', async () => {
    mockOpen.mockResolvedValueOnce({ type: 'success', url: 'devshop://checkout' })
    expect(await presentPaypal(start(), 'devshop')).toBe('cancelled')
    mockOpen.mockResolvedValueOnce({ type: 'cancel' } as never)
    expect(await presentPaypal(start(), 'devshop')).toBe('cancelled')
    mockOpen.mockResolvedValueOnce({ type: 'dismiss' } as never)
    expect(await presentPaypal(start(), 'devshop')).toBe('cancelled')
  })

  it('does not open for an answer with no approval address', async () => {
    expect(await presentPaypal(start(null), 'devshop')).toBe('unavailable')
    expect(mockOpen).not.toHaveBeenCalled()
  })
})
