import { GraphQLError } from 'graphql'
import { readCapped } from '#core/http'
import type { BrandFileStore } from '#saas/partnerBranding/index'
import { appFilePrefix, isAppFileKind, maxAppFileBytes } from '#saas/storeApps/index'
import { actingCaller, storePolicy, type StoreContext } from './access'
import { storeAppsFor } from './storeApps'

// `POST /api/app-assets?kind=appIcon|appIconForeground|splash` (the raw file as the body) and `GET /api/app-assets?key=` on the portal
// host (Settings › Mobile apps, SH 15): the session, the acting store and the Owner's `settings` come first, as for GraphQL, through
// the same policy; the Worker has already checked the Origin.

export const appAssetsPath = '/api/app-assets'

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

const statusOf: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, STORE_REQUIRED: 400, SUPPLIER_REQUIRED: 400, STORE_SUSPENDED: 403, READ_ONLY: 403, SUPPORT_READ_ONLY: 403, BLOCKED_FOR_SUPPORT: 403 }

/** The policy's refusal as an HTTP answer, or null when the caller may go on. */
const refusedBy = async (ctx: StoreContext, operation: 'query' | 'mutation'): Promise<Response | null> => {
  try {
    await storePolicy.authorize({ api: 'store', scope: 'store', permission: 'settings', target: 'none' }, ctx, {}, operation, { name: 'appAssets', root: true })
    return null
  } catch (error) {
    const code = error instanceof GraphQLError ? String(error.extensions['code'] ?? 'FORBIDDEN') : 'FORBIDDEN'
    return refuse(statusOf[code] ?? 403, code)
  }
}

export const isAppAssetsPath = (pathname: string): boolean => pathname === appAssetsPath

const refusalStatus: Record<string, number> = { PLAN_LIMIT: 403, FORBIDDEN: 403, UNAVAILABLE: 503, TOO_LARGE: 413, WRONG_DIMENSIONS: 422, HAS_TRANSPARENCY: 422 }

/** The portal's previews: an image read back by its key, only from this store's own prefix. */
const readImage = async (request: Request, ctx: StoreContext, files: BrandFileStore | null): Promise<Response> => {
  const key = new URL(request.url).searchParams.get('key') ?? ''
  if (!files?.get || !new RegExp(`^${appFilePrefix(actingCaller(ctx).store.id)}[\\w.-]+$`).test(key)) return new Response(null, { status: 404 })
  const object = await files.get(key)
  if (!object) return new Response(null, { status: 404 })
  return new Response(object.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } })
}

export const handleAppAssets = async (request: Request, ctx: StoreContext, files: BrandFileStore | null): Promise<Response> => {
  if (request.method !== 'POST' && request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const refused = await refusedBy(ctx, request.method === 'GET' ? 'query' : 'mutation')
  if (refused) return refused
  if (!ctx.sql) return refuse(503, 'NOT_CONNECTED')
  if (request.method === 'GET') return readImage(request, ctx, files)
  const kind = new URL(request.url).searchParams.get('kind')
  if (!isAppFileKind(kind)) return refuse(400, 'INVALID_KIND')
  if (Number(request.headers.get('content-length') ?? 0) > maxAppFileBytes) return refuse(413, 'TOO_LARGE')
  const read = await readCapped(request, maxAppFileBytes)
  if (!read.ok) return refuse(413, 'TOO_LARGE')
  const result = await storeAppsFor(ctx, files).upload(kind, read.bytes)
  if (result.ok) return json(200, { ok: true, key: result.value.key })
  return refuse(refusalStatus[result.reason] ?? 415, result.reason)
}
