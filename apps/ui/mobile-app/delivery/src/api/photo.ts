import { ApiError, defaultTimeoutMs } from '@dripfunnel/mobile-shared/graphql'
import { z } from 'zod'
import { deliveryPath } from './client'

const answerSchema = z.object({ ok: z.boolean(), code: z.string().optional(), asset: z.object({ id: z.string() }).optional() })

type Upload = { host: string; token: string | null; uri: string; mimeType: string; timeoutMs?: number; fetchImpl?: typeof fetch }

/** Uploads the photo as the raw image to `POST /delivery-api/assets` and answers the asset's id, which `updateProfile` names (docs/api/DELIVERY.md §4). */
export const uploadPhoto = async ({ host, token, uri, mimeType, timeoutMs = defaultTimeoutMs, fetchImpl = fetch }: Upload): Promise<string> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const bytes = await (await fetchImpl(uri, { signal: abort.signal })).blob()
    const response = await fetchImpl(`https://${host}${deliveryPath}assets`, {
      method: 'POST',
      headers: { 'content-type': mimeType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: bytes,
      signal: abort.signal,
      credentials: 'omit',
    })
    const answer = answerSchema.safeParse(await response.json())
    if (!answer.success) throw new ApiError('BAD_RESPONSE', 'The API answered with an unexpected shape.')
    if (answer.data.ok && answer.data.asset) return answer.data.asset.id
    throw new ApiError(answer.data.code, 'The API refused the photo.')
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError('NO_RESPONSE', 'The API did not answer.')
  } finally {
    clearTimeout(timer)
  }
}
