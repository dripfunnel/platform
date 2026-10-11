import { z } from 'zod'
import { CloudflareRefused, CloudflareUnavailable } from './api'

// Purge by cache tag (storefront LIVE-SHOP.md §5 step 1): best effort only, since the edge lookup's 60-second limit is what
// guarantees a change shows; THIRD-PARTY-ACCESS §2.1 has the token's one permission, Zone › Cache Purge.

const timeoutMs = 10_000
/** Cloudflare's limit on tags per purge call. */
export const maxTagsPerPurge = 30

export interface CachePurge {
  purgeTags: (tags: readonly string[]) => Promise<void>
}

export const cachePurgeClient = ({ token, zoneId, fetchImpl = fetch }: { token: string; zoneId: string; fetchImpl?: typeof fetch }): CachePurge => ({
  purgeTags: async (tags) => {
    for (let i = 0; i < tags.length; i += maxTagsPerPurge) {
      let response: Response
      try {
        response = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ tags: tags.slice(i, i + maxTagsPerPurge) }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        throw new CloudflareUnavailable('no answer')
      }
      if (response.status >= 500 || [401, 403, 404, 429].includes(response.status)) throw new CloudflareUnavailable(`answered ${response.status}`)
      if (!response.ok) throw new CloudflareRefused(`answered ${response.status}`)
      const body = z.object({ success: z.boolean() }).safeParse(await response.json().catch(() => null))
      if (!body.success || !body.data.success) throw new CloudflareUnavailable('answered without success')
    }
  },
})
