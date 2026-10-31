import { z } from 'zod'

// Pixabay's image search for the studio's picker (docs/storefront/AI-STUDIO.md §8). Nothing is cached: the Worker keeps no
// state between requests. A chosen image is downloaded into the store's own files, never hotlinked.

export interface StockPhoto {
  id: string
  source: string
  thumb: string
  user: string
  pageUrl: string
  tags: string
}

export interface StockImages {
  search: (query: string, page: number) => Promise<{ photos: StockPhoto[]; total: number } | null>
  /** The file's address for one result id, re-asked from its source so a client never names the address. */
  download: (id: string) => Promise<string | null>
}

const hits = z.object({
  totalHits: z.number().int(),
  hits: z.array(z.object({ id: z.number().int(), pageURL: z.string(), tags: z.string(), webformatURL: z.string(), largeImageURL: z.string(), user: z.string() })),
})

const perPage = 24
const api = 'https://pixabay.com/api/'
const hosts = /^(?:[a-z0-9-]+\.)*pixabay\.com$/

export const isPixabayUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && hosts.test(url.hostname)
  } catch {
    return false
  }
}

export const pixabayImages = ({ key, fetchImpl = fetch }: { key: string; fetchImpl?: typeof fetch }): StockImages => {
  const ask = async (params: Record<string, string>): Promise<z.infer<typeof hits> | null> => {
    const url = `${api}?${new URLSearchParams({ key, safesearch: 'true', image_type: 'photo', ...params })}`
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const parsed = hits.safeParse(await response.json())
      if (!parsed.success) return null
      return parsed.data
    } catch {
      return null
    }
  }
  return {
    search: async (query, page) => {
      const found = await ask({ q: query.slice(0, 100), page: String(page), per_page: String(perPage) })
      if (!found) return null
      return { total: found.totalHits, photos: found.hits.filter((h) => isPixabayUrl(h.webformatURL)).map((h) => ({ id: String(h.id), source: 'pixabay', thumb: h.webformatURL, user: h.user, pageUrl: h.pageURL, tags: h.tags })) }
    },
    download: async (id) => {
      const found = await ask({ id })
      const address = found?.hits[0]?.largeImageURL
      return address && isPixabayUrl(address) ? address : null
    },
  }
}
