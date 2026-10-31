import { isCommonsUrl } from './commons'
import { isOpenverseUrl } from './openverse'
import { isPexelsUrl } from './pexels'
import { isUnsplashUrl } from './unsplash'
import { isPixabayUrl, type StockImages, type StockPhoto } from './pixabay'

// One search over every enabled source (docs/storefront/AI-STUDIO.md §8). Ids are `source:id`, so a chosen result is
// re-asked from its own source and a client never names a file address.

/** The most one source adds to a page, so a merged page holds at most this times the sources on. */
export const maxPerSource = 24

export const isStockUrl = (raw: string): boolean => [isPixabayUrl, isPexelsUrl, isOpenverseUrl, isCommonsUrl, isUnsplashUrl].some((check) => check(raw))

const words = (query: string): string[] => query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Only results whose text holds every word typed; sources return near matches too. */
const matches = (query: string, photo: StockPhoto): boolean => {
  const text = `${photo.tags} ${photo.user}`.toLowerCase()
  return words(query).every((word) => text.includes(word))
}

const interleave = <T>(lists: T[][]): T[] => {
  const out: T[] = []
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const list of lists) if (list[i]) out.push(list[i] as T)
  return out
}

export const stockImages = (sources: Record<string, StockImages>): StockImages | null => {
  const entries = Object.entries(sources)
  if (entries.length === 0) return null
  return {
    search: async (query, page) => {
      const answers = await Promise.all(entries.map(async ([name, source]) => ({ name, answer: await source.search(query, page) })))
      const live = answers.filter((a) => a.answer !== null)
      if (live.length === 0) return null
      const lists = live.map(({ name, answer }) => (answer?.photos ?? []).filter((p) => matches(query, p)).slice(0, maxPerSource).map((p) => ({ ...p, source: name, id: `${name}:${p.id}` })))
      // `total` adds each source's own count before the word filter, so it is an upper bound; a page holds up to 24 per source.
      return { total: live.reduce((sum, a) => sum + (a.answer?.total ?? 0), 0), photos: interleave(lists) }
    },
    download: async (id) => {
      const cut = id.indexOf(':')
      const name = id.slice(0, cut)
      return cut > 0 && Object.hasOwn(sources, name) ? (sources[name] as StockImages).download(id.slice(cut + 1)) : null
    },
  }
}
