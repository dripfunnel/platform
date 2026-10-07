import { z } from 'zod'
import { fromDecimalRounded, toMajor } from '#core/money'
import { PaymentNeedsPhone, PaymentRefused, type GatewayAccount, type PaymentGateway, type PaymentMode, type PaymentOutcome } from '#core/payments'
import { callProvider, hmacBase64, referenceOf, sameText } from './http'

// Cashfree Payment Gateway on the merchant's own app id and secret (THIRD-PARTY-ACCESS §3.1), API version 2023-08-01: an
// order whose payment session Cashfree's checkout opens, read back by its status. Webhooks are signed with the secret key.

const apiVersion = '2023-08-01'
const baseFor = (mode: PaymentMode) => (mode === 'live' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg')
// Cashfree's own window for a webhook's timestamp is not published; five minutes, as Stripe's.
const toleranceMs = 5 * 60 * 1000

const headersOf = (account: GatewayAccount) => {
  const appId = account.credentials['appId']
  const secretKey = account.credentials['secretKey']
  if (!appId || !secretKey) throw new PaymentRefused('keys missing')
  return { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': apiVersion }
}

/** An Indian number as Cashfree takes it, its ten digits; another country's in E.164 as given. */
const phoneFor = (phone: string) => (/^\+91[6-9]\d{9}$/.test(phone) ? phone.slice(3) : phone)

const orderSchema = z.object({ order_id: z.string(), payment_session_id: z.string().min(1) }).loose()
const statusSchema = z.object({ order_status: z.string(), order_amount: z.union([z.number(), z.string()]), order_currency: z.string() }).loose()
const eventSchema = z.object({ data: z.object({ order: z.object({ order_id: z.string() }).loose() }).loose() }).loose()

export const cashfree = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): PaymentGateway => ({
  available: () => true,
  verify: async (account) => {
    // An order that can't exist: Cashfree answers 404 to keys it takes and 401 to keys it doesn't.
    await callProvider(fetchImpl, `${baseFor(account.mode)}/orders/df_key_check`, { headers: headersOf(account) }, z.unknown(), [404])
  },
  start: async (account, request) => {
    if (!request.customer.phone) throw new PaymentNeedsPhone('cashfree needs a phone')
    const reference = referenceOf(request.attemptId)
    const amountToken = `df-amount-${request.attemptId}`
    const order = await callProvider(
      fetchImpl,
      `${baseFor(account.mode)}/orders`,
      {
        method: 'POST',
        headers: { ...headersOf(account), 'content-type': 'application/json', 'x-idempotency-key': request.attemptId },
        // The amount goes as its exact decimal, never through a float (AGENTS "Data").
        body: JSON.stringify({
          order_id: reference,
          order_amount: amountToken,
          order_currency: request.amount.currency,
          customer_details: { customer_id: reference, customer_phone: phoneFor(request.customer.phone), ...(request.customer.email ? { customer_email: request.customer.email } : {}) },
          order_meta: { return_url: request.returnUrl },
          order_tags: { df_order_id: request.orderId },
        }).replace(`"${amountToken}"`, toMajor(request.amount)),
      },
      orderSchema,
    )
    return { providerRef: order.order_id, publicKey: null, accountId: null, clientSecret: null, sessionId: order.payment_session_id, redirectUrl: null }
  },
  outcome: async (account, providerRef): Promise<PaymentOutcome> => {
    if (!/^df_[0-9a-f]{32}$/.test(providerRef)) return { state: 'failed' }
    const order = await callProvider(fetchImpl, `${baseFor(account.mode)}/orders/${providerRef}`, { headers: headersOf(account) }, statusSchema)
    if (order.order_status === 'PAID') {
      const amount = fromDecimalRounded(String(order.order_amount), order.order_currency)
      return amount ? { state: 'captured', amount } : { state: 'pending' }
    }
    return order.order_status === 'EXPIRED' || order.order_status === 'TERMINATED' ? { state: 'failed' } : { state: 'pending' }
  },
  // Our refund id is Cashfree's, so a second call with it is the same refund; the amount as its exact decimal.
  refund: async (account, providerRef, request) => {
    if (!/^df_[0-9a-f]{32}$/.test(providerRef)) throw new PaymentRefused('not our order')
    const reference = referenceOf(request.refundId)
    const amountToken = `df-amount-${request.refundId}`
    const refund = await callProvider(
      fetchImpl,
      `${baseFor(account.mode)}/orders/${providerRef}/refunds`,
      {
        method: 'POST',
        headers: { ...headersOf(account), 'content-type': 'application/json', 'x-idempotency-key': request.refundId },
        body: JSON.stringify({ refund_id: reference, refund_amount: amountToken }).replace(`"${amountToken}"`, toMajor(request.amount)),
      },
      z.object({ refund_status: z.string() }).loose(),
    )
    return { providerRef: reference, state: refund.refund_status === 'SUCCESS' ? 'done' : refund.refund_status === 'CANCELLED' ? 'failed' : 'pending' }
  },
  webhook: async (account, delivery) => {
    const secret = account.credentials['secretKey']
    const timestamp = delivery.headers.get('x-webhook-timestamp') ?? ''
    const signature = delivery.headers.get('x-webhook-signature') ?? ''
    if (!secret || !/^\d{10,13}$/.test(timestamp)) return { valid: false }
    const at = Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1)
    if (Math.abs(delivery.now.getTime() - at) > toleranceMs) return { valid: false }
    if (!sameText(await hmacBase64(secret, timestamp + delivery.body), signature)) return { valid: false }
    let json: unknown
    try {
      json = JSON.parse(delivery.body)
    } catch {
      return { valid: false }
    }
    const event = eventSchema.safeParse(json)
    return { valid: true, providerRef: event.success ? event.data.data.order.order_id : null }
  },
})
