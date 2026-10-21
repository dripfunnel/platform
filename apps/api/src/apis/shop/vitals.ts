import { recordBeacon, vitalsBeacon } from '#saas/storefronts/index'
import type { ShopContext } from './access'

// `POST /shop-api/vitals`: one page view's Core Web Vitals from core's reporter, sent only after the shopper's consent
// (storefront ARCHITECTURE §9). The store is the host's; nothing about the shopper is read or kept.

export const vitalsPath = '/shop-api/vitals'
const maxBody = 1024

/** The body up to `maxBody` bytes, or null past it: a declared length is refused before anything is read. */
const cappedBody = async (request: Request): Promise<string | null> => {
  if (Number(request.headers.get('content-length') ?? 0) > maxBody) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBody) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export const handleVitals = async (request: Request, ctx: ShopContext): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const text = await cappedBody(request)
  if (text === null) return new Response(null, { status: 413 })
  let parsed: ReturnType<typeof vitalsBeacon.safeParse>
  try {
    parsed = vitalsBeacon.safeParse(JSON.parse(text))
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!parsed.success) return new Response(null, { status: 400 })
  // A preview's visits aren't shoppers', and a store that isn't selling has no field data to keep.
  if (ctx.sql && ctx.shopper?.available && !ctx.shopper.preview) await recordBeacon(ctx.sql, ctx.shopper.context.storeId, parsed.data, ctx.now())
  return new Response(null, { status: 204 })
}
