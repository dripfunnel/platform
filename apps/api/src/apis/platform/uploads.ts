import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { factsOf } from '#auth/activity'
import { resolvePartner } from '#auth/partnerCaller'
import { brandFileKinds, maxBrandFileBytes, uploadBrandFile, type BrandFileKind, type BrandFileStore } from '#saas/partnerBranding/index'

// `POST /api/uploads/brand-file?kind=…` (card #219): the raw file as the body. The Worker has
// checked the Origin; the session, the role and the bytes are checked here.

export const brandUploadPath = '/api/uploads/brand-file'

export interface BrandUploadRouteDeps {
  sql: postgres.Sql
  activity: ActivityLog
  /** Null where no assets bucket is bound yet (THIRD-PARTY-ACCESS.md §2.1). */
  store: BrandFileStore | null
  now: () => Date
}

/** At most `limit + 1` bytes, so a large body is refused without being held whole. */
const readCapped = async (request: Request, limit: number): Promise<Uint8Array> => {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      break
    }
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

export const handleBrandUpload = async (request: Request, deps: BrandUploadRouteDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const caller = await resolvePartner(deps.sql, request, deps.now())
  if (!caller) return refuse(401, 'UNAUTHENTICATED')
  const kind = new URL(request.url).searchParams.get('kind')
  if (!(brandFileKinds as readonly string[]).includes(kind ?? '')) return refuse(400, 'INVALID_KIND')
  if (!deps.store) return refuse(503, 'NOT_CONNECTED')
  if (Number(request.headers.get('content-length') ?? 0) > maxBrandFileBytes) return refuse(413, 'TOO_LARGE')
  const bytes = await readCapped(request, maxBrandFileBytes)
  const result = await uploadBrandFile({ sql: deps.sql, caller, facts: factsOf(request), activity: deps.activity, store: deps.store }, kind as BrandFileKind, bytes)
  if (result.ok) return json(200, result)
  return refuse(result.code === 'FORBIDDEN' ? 403 : result.code === 'TOO_LARGE' ? 413 : 415, result.code)
}
