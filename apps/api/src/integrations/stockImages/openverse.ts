import { z } from 'zod'
import type { StockImages } from './pixabay'

// Openverse search for the studio's picker, CC0 and public domain only so no credit is owed (docs/storefront/AI-STUDIO.md §8).
// The file comes from Openverse's own thumbnail endpoint (about 600px), so the address is always on its host.

const result = z.object({
  id: z.string().uuid(),
  title: z.string().nullish(),
  creator: z.string().nullish(),
  foreign_landing_url: z.string().nullish(),
  tags: z.array(z.object({ name: z.string() })).nullish(),
})
const found = z.object({ result_count: z.number().int(), results: z.array(result) })

const api = 'https://api.openverse.org/v1/images/'

export const isOpenverseUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'api.openverse.org'
  } catch {
    return false
  }
}

export const openverseImages = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): StockImages => ({
  search: async (query, page) => {
    try {
      const params = new URLSearchParams({ q: query.slice(0, 100), page: String(page), page_size: '24', license: 'cc0,pdm', mature: 'false' })
      const response = await fetchImpl(`${api}?${params}`, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const parsed = found.safeParse(await response.json())
      if (!parsed.success) return null
      return {
        total: parsed.data.result_count,
        photos: parsed.data.results.map((r) => ({
          id: r.id,
          source: 'openverse',
          thumb: `${api}${r.id}/thumb/`,
          user: r.creator ?? '',
          pageUrl: r.foreign_landing_url ?? 'https://openverse.org/',
          tags: [r.title ?? '', ...(r.tags ?? []).map((t) => t.name)].join(' '),
        })),
      }
    } catch {
      return null
    }
  },
  download: async (id) => (z.string().uuid().safeParse(id).success ? `${api}${id}/thumb/` : null),
})
