import { z } from 'zod'
import { referencePageSchema, type ReferencePage } from '#integrations/cloudflare/reference'
import type { AiImage } from '#integrations/ai/index'

/** The data centre's own cache (`caches.default`); absent off Cloudflare, where every look is taken again. */
export interface LookCache {
  match: (key: Request) => Promise<Response | undefined>
  put: (key: Request, response: Response) => Promise<void>
}

export type SiteLook = { shots: AiImage[]; measured: ReferencePage | null }

// A studio session's length, so a sample site from an earlier turn is pictured once, not on every later message.
const lookSeconds = 30 * 60

const keptSchema = z.strictObject({ shots: z.array(z.strictObject({ mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), base64: z.string() })).max(4), measured: referencePageSchema.nullable() })

/** The key holds the store, so no store reads another's look (AGENTS.md "Reliability"). */
export const lookKey = (storeId: string, device: string, site: string): Request =>
  new Request(`https://studio-look.invalid/${storeId}/${device}/${encodeURIComponent(site)}`)

/** The site's screenshots and measure from the cache, else from `take`; only a look with screenshots is kept. */
export const throughLookCache = async (cache: LookCache | null, key: Request, take: () => Promise<SiteLook | null>): Promise<SiteLook | null> => {
  if (!cache) return take()
  const hit = await cache.match(key)
  const kept = hit ? keptSchema.safeParse(await hit.json().catch(() => null)) : null
  if (kept?.success) return kept.data
  const look = await take()
  if (look && look.shots.length > 0) {
    await cache.put(key, new Response(JSON.stringify(look), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${lookSeconds}` } }))
  }
  return look
}
