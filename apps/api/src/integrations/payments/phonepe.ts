import { z } from 'zod'
import { PaymentRefused, type GatewayAccount, type PaymentGateway, type PaymentMode, type PaymentOutcome } from '#core/payments'
import { callProvider, referenceOf, sameText, sha256Hex } from './http'

// PhonePe on its current PG API only (THIRD-PARTY-ACCESS §3.1, decided on #309): a token, a payment page the shopper is
// sent to, its status read back; webhooks carry the SHA-256 of the merchant's username and password.

const hosts = {
  live: { auth: 'https://api.phonepe.com/apis/identity-manager', pg: 'https://api.phonepe.com/apis/pg' },
  test: { auth: 'https://api-preprod.phonepe.com/apis/pg-sandbox', pg: 'https://api-preprod.phonepe.com/apis/pg-sandbox' },
} as const satisfies Record<PaymentMode, { auth: string; pg: string }>
// How long the shopper has on PhonePe's page, in seconds.
const expireAfter = 1200

const tokenSchema = z.object({ access_token: z.string().min(1) }).loose()
const payment = z.object({ orderId: z.string(), redirectUrl: z.string().url() }).loose()
const statusSchema = z.object({ state: z.string(), amount: z.number().int().nonnegative() }).loose()
const eventSchema = z.object({ payload: z.object({ merchantOrderId: z.string() }).loose() }).loose()

export const phonepe = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): PaymentGateway => {
  const token = async (account: GatewayAccount) => {
    const { clientId, clientSecret, clientVersion } = account.credentials
    if (!clientId || !clientSecret || !clientVersion) throw new PaymentRefused('keys missing')
    const body = new URLSearchParams({ client_id: clientId, client_version: clientVersion, client_secret: clientSecret, grant_type: 'client_credentials' })
    const answer = await callProvider(fetchImpl, `${hosts[account.mode].auth}/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, tokenSchema)
    return `O-Bearer ${answer.access_token}`
  }

  return {
    available: () => true,
    verify: async (account) => {
      await token(account)
    },
    start: async (account, request) => {
      // PhonePe takes rupees only; another currency is a set-up the store can't use here.
      if (request.amount.currency !== 'INR') throw new PaymentRefused('INR only')
      const reference = referenceOf(request.attemptId)
      const started = await callProvider(
        fetchImpl,
        `${hosts[account.mode].pg}/checkout/v2/pay`,
        {
          method: 'POST',
          headers: { authorization: await token(account), 'content-type': 'application/json' },
          body: JSON.stringify({
            merchantOrderId: reference,
            amount: Number(request.amount.amount),
            expireAfter,
            metaInfo: { udf1: request.orderId },
            paymentFlow: { type: 'PG_CHECKOUT', merchantUrls: { redirectUrl: request.returnUrl } },
          }),
        },
        payment,
      )
      return { providerRef: reference, publicKey: null, accountId: null, clientSecret: null, sessionId: null, redirectUrl: started.redirectUrl }
    },
    outcome: async (account, providerRef): Promise<PaymentOutcome> => {
      if (!/^df_[0-9a-f]{32}$/.test(providerRef)) return { state: 'failed' }
      const status = await callProvider(fetchImpl, `${hosts[account.mode].pg}/checkout/v2/order/${providerRef}/status`, { headers: { authorization: await token(account) } }, statusSchema)
      if (status.state === 'COMPLETED') return { state: 'captured', amount: { amount: BigInt(status.amount), currency: 'INR' } }
      return status.state === 'FAILED' ? { state: 'failed' } : { state: 'pending' }
    },
    webhook: async (account, delivery) => {
      const { webhookUsername, webhookPassword } = account.credentials
      if (!webhookUsername || !webhookPassword) return { valid: false }
      const sent = (delivery.headers.get('authorization') ?? '').replace(/^SHA256\s*/i, '').toLowerCase()
      if (!sameText(await sha256Hex(`${webhookUsername}:${webhookPassword}`), sent)) return { valid: false }
      let json: unknown
      try {
        json = JSON.parse(delivery.body)
      } catch {
        return { valid: false }
      }
      const event = eventSchema.safeParse(json)
      return { valid: true, providerRef: event.success ? event.data.payload.merchantOrderId : null }
    },
  }
}
