import type { PaymentGateways } from '#core/payments'
import { cashfree } from './cashfree'
import { paypal } from './paypal'
import { phonepe } from './phonepe'
import { razorpay } from './razorpay'

/** The providers that take the merchant's own pasted keys (THIRD-PARTY-ACCESS §3.1); Stripe connects apart (integrations/stripe). */
export const keyedGateways = (fetchImpl: typeof fetch = fetch): PaymentGateways => ({
  razorpay: razorpay({ fetchImpl }),
  cashfree: cashfree({ fetchImpl }),
  phonepe: phonepe({ fetchImpl }),
  paypal: paypal({ fetchImpl }),
})
