import { CFEnvironment, CFSession } from 'cashfree-pg-api-contract'
import type { PaymentStart } from '../../../api/cart'
import type { Shown } from './outcome'
import { loadCashfree } from './sdks'

const environmentOf = (mode: string | null): CFEnvironment | null => (mode === 'test' ? CFEnvironment.SANDBOX : mode === 'live' ? CFEnvironment.PRODUCTION : null)

/** Cashfree's checkout, opened from the API's payment session; it never defaults to production, and the SDK loads only here, so Expo Go still runs the rest. */
export const presentCashfree = async (start: PaymentStart): Promise<Shown> => {
  const { sessionId, providerRef } = start
  const environment = environmentOf(start.mode)
  if (!sessionId || !providerRef || !environment) return 'unavailable'
  const { CFPaymentGatewayService: gateway } = loadCashfree()
  return new Promise<Shown>((resolve, reject) => {
    const finish = (shown: Shown) => {
      gateway.removeCallback()
      resolve(shown)
    }
    gateway.removeCallback()
    try {
      gateway.setCallback({
        // The SDK's "verify" is not a payment: the order is read back afterwards.
        onVerify: () => finish('done'),
        // Whether Cashfree names a closed checkout in `code` or `message` is not documented: a guess that only changes the wording.
        onError: (error) => finish(/cancel|dropped/i.test(`${error.getCode()} ${error.getMessage()}`) ? 'cancelled' : 'declined'),
      })
      gateway.doWebPayment(new CFSession(sessionId, providerRef, environment))
    } catch (error) {
      gateway.removeCallback()
      reject(error)
    }
  })
}
