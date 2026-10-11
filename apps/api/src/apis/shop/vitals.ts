import { recordBeacon, vitalsBeacon } from '#saas/storefronts/index'
import type { ShopContext } from './access'

// `POST /shop-api/vitals`: one page view's Core Web Vitals from core's reporter, sent only after the shopper's consent
// (storefront ARCHITECTURE §9). The store is the host's; nothing about the shopper is read or kept.

export const vitalsPath = '/shop-api/vitals'
const maxBody = 1024

export const handleVitals = async (request: Request, ctx: ShopContext): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const text = await request.text()
  let parsed: ReturnType<typeof vitalsBeacon.safeParse>
  try {
    parsed = vitalsBeacon.safeParse(text.length > maxBody ? null : JSON.parse(text))
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!parsed.success) return new Response(null, { status: 400 })
  // A preview's visits aren't shoppers', and a store that isn't selling has no field data to keep.
  if (ctx.sql && ctx.shopper?.available && !ctx.shopper.preview) await recordBeacon(ctx.sql, ctx.shopper.context.storeId, parsed.data, ctx.now())
  return new Response(null, { status: 204 })
}
