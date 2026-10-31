import { z } from 'zod'
import type { StockImages } from './pixabay'

// Pexels photo search for the studio's picker (docs/storefront/AI-STUDIO.md §8); the key is the Authorization header.

const photo = z.object({ id: z.number().int(), url: z.string(), photographer: z.string(), alt: z.string().nullish(), src: z.object({ medium: z.string(), large2x: z.string() }) })
const found = z.object({ total_results: z.number().int(), photos: z.array(photo) })

const api = 'https://api.pexels.com/v1'

export const isPexelsUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'images.pexels.com'
  } catch {
    return false
  }
}

export const pexelsImages = ({ key, fetchImpl = fetch }: { key: string; fetchImpl?: typeof fetch }): StockImages => {
  const ask = async <T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> => {
    try {
      const response = await fetchImpl(`${api}${path}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const parsed = schema.safeParse(await response.json())
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }
  return {
    search: async (query, page) => {
      const got = await ask(`/search?${new URLSearchParams({ query: query.slice(0, 100), page: String(page), per_page: '24' })}`, found)
      if (!got) return null
      return { total: got.total_results, photos: got.photos.filter((p) => isPexelsUrl(p.src.medium)).map((p) => ({ id: String(p.id), source: 'pexels', thumb: p.src.medium, user: p.photographer, pageUrl: p.url, tags: p.alt ?? '' })) }
    },
    download: async (id) => {
      const got = await ask(`/photos/${encodeURIComponent(id)}`, photo)
      return got && isPexelsUrl(got.src.large2x) ? got.src.large2x : null
    },
  }
}
