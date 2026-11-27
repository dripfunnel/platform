import { z } from 'zod'
import type { PlanCheckout } from '../../api/billing'

// Razorpay's own Checkout on the store's subscription (#1744): the card number or UPI approval goes straight to Razorpay;
// this page only gets the payment id and its signature back, which the API checks and reads back before anything is saved.

interface RazorpayInstance {
  open: () => void
}
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance
declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

const scriptUrl = 'https://checkout.razorpay.com/v1/checkout.js'
let loading: Promise<RazorpayConstructor> | null = null

const loadCheckout = (): Promise<RazorpayConstructor> => {
  loading ??= new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(window.Razorpay)
    const script = document.createElement('script')
    script.src = scriptUrl
    script.async = true
    const failed = () => {
      loading = null
      reject(new Error('Razorpay Checkout did not load'))
    }
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : failed())
    script.onerror = failed
    document.head.append(script)
  })
  return loading
}

const answerSchema = z.object({ razorpay_payment_id: z.string(), razorpay_subscription_id: z.string(), razorpay_signature: z.string() })
export type CheckoutAnswer = { paymentId: string; subscriptionId: string; signature: string }

/** Opens Checkout on the subscription; the answer once paid, or null when the Owner closed it. */
export const openCheckout = async (start: PlanCheckout, shop: { name: string; description: string }): Promise<CheckoutAnswer | null> => {
  const Razorpay = await loadCheckout()
  return new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: start.keyId,
      subscription_id: start.subscriptionId,
      name: shop.name,
      description: shop.description,
      handler: (raw: unknown) => {
        const answer = answerSchema.safeParse(raw)
        if (answer.success) resolve({ paymentId: answer.data.razorpay_payment_id, subscriptionId: answer.data.razorpay_subscription_id, signature: answer.data.razorpay_signature })
        else reject(new Error('Razorpay Checkout answered in a shape we do not read'))
      },
      modal: { ondismiss: () => resolve(null) },
    })
    checkout.open()
  })
}
