import { readCapped } from '#core/http'
import { logEvent } from '#core/log'
import { isCardProvider, PaymentUnavailable } from '#core/payments'
import { settleFromWebhook, type SettleDeps } from '#engine/modules/checkout/index'

// hooks.<host>/payments/<provider>/<account> (THIRD-PARTY-ACCESS §3.1): one address per connected account, as each signs
// with the merchant's own secret; 400 for a bad signature, 503 so the provider sends it again.

const pathPattern = /^\/payments\/(razorpay|cashfree|phonepe|paypal)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const maxBodyBytes = 256 * 1024

export const paymentHookOf = (pathname: string): { provider: 'razorpay' | 'cashfree' | 'phonepe' | 'paypal'; accountId: string } | null => {
  const match = pathPattern.exec(pathname)
  const provider = match?.[1]
  const accountId = match?.[2]
  return provider && accountId && isCardProvider(provider) && provider !== 'stripe' ? { provider, accountId } : null
}

export const handlePaymentHook = async (request: Request, hook: NonNullable<ReturnType<typeof paymentHookOf>>, deps: SettleDeps, allow: (key: string) => Promise<boolean>): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  // Per account, before anything is opened or any provider asked (a public address).
  if (!(await allow(`payments-hook:${hook.accountId}`))) return new Response(null, { status: 429 })
  // Read no further than the cap, whatever length it claims or none.
  const read = await readCapped(request, maxBodyBytes)
  if (!read.ok) return new Response(null, { status: 413 })
  const body = new TextDecoder().decode(read.bytes)
  try {
    const outcome = await settleFromWebhook(deps, hook.provider, hook.accountId, { body, headers: request.headers, now: deps.now() })
    logEvent({ event: 'payment_webhook', api: 'hooks', code: `${hook.provider}:${outcome}` })
    // An unknown account answers as a bad signature does, so an address can't be probed for whether it exists.
    if (outcome === 'unknown' || outcome === 'invalid') return new Response(null, { status: 400 })
    return Response.json({ received: true })
  } catch (error) {
    if (!(error instanceof PaymentUnavailable)) throw error
    logEvent({ event: 'payment_webhook', api: 'hooks', code: `${hook.provider}:provider_unavailable` })
    return new Response(null, { status: 503 })
  }
}
