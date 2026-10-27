import { z } from 'zod'

// Google's Routes API `computeRoutes` for an arrival estimate (THIRD-PARTY-ACCESS §2.12, DELIVERY §7): one call with a
// timeout and at most one retry, asked for the duration only. Positions and the key never reach a log or an error.

export interface LatLng {
  latitude: number
  longitude: number
}

export interface GoogleRoutes {
  /** Seconds of traffic-aware driving from `from` to `to`, or null when Google has no route or gave nothing usable. */
  durationSeconds: (from: LatLng, to: LatLng, signal?: AbortSignal) => Promise<number | null>
}

export const routesUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes'
export const routesTimeoutMs = 5_000

/** No answer, throttled or failed on Google's side, even after the one retry. */
export class RoutesUnavailable extends Error {
  override name = 'RoutesUnavailable'
}

const answer = z.object({ routes: z.array(z.object({ duration: z.string().regex(/^\d+(\.\d+)?s$/) }).loose()).optional() }).loose()

const point = (p: LatLng) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } })

export const googleRoutesClient = ({ key, fetchImpl = fetch, timeoutMs = routesTimeoutMs }: { key: string; fetchImpl?: typeof fetch; timeoutMs?: number }): GoogleRoutes => {
  const once = async (from: LatLng, to: LatLng, outer?: AbortSignal): Promise<number | null> => {
    const signal = outer ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(routesUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': 'routes.duration' },
        body: JSON.stringify({ origin: point(from), destination: point(to), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' }),
        signal,
      })
    } catch {
      throw new RoutesUnavailable('no answer')
    }
    if (response.status === 429 || response.status >= 500) throw new RoutesUnavailable(`status ${response.status}`)
    // A refused request (a bad key, a point Google cannot route) will not change on a retry: no estimate.
    if (!response.ok) return null
    const parsed = answer.safeParse(await response.json().catch(() => null))
    const duration = parsed.success ? parsed.data.routes?.[0]?.duration : undefined
    return duration ? Math.round(Number.parseFloat(duration)) : null
  }

  return {
    durationSeconds: async (from, to, signal) => {
      try {
        return await once(from, to, signal)
      } catch (error) {
        if (!(error instanceof RoutesUnavailable) || signal?.aborted) throw error
        return once(from, to, signal)
      }
    },
  }
}
