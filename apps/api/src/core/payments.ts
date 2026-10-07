import type { Money } from './money'

// The one contract every card provider's adapter keeps (THIRD-PARTY-ACCESS §3.1; PLATFORM-PROMPT §5.4 Payments): the
// merchant's own account, a payment started for a placed order, and its outcome read back from the provider.

export const cardProviders = ['stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe'] as const
export type CardProvider = (typeof cardProviders)[number]
export const isCardProvider = (p: string): p is CardProvider => cardProviders.some((c) => c === p)

/** Test on a preview storefront, live everywhere else (storefront ARCHITECTURE §4.1). */
export type PaymentMode = 'test' | 'live'

/**
 * The merchant's account as an adapter acts with it: Stripe's connected id, or the store's pasted keys opened for the call
 * (the webhook's secret among them as `webhookSecret`).
 */
export interface GatewayAccount {
  mode: PaymentMode
  externalAccountId: string | null
  credentials: Readonly<Record<string, string>>
}

export interface PaymentRequest {
  /** Our payment row's id: the provider's idempotency key and its reference to us. */
  attemptId: string
  orderId: string
  amount: Money
  customer: { email: string | null; phone: string | null }
  /** Where a provider that takes the shopper away sends them back. */
  returnUrl: string
}

/** What the storefront needs to take the payment; which parts are set depends on the provider. */
export interface PaymentStart {
  /** The provider's own id for this payment, read back by `outcome`. */
  providerRef: string
  publicKey: string | null
  /** Stripe: the connected account the card field acts on. */
  accountId: string | null
  /** Stripe: the PaymentIntent's client secret. */
  clientSecret: string | null
  /** Cashfree: the payment session. */
  sessionId: string | null
  /** PhonePe: the page the shopper pays on. */
  redirectUrl: string | null
}

export type PaymentOutcome = { state: 'captured'; amount: Money } | { state: 'pending' } | { state: 'failed' }

/** A webhook as it arrived on the store's own address (hooks/payments.ts), before anything trusts it. */
export interface WebhookDelivery {
  body: string
  headers: Headers
  now: Date
}

/** Not the provider's (refused 400), or the payment it is about (null for an event about none). */
export type WebhookReading = { valid: false } | { valid: true; providerRef: string | null }

export interface PaymentGateway {
  /** Whether payments can be taken in this mode here: Stripe needs the platform's keys for it. */
  available: (mode: PaymentMode) => boolean
  /** Pasted keys tried once before they are saved; throws PaymentRefused for keys the provider refuses. */
  verify?: (account: GatewayAccount) => Promise<void>
  /** Checks a webhook's signature with the store's own secret; a webhook only says which payment to read back. */
  webhook?: (account: GatewayAccount, delivery: WebhookDelivery) => Promise<WebhookReading>
  start: (account: GatewayAccount, request: PaymentRequest) => Promise<PaymentStart>
  /** The payment as the provider has it now; a webhook only says when to look (saas/billing/webhook.ts does the same). */
  outcome: (account: GatewayAccount, providerRef: string) => Promise<PaymentOutcome>
}

export type PaymentGateways = Partial<Record<CardProvider, PaymentGateway>>

/** No answer in time, throttled, or the provider failed itself: the shopper tries again. */
export class PaymentUnavailable extends Error {
  override name = 'PaymentUnavailable'
}

/** The provider takes no payment without the shopper's mobile number (Cashfree): checkout asks for one. */
export class PaymentNeedsPhone extends Error {
  override name = 'PaymentNeedsPhone'
}

/** The provider refused the merchant's account or keys: Payment setup needs fixing, not the cart. */
export class PaymentRefused extends Error {
  override name = 'PaymentRefused'
}

export const paymentTimeoutMs = 10_000

/** Connect OAuth (Stripe Connect Standard): the merchant approves on the provider, which returns to the hooks host. */
export interface OAuthConnect {
  authorizeUrl: (state: string) => string
  /** The approved account's id. */
  exchange: (code: string) => Promise<{ accountId: string; livemode: boolean }>
  /** Ends the platform's access, as Disconnect asks. */
  deauthorize: (accountId: string) => Promise<void>
}
