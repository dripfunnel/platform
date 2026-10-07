import { z } from 'zod'
import { fromDecimalRounded, toMajor } from '#core/money'
import { PaymentRefused, type GatewayAccount, type PaymentGateway, type PaymentMode, type PaymentOutcome } from '#core/payments'
import { callProvider } from './http'

// PayPal on the merchant's own REST app (THIRD-PARTY-ACCESS §3.1): an order approved with PayPal's button, captured when
// read back; webhooks are checked by PayPal itself against the merchant's webhook id.

const baseFor = (mode: PaymentMode) => (mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')

const tokenSchema = z.object({ access_token: z.string().min(1) }).loose()
const money = z.object({ value: z.string(), currency_code: z.string() }).loose()
const orderSchema = z
  .object({
    id: z.string().regex(/^[A-Z0-9]+$/),
    status: z.string(),
    purchase_units: z.array(z.object({ payments: z.object({ captures: z.array(z.object({ id: z.string().optional(), status: z.string(), amount: money }).loose()).optional() }).loose().optional() }).loose()).optional(),
  })
  .loose()
const eventSchema = z
  .object({
    event_type: z.string(),
    resource: z.object({ id: z.string().optional(), supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).loose() }).loose().optional() }).loose(),
  })
  .loose()

export const paypal = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): PaymentGateway => {
  const token = async (account: GatewayAccount) => {
    const { clientId, clientSecret } = account.credentials
    if (!clientId || !clientSecret) throw new PaymentRefused('keys missing')
    const answer = await callProvider(
      fetchImpl,
      `${baseFor(account.mode)}/v1/oauth2/token`,
      { method: 'POST', headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' },
      tokenSchema,
    )
    return `Bearer ${answer.access_token}`
  }

  const captured = (order: z.infer<typeof orderSchema>): PaymentOutcome => {
    const capture = order.purchase_units?.[0]?.payments?.captures?.find((c) => c.status === 'COMPLETED')
    const amount = capture ? fromDecimalRounded(capture.amount.value, capture.amount.currency_code) : null
    return amount ? { state: 'captured', amount } : { state: 'pending' }
  }

  return {
    available: () => true,
    verify: async (account) => {
      await token(account)
    },
    start: async (account, request) => {
      const order = await callProvider(
        fetchImpl,
        `${baseFor(account.mode)}/v2/checkout/orders`,
        {
          method: 'POST',
          headers: { authorization: await token(account), 'content-type': 'application/json', 'paypal-request-id': request.attemptId },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{ reference_id: request.orderId, custom_id: request.attemptId, amount: { currency_code: request.amount.currency, value: toMajor(request.amount) } }],
          }),
        },
        orderSchema,
      )
      return { providerRef: order.id, publicKey: account.credentials['clientId'] ?? null, accountId: null, clientSecret: null, sessionId: null, redirectUrl: null }
    },
    outcome: async (account, providerRef): Promise<PaymentOutcome> => {
      if (!/^[A-Z0-9]{1,40}$/.test(providerRef)) return { state: 'failed' }
      const authorization = await token(account)
      const order = await callProvider(fetchImpl, `${baseFor(account.mode)}/v2/checkout/orders/${providerRef}`, { headers: { authorization } }, orderSchema)
      if (order.status === 'COMPLETED') return captured(order)
      if (order.status === 'VOIDED') return { state: 'failed' }
      if (order.status !== 'APPROVED') return { state: 'pending' }
      // Approved by the shopper: captured now, once. The loser of a race with the webhook is told 422 (already
      // captured), and reads the order again.
      const done = await callProvider(
        fetchImpl,
        `${baseFor(account.mode)}/v2/checkout/orders/${providerRef}/capture`,
        { method: 'POST', headers: { authorization, 'content-type': 'application/json', 'paypal-request-id': `capture-${providerRef}` }, body: '{}' },
        orderSchema.or(z.object({ name: z.string() }).loose()),
        [422],
      )
      if ('status' in done && typeof done.status === 'string') return done.status === 'COMPLETED' ? captured(orderSchema.parse(done)) : { state: 'pending' }
      const again = await callProvider(fetchImpl, `${baseFor(account.mode)}/v2/checkout/orders/${providerRef}`, { headers: { authorization } }, orderSchema)
      return again.status === 'COMPLETED' ? captured(again) : { state: 'pending' }
    },
    // The order's capture gives the money back; PayPal-Request-Id makes the same refund id one refund.
    refund: async (account, providerRef, request) => {
      if (!/^[A-Z0-9]{1,40}$/.test(providerRef)) throw new PaymentRefused('not an order')
      const authorization = await token(account)
      const order = await callProvider(fetchImpl, `${baseFor(account.mode)}/v2/checkout/orders/${providerRef}`, { headers: { authorization } }, orderSchema)
      const capture = order.purchase_units?.[0]?.payments?.captures?.find((c) => c.id && (c.status === 'COMPLETED' || c.status === 'PARTIALLY_REFUNDED'))
      if (!capture?.id) throw new PaymentRefused('nothing captured')
      const refund = await callProvider(
        fetchImpl,
        `${baseFor(account.mode)}/v2/payments/captures/${encodeURIComponent(capture.id)}/refund`,
        {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json', 'paypal-request-id': `refund-${request.refundId}` },
          body: JSON.stringify({ amount: { currency_code: request.amount.currency, value: toMajor(request.amount) }, invoice_id: request.refundId }),
        },
        z.object({ id: z.string(), status: z.string() }).loose(),
      )
      return { providerRef: refund.id, state: refund.status === 'COMPLETED' ? 'done' : refund.status === 'FAILED' || refund.status === 'CANCELLED' ? 'failed' : 'pending' }
    },
    webhook: async (account, delivery) => {
      const webhookId = account.credentials['webhookId']
      if (!webhookId) return { valid: false }
      let event: unknown
      try {
        event = JSON.parse(delivery.body)
      } catch {
        return { valid: false }
      }
      const header = (name: string) => delivery.headers.get(name) ?? ''
      // A delivery without PayPal's headers, or a certificate from anywhere but PayPal, is refused before PayPal is asked.
      const cert = URL.canParse(header('paypal-cert-url')) ? new URL(header('paypal-cert-url')) : null
      const signed = ['paypal-auth-algo', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'].every((h) => header(h) !== '')
      if (!signed || cert?.protocol !== 'https:' || !/(^|\.)paypal\.com$/.test(cert.hostname)) return { valid: false }
      const verdict = await callProvider(
        fetchImpl,
        `${baseFor(account.mode)}/v1/notifications/verify-webhook-signature`,
        {
          method: 'POST',
          headers: { authorization: await token(account), 'content-type': 'application/json' },
          body: JSON.stringify({
            auth_algo: header('paypal-auth-algo'),
            cert_url: header('paypal-cert-url'),
            transmission_id: header('paypal-transmission-id'),
            transmission_sig: header('paypal-transmission-sig'),
            transmission_time: header('paypal-transmission-time'),
            webhook_id: webhookId,
            webhook_event: event,
          }),
        },
        z.object({ verification_status: z.string() }).loose(),
      )
      if (verdict.verification_status !== 'SUCCESS') return { valid: false }
      const parsed = eventSchema.safeParse(event)
      if (!parsed.success) return { valid: true, providerRef: null }
      const { event_type: type, resource } = parsed.data
      const ref = type.startsWith('CHECKOUT.ORDER.') ? resource.id : resource.supplementary_data?.related_ids.order_id
      return { valid: true, providerRef: ref ?? null }
    },
  }
}
