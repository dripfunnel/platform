import type { AssetStore } from '#engine/modules/catalog/index'
import type { ShopContext } from './access'
import { catalogOf, shopAssetPath } from './catalog'

// `GET /shop-api/assets/{id}`: a file a storefront shows, only while what shows it is visible (migration 0064's policy).

export const isShopAssetPath = (pathname: string): boolean => pathname.startsWith(`${shopAssetPath}/`)

export const handleShopAsset = async (request: Request, ctx: ShopContext, store: AssetStore | null): Promise<Response> => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  if (!ctx.sql || !ctx.shopper?.available || !store) return new Response(null, { status: 404 })
  const id = new URL(request.url).pathname.slice(shopAssetPath.length + 1)
  // Another store's file, a hidden product's and an invoice are "not found", like one that never was (ACCESS §11).
  const row = await catalogOf(ctx).asset(id)
  const object = row ? await store.get(row.r2_key) : null
  if (!row || !object) return new Response(null, { status: 404 })
  return new Response(object.body, {
    headers: { 'content-type': row.mime, 'content-length': String(row.bytes), 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
  })
}
