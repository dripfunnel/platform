import type postgres from 'postgres'
import type { SecretBox } from '#auth/secretBox'
import { logEvent } from '#core/log'
import { approveConnection, deleteConnection, selectPendingByState } from '#db/scoped/externalConnections'
import { withSystemScope } from '#db/scoped/index'
import { hashState } from '#engine/modules/catalog/index'
import type { ShopifyApi } from '#integrations/shopify/api'

// hooks.dripfunnel.com/shopify/callback (CATALOG K7): Shopify sends the person back here after they approve the
// app. The state names the pending connection; Shopify's signature and the shop must match it; the code becomes a
// token, sealed, and the person goes back to their portal with a one-time key that only the starter can finish.
export const shopifyCallbackPath = '/shopify/callback'

export interface ShopifyHookDeps {
  sql: postgres.Sql
  api: ShopifyApi
  secrets: SecretBox
  now: () => Date
}

const back = (host: string, query: string) => Response.redirect(`https://${host}/products/import?${query}`, 302)
const finishMs = 10 * 60 * 1000
const expired = () => new Response('This link has expired. Go back to your store and connect Shopify again.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export const handleShopifyCallback = async (request: Request, { sql, api, secrets, now }: ShopifyHookDeps): Promise<Response> => {
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
    return back(host, 'shopify=failed')
  }
  let token: string
  try {
    token = await api.exchange(pending.shop_domain, query.get('code') ?? '')
  } catch {
    logEvent({ event: 'shopify_exchange_failed', api: 'hooks', code: 'unavailable' })
    await forget()
    return back(host, 'shopify=failed')
  }
  const sealed = await secrets.seal(token)
  const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const approved = await withSystemScope(sql, async (tx) => approveConnection(tx, pending.id, { tokenSealed: sealed, finishHash: await hashState(key), expiresAt: new Date(now().getTime() + finishMs) }))
  return back(host, approved ? `shopify=finish&key=${key}` : 'shopify=failed')
}
