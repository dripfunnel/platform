import { GraphQLError } from 'graphql'
import { readCapped } from '#core/http'
import { maxDownloadBytes, maxImageBytes, maxVideoBytes } from '#core/media'
import { storeRoleHas } from '#auth/storePermissions'
import { createAssetService, type AssetStore } from '#engine/modules/catalog/index'
import { actingCaller, storePolicy, type StoreContext } from './access'
import { isUuid } from '#core/ids'

// `POST /api/assets` (the raw file as the body; `?kind=download` for a download's file) and `GET /api/assets/{id}` on the
// portal host (FIRST-RELEASE §19 `uploadAsset`): the session, the acting store and the role come first, as for
// GraphQL, through the same policy; the Worker has already checked the Origin.

export const assetsPath = '/api/assets'


const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

const statusOf: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, STORE_REQUIRED: 400, SUPPLIER_REQUIRED: 400, STORE_SUSPENDED: 403, READ_ONLY: 403, SUPPORT_READ_ONLY: 403, BLOCKED_FOR_SUPPORT: 403 }

/** The policy's refusal as an HTTP answer, or null when the caller may go on. */
const refusedBy = async (ctx: StoreContext, permission: 'catalog.read' | 'catalog.write', id: string): Promise<Response | null> => {
  // A Stock-only supplier uploads the photos of the products it proposes (decided on #337).
  const proposer = ctx.standing.kind === 'acting' && permission === 'catalog.write' && !storeRoleHas(ctx.standing.caller.role, 'catalog.write') && storeRoleHas(ctx.standing.caller.role, 'catalog.propose')
  try {
    await storePolicy.authorize({ api: 'store', scope: 'store-seller', permission: proposer ? 'catalog.propose' : permission, target: 'none' }, ctx, { id }, permission === 'catalog.write' ? 'mutation' : 'query', { name: 'assets', root: true })
    return null
  } catch (error) {
    const code = error instanceof GraphQLError ? String(error.extensions['code'] ?? 'FORBIDDEN') : 'FORBIDDEN'
    return refuse(statusOf[code] ?? 403, code)
  }
}

export const isAssetsPath = (pathname: string): boolean => pathname === assetsPath || pathname.startsWith(`${assetsPath}/`)

export const handleAssets = async (request: Request, ctx: StoreContext, store: AssetStore | null): Promise<Response> => {
  const url = new URL(request.url)
  const id = url.pathname.slice(assetsPath.length + 1)
  const reading = request.method === 'GET' && url.pathname !== assetsPath
  if (!reading && !(request.method === 'POST' && url.pathname === assetsPath)) return new Response('Method not allowed', { status: 405 })
  // A read is one a support session's log names, with the file's id (LOGGING.md §3).
  const refused = await refusedBy(ctx, reading ? 'catalog.read' : 'catalog.write', id)
  if (refused) return refused
  if (!ctx.sql) return refuse(503, 'NOT_CONNECTED')
  if (!store) return refuse(503, 'NOT_CONNECTED')
  const caller = actingCaller(ctx)
  const service = createAssetService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, store })

  if (reading) {
    // Another store's or supplier's file is "not found", like one that never was (ACCESS §11).
    const file = isUuid(id) ? await service.open(id) : null
    if (!file) return new Response(null, { status: 404 })
    return new Response(file.body, {
      headers: { 'content-type': file.mime, 'content-length': String(file.bytes), 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
    })
  }

  // `?kind=download`: a download's file (CATALOG T14), the merchant's own as its products are (decided on #323).
  const download = url.searchParams.get('kind') === 'download'
  if (download && caller.context.sellerScope.kind === 'seller') return refuse(403, 'FORBIDDEN')
  const limit = download ? maxDownloadBytes : Math.max(maxImageBytes, maxVideoBytes)
  if (Number(request.headers.get('content-length') ?? 0) > limit) return refuse(413, 'TOO_LARGE')
  const read = await readCapped(request, limit)
  if (!read.ok) return refuse(413, 'TOO_LARGE')
  const result = download ? await service.uploadDownload(read.bytes) : await service.upload(read.bytes)
  if (result.ok) return json(200, result)
  return refuse(result.code === 'TOO_LARGE' ? 413 : result.code === 'EMPTY' ? 400 : 415, result.code)
}
