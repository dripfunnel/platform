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
    purchase_units: z.array(z.object({ payments: z.object({ captures: z.array(z.object({ status: z.string(), amount: money }).loose()).optional() }).loose().optional() }).loose()).optional(),
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
      // Approved by the shopper: captured now, once, whichever of the return and the webhook asks first.
      const done = await callProvider(
        fetchImpl,
        `${baseFor(account.mode)}/v2/checkout/orders/${providerRef}/capture`,
        { method: 'POST', headers: { authorization, 'content-type': 'application/json', 'paypal-request-id': `capture-${providerRef}` }, body: '{}' },
        orderSchema,
        [422],
      )
      return done.status === 'COMPLETED' ? captured(done) : { state: 'pending' }
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
