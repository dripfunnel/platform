import Constants from 'expo-constants'
import { z } from 'zod'
import type { AppPayment } from '../../../api/cart'

// The build values a payment needs (docs/mobile-app/README.md §3): the app's own URL scheme, which providers return to, and for Apple Pay
// the store's merchant identifier, which only a store that has one carries. Nothing else about payments is per store in code.
const extra = z.object({ APP_SCHEME: z.string().min(1), APPLE_PAY_MERCHANT_ID: z.string().min(1).optional() })

export type PaymentBuild = { scheme: string; appName: string; appleMerchantId: string | null }

export const paymentBuild = (): PaymentBuild => {
  const parsed = extra.safeParse(Constants.expoConfig?.extra)
  if (!parsed.success) throw new Error('The build has no APP_SCHEME (docs/mobile-app/README.md §3).')
  return { scheme: parsed.data.APP_SCHEME, appName: Constants.expoConfig?.name ?? '', appleMerchantId: parsed.data.APPLE_PAY_MERCHANT_ID ?? null }
}

/** The ways to pay the app takes in a provider's own sheet. Cash on delivery and bank transfer are placed and paid later. */
export const sheetProviders: readonly string[] = ['stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe']
export const isSheetProvider = (provider: string): boolean => sheetProviders.includes(provider)

/** What the API needs of the app to start this provider's payment; none for a way paid later. */
export const appPaymentFor = (provider: string, build: PaymentBuild, stripeApiVersion: () => string): AppPayment | undefined => {
  if (provider === 'stripe') return { scheme: build.scheme, stripeApiVersion: stripeApiVersion() }
  if (sheetProviders.includes(provider)) return { scheme: build.scheme }
  return undefined
}
