import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { eventSchema, StripeUnavailable, verifySignature, type StripeApi } from '#integrations/stripe/index'
import { handleStripeEvent } from '#saas/billing/index'

// hooks.dripfunnel.com/stripe (SAAS §7.2; #201): signature first, then one event, answered 200
// once it is recorded (or was already), 503 when Stripe couldn't be read back so it comes again.
export const stripeHookPath = '/stripe'

// Stripe's events are a few kilobytes; anything far larger isn't one.
const maxBodyBytes = 256 * 1024

export interface StripeHookDeps {
  sql: postgres.Sql
  stripe: StripeApi
  signingSecret: string
  now: () => Date
}

export const handleStripeHook = async (request: Request, { sql, stripe, signingSecret, now }: StripeHookDeps): Promise<Response> => {
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
  try {
    const outcome = await handleStripeEvent({ sql, stripe, event: event.data, now })
    logEvent({ event: 'stripe_event', api: 'hooks', code: outcome })
    return Response.json({ received: true })
  } catch (error) {
    if (!(error instanceof StripeUnavailable)) throw error
    logEvent({ event: 'stripe_event', api: 'hooks', code: 'provider_unavailable' })
    return new Response(null, { status: 503 })
  }
}
