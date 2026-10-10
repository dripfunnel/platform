import type { CourierAccountKind, CourierDirectory } from '#core/couriers'
import { readCapped } from '#core/http'
import { isUuid } from '#core/ids'
import { logEvent } from '#core/log'
import { applyTracking, type TrackingDeps } from '#engine/modules/orders/index'

// hooks.<host>/couriers/<shiprocket|easypost>/<partner> (THIRD-PARTY-ACCESS §3.2, §4): one address per partner account,
// as each signs with the partner's own secret; 400 for a bad signature, 503 so the courier sends it again.

const pathPattern = /^\/couriers\/(shiprocket|easypost)\/([0-9a-f-]{36})$/
const maxBodyBytes = 64 * 1024

export const courierHookOf = (pathname: string): { account: CourierAccountKind; partnerId: string } | null => {
  const match = pathPattern.exec(pathname)
  const account = match?.[1]
  const partnerId = match?.[2]
  return (account === 'shiprocket' || account === 'easypost') && partnerId && isUuid(partnerId) ? { account, partnerId } : null
}

export const handleCourierHook = async (
  request: Request,
  hook: NonNullable<ReturnType<typeof courierHookOf>>,
  deps: TrackingDeps & { couriers: CourierDirectory | null },
  allow: (key: string) => Promise<boolean>,
): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  // Per sender and partner before the proof: junk can't use up a partner's own allowance, and since each courier sends
  // every partner's hooks from shared addresses, one partner's burst can't refuse another's.
  if (!(await allow(`courier-hook-ip:${request.headers.get('cf-connecting-ip') ?? 'unknown'}:${hook.partnerId}`))) return new Response(null, { status: 429 })
  const read = await readCapped(request, maxBodyBytes)
  if (!read.ok) return new Response(null, { status: 413 })
  // No account, a partner that doesn't exist and a bad signature all answer alike, so the address can't be probed.
  const gateway = deps.couriers ? (await deps.couriers.forPartner(hook.partnerId)).gateway : null
  const events = gateway ? await gateway.readHook(hook.account, { body: new TextDecoder().decode(read.bytes), headers: request.headers }) : null
  if (!events) {
    logEvent({ event: 'courier_webhook', api: 'hooks', partnerId: hook.partnerId, code: `${hook.account}:invalid` })
    return new Response(null, { status: 400 })
  }
  if (!(await allow(`courier-hook:${hook.partnerId}`))) return new Response(null, { status: 429 })
  const applied = await applyTracking(deps, hook.partnerId, hook.account, events)
  logEvent({ event: 'courier_webhook', api: 'hooks', partnerId: hook.partnerId, code: `${hook.account}:received`, count: applied })
  return Response.json({ received: true })
}
