import { roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { readCapped } from '#core/http'
import { maxImageBytes } from '#core/media'
import type { StoreCategoryAdminService } from '#saas/storeCategories/index'

// The sample editor's photos (admin FIRST-RELEASE §11b), plain HTTP because a GraphQL mutation can't carry the file.
// The Worker has checked the Origin; the session comes first, then the role, then the body (as deliveryApp.ts does).
// POST /api/store-category-photos?category={id} stores one (Super admin); GET …/{categoryId}/{sha} previews one.

const upload = /^\/api\/store-category-photos$/
const preview = /^\/api\/store-category-photos\/([0-9a-fA-F-]{36})\/([0-9a-f]{64})$/

export type SamplePhotoRoute = { kind: 'upload' } | { kind: 'preview'; categoryId: string; sha: string }

export const matchSamplePhotoPath = (pathname: string): SamplePhotoRoute | null => {
  if (upload.test(pathname)) return { kind: 'upload' }
  const m = preview.exec(pathname)
  return m?.[1] && m[2] ? { kind: 'preview', categoryId: m[1], sha: m[2] } : null
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

/** `service` and `staff` are null for a caller with no staff session. */
export const handleSamplePhoto = async (request: Request, route: SamplePhotoRoute, staff: StaffMember | null, service: StoreCategoryAdminService | null): Promise<Response> => {
  if (!staff || !service) return refuse(401, 'UNAUTHENTICATED')
  if (route.kind === 'preview') {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    if (!roleHas(staff.role, 'storeCategories.read')) return refuse(403, 'FORBIDDEN')
    const object = await service.samplePhoto(route.categoryId, route.sha)
    if (!object) return refuse(404, 'NOT_FOUND')
    // Content-addressed: a sha never names other bytes, so the browser may keep it. No sniffing, no inline scripts.
    return new Response(object.body, { headers: { 'cache-control': 'private, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } })
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!roleHas(staff.role, 'storeCategories.manage')) return refuse(403, 'FORBIDDEN')
  const categoryId = new URL(request.url).searchParams.get('category') ?? ''
  const body = await readCapped(request, maxImageBytes)
  if (!body.ok) return refuse(413, 'TOO_LARGE')
  const stored = await service.uploadSamplePhoto(categoryId, body.bytes)
  if (!stored.ok) return refuse(stored.code === 'NOT_FOUND' ? 404 : stored.code === 'NO_STORAGE' ? 503 : 415, stored.code)
  return json(200, { ok: true, ref: stored.ref, previewUrl: `/api/store-category-photos/${categoryId}/${stored.sha}` })
}
