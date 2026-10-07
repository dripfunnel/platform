import { logEvent } from '#core/log'
import { isCardProvider, PaymentUnavailable } from '#core/payments'
import { settleFromWebhook, type SettleDeps } from '#engine/modules/checkout/index'

// hooks.<host>/payments/<provider>/<account> (THIRD-PARTY-ACCESS §3.1): the address Payment setup gives a merchant for
// Razorpay's, Cashfree's, PhonePe's or PayPal's webhooks, one per connected account, as each signs with the merchant's own
// secret. Answered 200 once handled or not ours, 400 for a bad signature, 503 so the provider sends it again.

const pathPattern = /^\/payments\/(razorpay|cashfree|phonepe|paypal)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const maxBodyBytes = 256 * 1024

export const paymentHookOf = (pathname: string): { provider: 'razorpay' | 'cashfree' | 'phonepe' | 'paypal'; accountId: string } | null => {
  const match = pathPattern.exec(pathname)
  const provider = match?.[1]
  const accountId = match?.[2]
  return provider && accountId && isCardProvider(provider) && provider !== 'stripe' ? { provider, accountId } : null
}

export const handlePaymentHook = async (request: Request, hook: NonNullable<ReturnType<typeof paymentHookOf>>, deps: SettleDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return new Response(null, { status: 413 })
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) return new Response(null, { status: 413 })
  try {
    const outcome = await settleFromWebhook(deps, hook.provider, hook.accountId, { body, headers: request.headers, now: deps.now() })
    logEvent({ event: 'payment_webhook', api: 'hooks', code: `${hook.provider}:${outcome}` })
    if (outcome === 'unknown') return new Response(null, { status: 404 })
    if (outcome === 'invalid') return new Response(null, { status: 400 })
    return Response.json({ received: true })
  } catch (error) {
    if (!(error instanceof PaymentUnavailable)) throw error
    logEvent({ event: 'payment_webhook', api: 'hooks', code: `${hook.provider}:provider_unavailable` })
    return new Response(null, { status: 503 })
  }
}
