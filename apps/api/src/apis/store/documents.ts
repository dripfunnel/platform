import { GraphQLError } from 'graphql'
import { isUuid } from '#core/ids'
import { withScope } from '#db/scoped/index'
import { selectDocumentFile } from '#db/scoped/labels'
import type { AssetStore } from '#engine/modules/catalog/index'
import { actingCaller, storePolicy, type StoreContext } from './access'

// `GET /api/documents/{id}` on the portal host: an order's printable (DATA-MODEL §7.6 order_document), for `orders.read`
// through the same policy as GraphQL. The caller's own scope reads it, so a supplier opens only the labels it booked.

export const documentsPath = '/api/documents'

export const isDocumentsPath = (pathname: string): boolean => pathname.startsWith(`${documentsPath}/`)

const statusOf: Record<string, number> = { UNAUTHENTICATED: 401, STORE_REQUIRED: 400, SUPPLIER_REQUIRED: 400, STORE_SUSPENDED: 403, BLOCKED_FOR_SUPPORT: 403 }

export const handleDocument = async (request: Request, ctx: StoreContext, store: AssetStore | null): Promise<Response> => {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const id = new URL(request.url).pathname.slice(documentsPath.length + 1)
  try {
    // A read is one a support session's log names, with the document's id (LOGGING.md §3).
    await storePolicy.authorize({ api: 'store', scope: 'store-seller', permission: 'orders.read', target: 'none' }, ctx, { id }, 'query', { name: 'documents', root: true })
  } catch (error) {
    const code = error instanceof GraphQLError ? String(error.extensions['code'] ?? 'FORBIDDEN') : 'FORBIDDEN'
    return new Response(JSON.stringify({ ok: false, code }), { status: statusOf[code] ?? 403, headers: { 'content-type': 'application/json' } })
  }
  if (!ctx.sql || !store) return new Response(null, { status: 503 })
  const caller = actingCaller(ctx)
  // Another store's, or another owner's, is "not found", like one that never was (ACCESS §11).
  const row = isUuid(id) ? await withScope(ctx.sql, caller.context, (tx) => selectDocumentFile(tx, caller.context.storeId, id)) : null
  const object = row ? await store.get(row.r2_key) : null
  if (!row || !object) return new Response(null, { status: 404 })
  return new Response(object.body, {
    headers: { 'content-type': row.mime, 'content-length': String(row.bytes), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
  })
}
