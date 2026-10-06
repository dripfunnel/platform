import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { logEvent } from '#core/log'
import { approveConnection, deleteConnection, selectPendingByState } from '#db/scoped/externalConnections'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { hashSessionId, newSessionId } from '#auth/session'
import type { ShopifyApi } from '#integrations/shopify/api'

// hooks.dripfunnel.com/shopify/callback (CATALOG K7): Shopify sends the person back here after they approve the
// app. The state names the pending connection; Shopify's signature and the shop must match it; the code becomes a
// token, sealed, and the person goes back to their portal with a one-time key that only the starter can finish.
export const shopifyCallbackPath = '/shopify/callback'

export interface ShopifyHookDeps {
  sql: postgres.Sql
  api: ShopifyApi
  secrets: SecretBox
  activity: ActivityLog
  now: () => Date
}

const back = (host: string, query: string) => Response.redirect(`https://${host}/products/import?${query}`, 302)
const finishMs = 10 * 60 * 1000
const expired = () => new Response('This link has expired. Go back to your store and connect Shopify again.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export const handleShopifyCallback = async (request: Request, { sql, api, secrets, activity, now }: ShopifyHookDeps): Promise<Response> => {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const query = new URL(request.url).searchParams
  const state = query.get('state') ?? ''
  if (!/^[0-9a-f]{64}$/.test(state)) return expired()
  const pending = await withSystemScope(sql, async (tx) => selectPendingByState(tx, await hashSessionId(state)))
  if (!pending || (pending.expires_at !== null && pending.expires_at < now()) || !pending.return_host) return expired()
  const host = pending.return_host
  // Shopify's answer is logged on the store's activity as the provider's, with what became of the connection (LOGGING §3).
  const record = (tx: ScopedSql, action: 'shopify.callback_rejected' | 'shopify.approved', reason: 'signature' | 'exchange_failed' | null) =>
    activity.record(tx, {
      category: 'system',
      action,
      result: action === 'shopify.approved' ? 'success' : 'failed',
      actorKind: 'provider',
      actorId: 'shopify',
      actorLabel: 'Shopify',
      partnerId: pending.partner_id,
      storeId: pending.store_id,
      sellerId: pending.seller_id,
      target: { type: 'connection', id: pending.id, label: pending.shop_domain },
      reason,
      api: 'system',
      requestId: null,
      ip: null,
      userAgent: null,
      visibility: 'store',
    })
  const forget = (reason: 'signature' | 'exchange_failed') =>
    withSystemScope(sql, async (tx) => {
      await deleteConnection(tx, pending.store_id, pending.seller_id)
      await record(tx, 'shopify.callback_rejected', reason)
    })
  if (!(await api.verifyCallback(query, now())) || query.get('shop') !== pending.shop_domain) {
    await forget('signature')
    return back(host, 'shopify=failed')
  }
  let token: string
  try {
    token = await api.exchange(pending.shop_domain, query.get('code') ?? '')
  } catch {
    logEvent({ event: 'shopify_exchange_failed', api: 'hooks', code: 'unavailable' })
    await forget('exchange_failed')
    return back(host, 'shopify=failed')
  }
  const sealed = await secrets.seal(token)
  const key = newSessionId()
  const approved = await withSystemScope(sql, async (tx) => {
    const done = await approveConnection(tx, pending.id, { tokenSealed: sealed, finishHash: await hashSessionId(key), expiresAt: new Date(now().getTime() + finishMs) })
    if (done) await record(tx, 'shopify.approved', null)
    return done
  })
  return back(host, approved ? `shopify=finish&key=${key}` : 'shopify=failed')
}
