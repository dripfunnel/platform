import type { AppPayment } from '../../../api/cart'
import { appPaymentFor, isSheetProvider, paymentBuild } from './env'
import { stripeApiVersion } from './stripe'

/** What `placeOrder` and `payOrder` take of the app for this way to pay: undefined for cash on delivery and bank transfer. */
export const appPaymentInput = (provider: string): AppPayment | undefined => (isSheetProvider(provider) ? appPaymentFor(provider, paymentBuild(), stripeApiVersion) : undefined)
