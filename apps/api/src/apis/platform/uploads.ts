import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { factsOf } from '#auth/activity'
import { resolvePartner } from '#auth/partnerCaller'
import { partnerRoleHas } from '#auth/partnerPermissions'
import { readCapped } from '#core/http'
import { brandFileKinds, maxBrandFileBytes, uploadBrandFile, type BrandFileKind, type BrandFileStore } from '#saas/partnerBranding/index'

// `POST /api/uploads/brand-file?kind=…` (card #219): the raw file as the body. The Worker has
// checked the Origin; the session and the role come before the query or the body is looked at.

export const brandUploadPath = '/api/uploads/brand-file'

export interface BrandUploadRouteDeps {
  sql: postgres.Sql
  activity: ActivityLog
  /** Null where no assets bucket is bound yet (THIRD-PARTY-ACCESS.md §2.1). */
  store: BrandFileStore | null
  now: () => Date
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

// The console's thumbnails: a file read back by its key, only from the caller's own brand prefix.
const readBrandFile = async (request: Request, store: BrandFileStore | null, partnerId: string): Promise<Response> => {
  const key = new URL(request.url).searchParams.get('key') ?? ''
  if (!store?.get || !new RegExp(`^partners/${partnerId}/brand/[\\w.-]+$`).test(key)) return new Response(null, { status: 404 })
  const object = await store.get(key)
  if (!object) return new Response(null, { status: 404 })
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } })
}

export const handleBrandUpload = async (request: Request, deps: BrandUploadRouteDeps): Promise<Response> => {
  if (request.method !== 'POST' && request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const caller = await resolvePartner(deps.sql, request, deps.now(), deps.activity)
  if (!caller) return refuse(401, 'UNAUTHENTICATED')
  if (request.method === 'GET') return readBrandFile(request, deps.store, caller.partner.id)
  if (!partnerRoleHas(caller.role, 'branding.write')) return refuse(403, 'FORBIDDEN')
  const kind = new URL(request.url).searchParams.get('kind')
  if (!(brandFileKinds as readonly string[]).includes(kind ?? '')) return refuse(400, 'INVALID_KIND')
  if (!deps.store) return refuse(503, 'NOT_CONNECTED')
  if (Number(request.headers.get('content-length') ?? 0) > maxBrandFileBytes) return refuse(413, 'TOO_LARGE')
  const read = await readCapped(request, maxBrandFileBytes)
  if (!read.ok) return refuse(413, 'TOO_LARGE')
  const bytes = read.bytes
  const result = await uploadBrandFile({ sql: deps.sql, caller, facts: factsOf(request), activity: deps.activity, store: deps.store }, kind as BrandFileKind, bytes)
  if (result.ok) return json(200, result)
  return refuse(result.code === 'FORBIDDEN' ? 403 : result.code === 'TOO_LARGE' ? 413 : result.code === 'WRONG_DIMENSIONS' || result.code === 'HAS_TRANSPARENCY' ? 422 : 415, result.code)
}
