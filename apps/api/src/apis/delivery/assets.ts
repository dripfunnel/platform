import { readCapped } from '#core/http'
import { maxImageBytes } from '#core/media'
import { createRiderProfile } from '#engine/modules/ownDelivery/index'
import type { DeliveryContext } from './access'

// `POST /delivery-api/assets` (the image as the body): a signed-in rider's profile photo (DELIVERY §4 `updateProfile`),
// through the catalogue's upload, as an image of its own store. Nothing else uploads or reads files here.

export const riderAssetsPath = '/delivery-api/assets'

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

const statusOf: Record<string, number> = { TOO_LARGE: 413, EMPTY: 400, UNSUPPORTED_TYPE: 415, RATE_LIMITED: 429, NOT_CONNECTED: 503 }

export const handleRiderAsset = async (request: Request, ctx: DeliveryContext): Promise<Response> => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!ctx.sql || !ctx.caller?.available) return refuse(503, 'STORE_UNAVAILABLE')
  const rider = ctx.caller.rider
  if (!rider) return refuse(401, 'UNAUTHENTICATED')
  if (Number(request.headers.get('content-length') ?? 0) > maxImageBytes) return refuse(413, 'TOO_LARGE')
  const read = await readCapped(request, maxImageBytes)
  if (!read.ok) return refuse(413, 'TOO_LARGE')
  const result = await createRiderProfile({ sql: ctx.sql, context: rider, activity: ctx.activity, facts: ctx.facts, files: ctx.files ?? null, now: ctx.now }).uploadPhoto(read.bytes)
  if (result.ok) return json(200, result)
  return refuse(statusOf[result.code] ?? 415, result.code)
}
