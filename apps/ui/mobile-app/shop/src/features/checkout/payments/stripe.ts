import { Constants, initPaymentSheet, initStripe, PaymentSheetError, presentPaymentSheet } from '@stripe/stripe-react-native'
import type { PaymentStart } from '../../../api/cart'
import type { PaymentBuild } from './env'
import type { Shown } from './outcome'

/** The Stripe API version the app's SDK speaks, which the API makes the shopper's ephemeral key with (shop/ARCHITECTURE.md §4). */
export const stripeApiVersion = (): string => Constants.API_VERSIONS.CORE

export type SheetFacts = {
  build: PaymentBuild
  /** The name the sheet shows: the store's, else the app's. Android refuses an empty one. */
  storeName: string
  /** The shopper's contact email, so the sheet does not ask for it again. */
  email: string | null
  /** The store's country, for the wallets; without it the sheet takes cards alone. */
  country: string | null
}

/**
 * Stripe's Payment Sheet, set up only from what the API answered (the connected account's key and id, the intent's secret, the
 * shopper's customer and ephemeral key): the app holds no key. Apple Pay appears only for a store whose build names a merchant
 * identifier, Google Pay where the device and the account allow it; the sheet decides what it shows.
 */
export const presentStripe = async (start: PaymentStart, facts: SheetFacts): Promise<Shown> => {
  if (!start.publicKey || !start.clientSecret) return 'unavailable'
  const { build, country } = facts
  await initStripe({ publishableKey: start.publicKey, ...(start.accountId ? { stripeAccountId: start.accountId } : {}), urlScheme: build.scheme })
  const ready = await initPaymentSheet({
    merchantDisplayName: facts.storeName || build.appName || ' ',
    paymentIntentClientSecret: start.clientSecret,
    returnURL: `${build.scheme}://stripe-redirect`,
    ...(start.customerId && start.ephemeralKeySecret ? { customerId: start.customerId, customerEphemeralKeySecret: start.ephemeralKeySecret } : {}),
    ...(facts.email ? { defaultBillingDetails: { email: facts.email } } : {}),
    ...(country ? { googlePay: { merchantCountryCode: country, testEnv: start.mode === 'test' }, ...(build.appleMerchantId ? { applePay: { merchantCountryCode: country } } : {}) } : {}),
  })
  if (ready.error) return 'unavailable'
  const { error } = await presentPaymentSheet()
  if (!error) return 'done'
  // Worded by the code, never by Stripe's own sentence.
  return error.code === PaymentSheetError.Canceled ? 'cancelled' : error.code === PaymentSheetError.Timeout ? 'timeout' : 'declined'
}
