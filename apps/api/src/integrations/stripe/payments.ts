import { z } from 'zod'
import { PaymentRefused, PaymentUnavailable, type PaymentGateway, type PaymentMode, type PaymentOutcome } from '#core/payments'
import { stripeTimeoutMs } from './api'

// A shopper's card payment on the merchant's connected Stripe account (THIRD-PARTY-ACCESS §3.1): a PaymentIntent made
// with the platform's key in the checkout's mode, confirmed in the browser by Stripe's own field, and read back here.

const apiBase = 'https://api.stripe.com/v1'

export interface StripeKeys {
  secretKey: string
  publishableKey: string
}

const intentSchema = z
  .object({
    id: z.string().regex(/^pi_[A-Za-z0-9]+$/),
    status: z.string(),
    amount: z.number().int().nonnegative(),
    amount_received: z.number().int().nonnegative().nullish(),
    currency: z.string(),
    client_secret: z.string().nullish(),
  })
  .loose()

const refundSchema = z.object({ id: z.string().regex(/^re_[A-Za-z0-9]+$/), status: z.string() }).loose()

export const stripePayments = ({ keys, fetchImpl = fetch }: { keys: Partial<Record<PaymentMode, StripeKeys>>; fetchImpl?: typeof fetch }): PaymentGateway => {
  const call = async <S extends z.ZodType = typeof intentSchema>(mode: PaymentMode, accountId: string, method: 'GET' | 'POST', path: string, opts: { body?: URLSearchParams; idempotencyKey?: string } = {}, schema?: S) => {
    const key = keys[mode]
    if (!key) throw new PaymentUnavailable(`no ${mode} key`)
    let response: Response
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key.secretKey}`,
          'stripe-account': accountId,
          ...(opts.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        },
        ...(opts.body ? { body: opts.body.toString() } : {}),
        signal: AbortSignal.timeout(stripeTimeoutMs),
      })
    } catch {
      throw new PaymentUnavailable('no answer')
    }
    if (response.status >= 500 || response.status === 429) throw new PaymentUnavailable(`answered ${response.status}`)
    // The connected account was disconnected or never granted this mode.
    if (response.status === 401 || response.status === 403) throw new PaymentRefused(`answered ${response.status}`)
    const json: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new PaymentRefused(`answered ${response.status}`)
    const parsed = (schema ?? intentSchema).safeParse(json)
    if (!parsed.success) throw new PaymentUnavailable('answered in a shape we do not read')
    return { intent: parsed.data as z.infer<S>, key }
  }

  const accountOf = (externalAccountId: string | null) => {
    if (!externalAccountId) throw new PaymentRefused('no connected account')
    return externalAccountId
  }

  return {
    available: (mode) => keys[mode] !== undefined,
    start: async (account, request) => {
      const accountId = accountOf(account.externalAccountId)
      const body = new URLSearchParams({
        amount: request.amount.amount.toString(),
        currency: request.amount.currency.toLowerCase(),
        'automatic_payment_methods[enabled]': 'true',
        'metadata[df_order_id]': request.orderId,
        'metadata[df_payment_id]': request.attemptId,
      })
      if (request.customer.email) body.set('receipt_email', request.customer.email)
      const { intent, key } = await call(account.mode, accountId, 'POST', '/payment_intents', { body, idempotencyKey: `df-payment:${request.attemptId}` }, intentSchema)
      if (!intent.client_secret) throw new PaymentUnavailable('no client secret')
      return { providerRef: intent.id, publicKey: key.publishableKey, accountId, clientSecret: intent.client_secret, sessionId: null, redirectUrl: null }
    },
    cancel: async (account, providerRef) => {
      if (!/^pi_[A-Za-z0-9]+$/.test(providerRef)) return
      // Stripe refuses to cancel a succeeded intent (400), which the caller reads as paid.
      await call(account.mode, accountOf(account.externalAccountId), 'POST', `/payment_intents/${providerRef}/cancel`, { body: new URLSearchParams(), idempotencyKey: `df-cancel:${providerRef}` })
    },
    outcome: async (account, providerRef): Promise<PaymentOutcome> => {
      if (!/^pi_[A-Za-z0-9]+$/.test(providerRef)) return { state: 'failed' }
      const { intent } = await call(account.mode, accountOf(account.externalAccountId), 'GET', `/payment_intents/${providerRef}`, {}, intentSchema)
      if (intent.status === 'succeeded') return { state: 'captured', amount: { amount: BigInt(intent.amount_received ?? intent.amount), currency: intent.currency.toUpperCase() } }
      // A declined card leaves the intent waiting for another, which the shopper may still give.
      return intent.status === 'canceled' ? { state: 'failed' } : { state: 'pending' }
    },
    refund: async (account, providerRef, request) => {
      if (!/^pi_[A-Za-z0-9]+$/.test(providerRef)) throw new PaymentRefused('not a payment intent')
      const body = new URLSearchParams({ payment_intent: providerRef, amount: request.amount.amount.toString(), 'metadata[df_refund_id]': request.refundId })
      const { intent: refund } = await call(account.mode, accountOf(account.externalAccountId), 'POST', '/refunds', { body, idempotencyKey: `df-refund:${request.refundId}` }, refundSchema)
      // succeeded, or pending / requires_action until the bank answers; failed and canceled never reach the shopper.
      return { providerRef: refund.id, state: refund.status === 'succeeded' ? 'done' : refund.status === 'failed' || refund.status === 'canceled' ? 'failed' : 'pending' }
    },
  }
}
