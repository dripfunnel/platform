import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { logEvent } from '#core/log'
import { PaymentUnavailable } from '#core/payments'
import { handleMerchantStripeEvent, type SettleDeps } from '#engine/modules/checkout/index'
import { eventSchema, StripeUnavailable, verifySignature, type StripeApi } from '#integrations/stripe/index'
import { handleStripeEvent, retriedOutcomes } from '#saas/billing/index'

// hooks.dripfunnel.com/stripe (SAAS §7.2; THIRD-PARTY-ACCESS §3.1): signature first, then one event; 503 so it comes
// again. A store's connected account's event is a shopper's payment and never reaches billing.
export const stripeHookPath = '/stripe'

// Stripe's events are a few kilobytes; anything far larger isn't one.
const maxBodyBytes = 256 * 1024

export interface StripeHookDeps {
  sql: postgres.Sql
  stripe: StripeApi
  signingSecret: string
  /** Settles merchants' payments; null where no card adapter is set up, and every event goes to billing. */
  payments: SettleDeps | null
  activity: ActivityLog
  now: () => Date
}

export const handleStripeHook = async (request: Request, { sql, stripe, signingSecret, payments, activity, now }: StripeHookDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return new Response(null, { status: 413 })
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) return new Response(null, { status: 413 })
  if (!(await verifySignature(body, request.headers.get('stripe-signature'), signingSecret, now()))) return new Response(null, { status: 400 })
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return new Response(null, { status: 400 })
  }
  const event = eventSchema.safeParse(json)
  if (!event.success) return new Response(null, { status: 400 })
  const account = event.data.account
  if (payments && account) {
    try {
      const merchant = await handleMerchantStripeEvent(payments, { type: event.data.type, account, objectId: event.data.data.object.id })
      if (merchant) {
        logEvent({ event: 'stripe_merchant_event', api: 'hooks', code: merchant })
        return Response.json({ received: true })
      }
    } catch (error) {
      if (!(error instanceof PaymentUnavailable)) throw error
      logEvent({ event: 'stripe_merchant_event', api: 'hooks', code: 'provider_unavailable' })
      return new Response(null, { status: 503 })
    }
  }
  try {
    const outcome = await handleStripeEvent({ sql, stripe, event: event.data, activity, now })
    logEvent({ event: 'stripe_event', api: 'hooks', code: outcome })
    // Not applied yet: a non-2xx is the only way Stripe sends it again (saas/billing/webhook.ts).
    if (retriedOutcomes.includes(outcome)) return new Response(null, { status: 503 })
    return Response.json({ received: true })
  } catch (error) {
    if (!(error instanceof StripeUnavailable)) throw error
    logEvent({ event: 'stripe_event', api: 'hooks', code: 'provider_unavailable' })
    return new Response(null, { status: 503 })
  }
}
