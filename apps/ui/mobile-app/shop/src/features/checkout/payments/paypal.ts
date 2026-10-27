import * as WebBrowser from 'expo-web-browser'
import type { PaymentStart } from '../../../api/cart'
import type { Shown } from './outcome'

/**
 * PayPal's approval page in the in-app browser, which returns to the app's own scheme (decided on #856): `<scheme>://orders/<id>` once
 * approved, `<scheme>://checkout` if the shopper cancelled there. Closing the browser is a cancel. Approving is not paying: the
 * order is read back from PayPal afterwards (settle.ts).
 */
export const presentPaypal = async (start: PaymentStart, scheme: string): Promise<Shown> => {
  if (!start.redirectUrl) return 'unavailable'
  const result = await WebBrowser.openAuthSessionAsync(start.redirectUrl, `${scheme}://`)
  if (result.type !== 'success') return 'cancelled'
  return result.url.startsWith(`${scheme}://checkout`) ? 'cancelled' : 'done'
}
