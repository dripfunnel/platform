import type { CourierAccountKind, CourierDirectory } from '#core/couriers'
import { readCapped } from '#core/http'
import { isUuid } from '#core/ids'
import { logEvent } from '#core/log'
import { selectStorePartner } from '#db/scoped/courierAccounts'
import { withSystemScope } from '#db/scoped/index'
import { applyTracking, type TrackingDeps } from '#engine/modules/orders/index'

// hooks.<host>/couriers/<shiprocket|easypost>/<store> (THIRD-PARTY-ACCESS §3.2, §4): one address per store login, as each
// signs with that store's own token (#1489); 400 for a bad proof, and any failure of ours answers 5xx, which both resend.

const pathPattern = /^\/couriers\/(shiprocket|easypost)\/([0-9a-f-]{36})$/
const maxBodyBytes = 64 * 1024

export const courierHookOf = (pathname: string): { account: CourierAccountKind; storeId: string } | null => {
  const match = pathPattern.exec(pathname)
  const account = match?.[1]
  const storeId = match?.[2]
  return (account === 'shiprocket' || account === 'easypost') && storeId && isUuid(storeId) ? { account, storeId } : null
}

export const handleCourierHook = async (
  request: Request,
  hook: NonNullable<ReturnType<typeof courierHookOf>>,
  deps: TrackingDeps & { couriers: CourierDirectory | null },
  allow: (key: string) => Promise<boolean>,
): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  // Per sender and store before the proof: junk can't use up a store's own allowance, and since each courier sends
  // every store's hooks from shared addresses, one store's burst can't refuse another's.
  if (!(await allow(`courier-hook-ip:${request.headers.get('cf-connecting-ip') ?? 'unknown'}:${hook.storeId}`))) return new Response(null, { status: 429 })
  const read = await readCapped(request, maxBodyBytes)
  if (!read.ok) return new Response(null, { status: 413 })
  // No login, a store that doesn't exist and a bad signature all answer alike, so the address can't be probed.
  const gateway = deps.couriers ? (await deps.couriers.forStore(hook.storeId)).gateway : null
  const events = gateway ? await gateway.readHook(hook.account, { body: new TextDecoder().decode(read.bytes), headers: request.headers }) : null
  const partnerId = events ? await withSystemScope(deps.sql, (tx) => selectStorePartner(tx, hook.storeId)) : null
  if (!events || !partnerId) {
    logEvent({ event: 'courier_webhook', api: 'hooks', storeId: hook.storeId, code: `${hook.account}:invalid` })
    return new Response(null, { status: 400 })
  }
  if (!(await allow(`courier-hook:${hook.storeId}`))) return new Response(null, { status: 429 })
  const applied = await applyTracking(deps, { partnerId, storeId: hook.storeId }, hook.account, events)
  logEvent({ event: 'courier_webhook', api: 'hooks', partnerId, storeId: hook.storeId, code: `${hook.account}:received`, count: applied })
  return Response.json({ received: true })
}
