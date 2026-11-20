import { z } from 'zod'
import type { MapsKeyCheck } from '#core/mapsKey'

// Is a Google Maps browser key usable (#1612; THIRD-PARTY-ACCESS §2.12)? One Geocoding request from the Worker, with the
// hooks host as its referrer, as the frame's page would be. The key is never logged or put in an error or a result.

export const mapsKeyTimeoutMs = 5_000

const answerSchema = z.object({ status: z.string(), error_message: z.string().optional() }).loose()

/**
 * Google's answer as one result. A REQUEST_DENIED names its reason only in prose, so it is read by the words it uses. A key
 * restricted to websites is refused by this web service as a kind, which says the key exists and is restricted, not that it
 * is wrong, so it passes: only the browser can show whether the referrer is allowed.
 */
export const mapsKeyAnswer = (raw: unknown): MapsKeyCheck => {
  const parsed = answerSchema.safeParse(raw)
  if (!parsed.success) return { status: 'unavailable' }
  const { status, error_message: message = '' } = parsed.data
  if (status === 'OK' || status === 'ZERO_RESULTS') return { status: 'ok' }
  if (status !== 'REQUEST_DENIED') return { status: 'unavailable' }
  const text = message.toLowerCase()
  if (text.includes('referer restrictions cannot be used')) return { status: 'ok' }
  if (text.includes('key is invalid') || text.includes('key not valid') || text.includes('invalid api key')) return { status: 'rejected', problem: 'invalid' }
  // Before the API wording below: "not authorized to use this API key" is the key's restriction, not the API being off.
  if (text.includes('referer') || text.includes('referrer') || text.includes('restricted') || text.includes('not authorized to use this api key')) return { status: 'rejected', problem: 'restricted' }
  if (text.includes('not authorized to use this api') || text.includes('is not activated') || text.includes('has not been used') || text.includes('is disabled')) return { status: 'rejected', problem: 'geocoding_disabled' }
  return { status: 'rejected', problem: 'other' }
}

export interface MapsKeyCheckOptions {
  /** The hooks host, which a key restricted to websites must allow. */
  hooksHost: string
  fetchImpl?: typeof fetch
}

export const checkGoogleMapsKey = async (key: string, { hooksHost, fetchImpl = fetch }: MapsKeyCheckOptions): Promise<MapsKeyCheck> => {
  try {
    const response = await fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Mumbai')}&key=${encodeURIComponent(key)}`, {
      headers: { referer: `https://${hooksHost}/`, accept: 'application/json' },
      signal: AbortSignal.timeout(mapsKeyTimeoutMs),
    })
    if (response.status >= 500 || response.status === 429) return { status: 'unavailable' }
    return mapsKeyAnswer(await response.json().catch(() => null))
  } catch {
    return { status: 'unavailable' }
  }
}
