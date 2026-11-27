import { readCapped } from '#core/http'
import { logEvent } from '#core/log'
import { PaymentUnavailable } from '#core/payments'
import { settleFromRazorpayWebhook, type PlanBillingDeps } from '#saas/storeBilling/index'

// hooks.<host>/razorpay/partner/<partner> (#1744; SAAS §7.4): plan payments on the partner's own Razorpay account, signed with
// the webhook secret it gave us. An event only says which charge to read back; 400 for a bad signature, 503 to be sent again.

const pathPattern = /^\/razorpay\/partner\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const maxBodyBytes = 256 * 1024

export const razorpayBillingHookOf = (pathname: string): { partnerId: string } | null => {
  const partnerId = pathPattern.exec(pathname)?.[1]
  return partnerId ? { partnerId } : null
}

export const handleRazorpayBillingHook = async (request: Request, hook: { partnerId: string }, deps: PlanBillingDeps, allow: (key: string) => Promise<boolean>): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  if (!(await allow(`razorpay-billing-hook:${request.headers.get('cf-connecting-ip') ?? 'unknown'}:${hook.partnerId}`))) return new Response(null, { status: 429 })
  const read = await readCapped(request, maxBodyBytes)
  if (!read.ok) return new Response(null, { status: 413 })
  const body = new TextDecoder().decode(read.bytes)
  try {
    const outcome = await settleFromRazorpayWebhook(deps, hook.partnerId, body, request.headers.get('x-razorpay-signature') ?? '')
    logEvent({ event: 'plan_payment_webhook', api: 'hooks', code: outcome })
    // A partner with no keys answers as a bad signature does, so an address can't be probed for whether it exists.
    if (outcome === 'invalid') return new Response(null, { status: 400 })
    return Response.json({ received: true })
  } catch (error) {
    if (!(error instanceof PaymentUnavailable)) throw error
    logEvent({ event: 'plan_payment_webhook', api: 'hooks', code: 'provider_unavailable' })
    return new Response(null, { status: 503 })
  }
}
