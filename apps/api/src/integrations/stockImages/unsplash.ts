import { z } from 'zod'
import type { StockImages } from './pixabay'

// Unsplash search for the studio's picker and, when AI_PHOTO_SOURCES names it, the AI (docs/storefront/AI-STUDIO.md §8).
// Using a photo pings Unsplash's download endpoint, as its API guidelines ask.

const photo = z.object({
  id: z.string(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  alt_description: z.string().nullish(),
  description: z.string().nullish(),
  tags: z.array(z.object({ title: z.string() })).nullish(),
  urls: z.object({ small: z.string(), raw: z.string() }),
  links: z.object({ html: z.string(), download_location: z.string() }),
  user: z.object({ name: z.string() }),
})
const found = z.object({ total: z.number().int(), results: z.array(photo) })

const api = 'https://api.unsplash.com'
/** The width of the file the Worker downloads, wide enough for a hero. */
const fileWidth = 1920

const sizeOf = (width: number | null | undefined, height: number | null | undefined) => {
  if (!width || !height) return {}
  const scale = Math.min(1, fileWidth / width)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export const isUnsplashUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'images.unsplash.com'
  } catch {
    return false
  }
}

const sized = (raw: string): string => {
  const url = new URL(raw)
  url.searchParams.set('w', String(fileWidth))
  url.searchParams.set('fm', 'jpg')
  url.searchParams.set('q', '80')
  return url.toString()
}

export const unsplashImages = ({ key, fetchImpl = fetch }: { key: string; fetchImpl?: typeof fetch }): StockImages => {
  const ask = async <T extends z.ZodType>(url: string, schema?: T): Promise<z.infer<T> | null> => {
    try {
      const response = await fetchImpl(url, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      if (!schema) return {} as z.infer<T>
      const parsed = schema.safeParse(await response.json())
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }
  return {
    search: async (query, page) => {
      const got = await ask(`${api}/search/photos?${new URLSearchParams({ query: query.slice(0, 100), page: String(page), per_page: '24', content_filter: 'high' })}`, found)
      if (!got) return null
      return {
        total: got.total,
        photos: got.results.filter((p) => isUnsplashUrl(p.urls.small)).map((p) => ({
          id: p.id,
          source: 'unsplash',
          thumb: p.urls.small,
          user: p.user.name,
          pageUrl: p.links.html,
          tags: [p.alt_description, p.description, ...(p.tags ?? []).map((t) => t.title)].filter(Boolean).join(' '),
          ...sizeOf(p.width, p.height),
        })),
      }
    },
    download: async (id) => {
      if (!/^[\w-]{1,32}$/.test(id)) return null
      const got = await ask(`${api}/photos/${id}`, photo)
      if (!got || !isUnsplashUrl(got.urls.raw) || !got.links.download_location.startsWith(`${api}/`)) return null
      await ask(got.links.download_location)
      return sized(got.urls.raw)
    },
  }
}
