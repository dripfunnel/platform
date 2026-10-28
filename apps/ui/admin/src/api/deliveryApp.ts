import { z } from 'zod'

// A store's delivery app APK, on plain HTTP because a GraphQL mutation can't carry the file (api/DELIVERY.md §5).

export const deliveryAppRefusals = ['FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'TOO_LARGE', 'NOT_AN_APK', 'BUILD_NOT_NEWER', 'NO_APP', 'MINIMUM_ABOVE_BUILD', 'UNAVAILABLE', 'NOT_CONNECTED'] as const
export type DeliveryAppRefusal = (typeof deliveryAppRefusals)[number]

export const deliveryAppSchema = z.object({
  version: z.number().int(),
  versionName: z.string(),
  buildNumber: z.number().int(),
  sizeBytes: z.number().int(),
  minimumBuild: z.number().int().nullable(),
  uploadedAt: z.string(),
})
export type DeliveryApp = z.infer<typeof deliveryAppSchema>

const answerSchema = z.union([z.object({ ok: z.literal(true), current: deliveryAppSchema.nullable() }), z.object({ ok: z.literal(false), code: z.string() })])

export type DeliveryAppAnswer = { ok: true; current: DeliveryApp | null } | { ok: false; code: DeliveryAppRefusal }

const refusalOf = (code: string): DeliveryAppRefusal => deliveryAppRefusals.find((known) => known === code) ?? 'NOT_CONNECTED'

const send = async (path: string, init: RequestInit, timeoutMs: number): Promise<DeliveryAppAnswer> => {
  try {
    const response = await fetch(`/api/stores/${path}`, { ...init, credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) })
    const answer = answerSchema.safeParse(await response.json())
    if (!answer.success) return { ok: false, code: 'NOT_CONNECTED' }
    return answer.data.ok ? answer.data : { ok: false, code: refusalOf(answer.data.code) }
  } catch {
    return { ok: false, code: 'NOT_CONNECTED' }
  }
}

export const loadDeliveryApp = (storeId: string): Promise<DeliveryAppAnswer> => send(`${storeId}/delivery-app`, {}, 15_000)

export interface DeliveryAppUpload {
  versionName: string
  buildNumber: number
  reason: string
}

/** The file as the body; the rest in the query, since a header can't carry every character of a reason (DELIVERY §5). */
export const uploadDeliveryApp = (storeId: string, file: Blob, { versionName, buildNumber, reason }: DeliveryAppUpload): Promise<DeliveryAppAnswer> =>
  send(
    `${storeId}/delivery-app?${new URLSearchParams({ versionName, buildNumber: String(buildNumber), reason })}`,
    { method: 'POST', headers: { 'content-type': 'application/vnd.android.package-archive' }, body: file },
    10 * 60_000,
  )

/** Null removes the minimum. */
export const setMinimumBuild = (storeId: string, minimumBuild: number | null, reason: string): Promise<DeliveryAppAnswer> =>
  send(`${storeId}/delivery-app/minimum-build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minimumBuild, reason }) }, 15_000)
