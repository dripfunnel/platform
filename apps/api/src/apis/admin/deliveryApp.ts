import type { createDeliveryApp, DeliveryAppRefusal } from '#saas/deliveryApp/index'

// The delivery app APK routes (api/DELIVERY.md §5), plain HTTP because a GraphQL mutation can't carry the file.
// The Worker has checked the Origin; the session comes first, then the role, then the body (as the brand upload does).

const route = /^\/api\/stores\/([0-9a-fA-F-]{36})\/delivery-app(\/minimum-build)?$/

export interface DeliveryAppRoute {
  storeId: string
  minimumBuild: boolean
}

export const matchDeliveryAppPath = (pathname: string): DeliveryAppRoute | null => {
  const match = route.exec(pathname)
  return match?.[1] ? { storeId: match[1], minimumBuild: match[2] !== undefined } : null
}

type Service = ReturnType<typeof createDeliveryApp>

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, code: string) => json(status, { ok: false, code })

const statusOf: Record<DeliveryAppRefusal, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  TOO_LARGE: 413,
  NOT_AN_APK: 415,
  BUILD_NOT_NEWER: 409,
  NO_APP: 409,
  MINIMUM_ABOVE_BUILD: 422,
  UNAVAILABLE: 503,
}

const answer = <T>(result: { ok: true; value: T } | { ok: false; code: DeliveryAppRefusal }): Response => (result.ok ? json(200, { ok: true, current: result.value }) : refuse(statusOf[result.code], result.code))

// A reason can hold any character, which a header can't: the console sends it percent-encoded and says so. It never goes in the URL, which is logged.
const reasonOf = (request: Request): string => {
  const raw = request.headers.get('x-reason') ?? ''
  if (request.headers.get('x-reason-encoding') !== 'uri') return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

/** `service` is null for a caller with no staff session. */
export const handleDeliveryApp = async (request: Request, target: DeliveryAppRoute, service: Service | null): Promise<Response> => {
  if (!service) return refuse(401, 'UNAUTHENTICATED')
  if (target.minimumBuild) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    const body: unknown = await request.json().catch(() => null)
    return answer(await service.setMinimumBuild(target.storeId, body))
  }
  if (request.method === 'GET') return answer(await service.read(target.storeId))
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const query = new URL(request.url).searchParams
  const length = Number(request.headers.get('content-length') ?? NaN)
  const input = { versionName: query.get('versionName') ?? '', buildNumber: Number(query.get('buildNumber') ?? NaN), reason: reasonOf(request) }
  return answer(await service.upload(target.storeId, input, request.body, length))
}
