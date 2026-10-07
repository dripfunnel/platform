import { z } from 'zod'
import { PaymentRefused, type GatewayAccount, type PaymentGateway, type PaymentOutcome } from '#core/payments'
import { callProvider, hmacHex, referenceOf, sameText } from './http'

// Razorpay on the merchant's own keys (THIRD-PARTY-ACCESS §3.1): an Order made for the amount, opened by Razorpay's
// checkout with the key id, and read back by its payments. Webhooks are signed with the secret the merchant sets there.

const apiBase = 'https://api.razorpay.com/v1'

const keysOf = (account: GatewayAccount) => {
  const keyId = account.credentials['keyId']
  const keySecret = account.credentials['keySecret']
  if (!keyId || !keySecret) throw new PaymentRefused('keys missing')
  return { keyId, authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` }
}

const orderSchema = z.object({ id: z.string().regex(/^order_[A-Za-z0-9]+$/) }).loose()
const paymentsSchema = z.object({ items: z.array(z.object({ id: z.string(), status: z.string(), amount: z.number().int().nonnegative(), currency: z.string() }).loose()) }).loose()
const eventSchema = z
  .object({
    event: z.string(),
    payload: z
      .object({
        order: z.object({ entity: z.object({ id: z.string() }).loose() }).loose().optional(),
        payment: z.object({ entity: z.object({ order_id: z.string().nullish() }).loose() }).loose().optional(),
      })
      .loose(),
  })
  .loose()

export const razorpay = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): PaymentGateway => ({
  available: () => true,
  verify: async (account) => {
    const { authorization } = keysOf(account)
    await callProvider(fetchImpl, `${apiBase}/orders?count=1`, { headers: { authorization } }, z.unknown())
  },
  start: async (account, request) => {
    const { keyId, authorization } = keysOf(account)
    const order = await callProvider(
      fetchImpl,
      `${apiBase}/orders`,
      {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ amount: Number(request.amount.amount), currency: request.amount.currency, receipt: referenceOf(request.attemptId), notes: { df_order_id: request.orderId, df_payment_id: request.attemptId } }),
      },
      orderSchema,
    )
    return { providerRef: order.id, publicKey: keyId, accountId: null, clientSecret: null, sessionId: null, redirectUrl: null }
  },
  outcome: async (account, providerRef): Promise<PaymentOutcome> => {
    if (!/^order_[A-Za-z0-9]+$/.test(providerRef)) return { state: 'failed' }
    const { authorization } = keysOf(account)
    const { items } = await callProvider(fetchImpl, `${apiBase}/orders/${providerRef}/payments`, { headers: { authorization } }, paymentsSchema)
    const captured = items.find((p) => p.status === 'captured')
    if (captured) return { state: 'captured', amount: { amount: BigInt(captured.amount), currency: captured.currency.toUpperCase() } }
    // An account without automatic capture leaves the payment authorised: capture it, as the shopper has paid.
    const authorised = items.find((p) => p.status === 'authorized')
    if (authorised) {
      const done = await callProvider(
        fetchImpl,
        `${apiBase}/payments/${encodeURIComponent(authorised.id)}/capture`,
        { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ amount: authorised.amount, currency: authorised.currency }) },
        z.object({ status: z.string(), amount: z.number().int(), currency: z.string() }).loose(),
      )
      if (done.status === 'captured') return { state: 'captured', amount: { amount: BigInt(done.amount), currency: done.currency.toUpperCase() } }
    }
    // A failed attempt leaves the order open for another in Razorpay's checkout.
    return { state: 'pending' }
  },
  // The order's captured payment gives the money back; Razorpay answers processed, pending (most) or failed.
  refund: async (account, providerRef, request) => {
    if (!/^order_[A-Za-z0-9]+$/.test(providerRef)) throw new PaymentRefused('not an order')
    const { authorization } = keysOf(account)
    const { items } = await callProvider(fetchImpl, `${apiBase}/orders/${providerRef}/payments`, { headers: { authorization } }, paymentsSchema)
    const paid = items.find((p) => p.status === 'captured' || p.status === 'refunded')
    if (!paid) throw new PaymentRefused('nothing captured')
    const refund = await callProvider(
      fetchImpl,
      `${apiBase}/payments/${encodeURIComponent(paid.id)}/refund`,
      { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ amount: Number(request.amount.amount), receipt: referenceOf(request.refundId), notes: { df_refund_id: request.refundId } }) },
      z.object({ id: z.string(), status: z.string() }).loose(),
    )
    return { providerRef: refund.id, state: refund.status === 'processed' ? 'done' : refund.status === 'failed' ? 'failed' : 'pending' }
  },
  webhook: async (account, delivery) => {
    const secret = account.credentials['webhookSecret']
    const signature = delivery.headers.get('x-razorpay-signature') ?? ''
    if (!secret || !sameText(await hmacHex(secret, delivery.body), signature)) return { valid: false }
    let json: unknown
    try {
      json = JSON.parse(delivery.body)
    } catch {
      return { valid: false }
    }
    const event = eventSchema.safeParse(json)
    if (!event.success) return { valid: true, providerRef: null }
    return { valid: true, providerRef: event.data.payload.order?.entity.id ?? event.data.payload.payment?.entity.order_id ?? null }
  },
})
