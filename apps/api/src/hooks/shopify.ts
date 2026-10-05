import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { logEvent } from '#core/log'
import { completeConnection, deleteConnection, selectPendingByState } from '#db/scoped/externalConnections'
import { withSystemScope } from '#db/scoped/index'
import { hashState, shopifyAudit } from '#engine/modules/catalog/index'
import type { ShopifyApi } from '#integrations/shopify/api'

// hooks.dripfunnel.com/shopify/callback (CATALOG K7): Shopify sends the person back here after they approve the
// app. The state names the pending connection; Shopify's signature and the shop must match it; then the code
// becomes a token, sealed, and the person goes back to the portal they started from.
export const shopifyCallbackPath = '/shopify/callback'

export interface ShopifyHookDeps {
  sql: postgres.Sql
  api: ShopifyApi
  secrets: SecretBox
  activity: ActivityLog
  now: () => Date
}

const back = (host: string, outcome: 'connected' | 'failed') => Response.redirect(`https://${host}/products/import?shopify=${outcome}`, 302)
const expired = () => new Response('This link has expired. Go back to your store and connect Shopify again.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export const handleShopifyCallback = async (request: Request, { sql, api, secrets, activity, now }: ShopifyHookDeps): Promise<Response> => {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const query = new URL(request.url).searchParams
  const state = query.get('state') ?? ''
  if (!/^[0-9a-f]{64}$/.test(state)) return expired()
  const pending = await withSystemScope(sql, async (tx) => selectPendingByState(tx, await hashState(state)))
  if (!pending || (pending.expires_at !== null && pending.expires_at < now()) || !pending.return_host) return expired()
  const host = pending.return_host
  const forget = () => withSystemScope(sql, (tx) => deleteConnection(tx, pending.store_id, pending.seller_id))
  if (!(await api.verifyCallback(query, now())) || query.get('shop') !== pending.shop_domain) {
    await forget()
    return back(host, 'failed')
  }
  let token: string
  try {
    token = await api.exchange(pending.shop_domain, query.get('code') ?? '')
  } catch {
    logEvent({ event: 'shopify_exchange_failed', api: 'hooks', code: 'unavailable' })
    await forget()
    return back(host, 'failed')
  }
  const sealed = await secrets.seal(token)
  const at = now()
  await withSystemScope(sql, async (tx) => {
    if (!(await completeConnection(tx, pending.id, sealed, at))) return
    await activity.record(tx, {
      category: 'write',
      action: shopifyAudit.connected,
      result: 'success',
      actorKind: 'person',
      actorId: pending.connected_by,
      actorLabel: null,
      partnerId: pending.partner_id,
      storeId: pending.store_id,
      sellerId: pending.seller_id,
      target: { type: 'connection', id: pending.id, label: pending.shop_domain },
      reason: null,
      // The person's own approval, finished on Shopify's way back; it reads in their portal's history.
      api: 'store',
      visibility: 'store',
      requestId: request.headers.get('cf-ray'),
      ip: null,
      userAgent: null,
    })
  })
  return back(host, 'connected')
}
