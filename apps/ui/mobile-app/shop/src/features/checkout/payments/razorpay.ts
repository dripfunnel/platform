import type { PaymentStart } from '../../../api/cart'
import type { Shown } from './outcome'
import { loadRazorpay } from './sdks'
import type { SheetFacts } from './stripe'

/** Razorpay's error code for a checkout the shopper closed (its PAYMENT_CANCELLED). */
const paymentCancelled = 2

const codeOf = (error: unknown): number | null => (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : null)

/** Razorpay's checkout, opened from the API's order, key and amount (the app holds none); the SDK loads only here, so Expo Go still runs the rest. */
export const presentRazorpay = async (start: PaymentStart, facts: SheetFacts): Promise<Shown> => {
  const { providerRef, publicKey, amount } = start
  if (!providerRef || !publicKey || !amount) return 'unavailable'
  const { default: RazorpayCheckout } = loadRazorpay()
  try {
    await RazorpayCheckout.open({
      key: publicKey,
      order_id: providerRef,
      amount: amount.amount,
      currency: amount.currency,
      name: facts.storeName || facts.build.appName,
      prefill: { ...(facts.email ? { email: facts.email } : {}), ...(facts.phone ? { contact: facts.phone } : {}) },
    })
    return 'done'
  } catch (error) {
    const code = codeOf(error)
    if (code === null) throw error
    return code === paymentCancelled ? 'cancelled' : 'declined'
  }
}
