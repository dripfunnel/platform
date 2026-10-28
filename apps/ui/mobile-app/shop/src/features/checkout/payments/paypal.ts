import * as WebBrowser from 'expo-web-browser'
import type { PaymentStart } from '../../../api/cart'
import type { Shown } from './outcome'

/** PayPal's approval page in the in-app browser (#856): back on `<scheme>://orders/<id>` if approved, `<scheme>://checkout` if cancelled; closing it is a cancel. */
export const presentPaypal = async (start: PaymentStart, scheme: string): Promise<Shown> => {
  if (!start.redirectUrl) return 'unavailable'
  const result = await WebBrowser.openAuthSessionAsync(start.redirectUrl, `${scheme}://`)
  if (result.type !== 'success') return 'cancelled'
  return result.url.startsWith(`${scheme}://checkout`) ? 'cancelled' : 'done'
}
