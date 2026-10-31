import { z } from 'zod'
import type { StockImages } from './pixabay'

// Wikimedia Commons search for the studio's picker, CC0 and public domain files only so no credit is owed
// (docs/storefront/AI-STUDIO.md §8). Wikimedia asks every client to send a User-Agent.

const info = z.object({
  thumburl: z.string(),
  descriptionurl: z.string(),
  extmetadata: z.object({ LicenseShortName: z.object({ value: z.string() }).optional(), Artist: z.object({ value: z.string() }).optional(), ImageDescription: z.object({ value: z.string() }).optional() }).optional(),
})
const found = z.object({ query: z.object({ searchinfo: z.object({ totalhits: z.number().int() }).optional(), pages: z.record(z.string(), z.object({ pageid: z.number().int(), index: z.number().int().optional(), title: z.string(), imageinfo: z.array(info).min(1) })) }).optional() })

const api = 'https://commons.wikimedia.org/w/api.php'
const agent = 'DripFunnel/1.0 (https://dripfunnel.ai; stock image picker)'
const perPage = 24
const free = /^(?:cc0|cc[ -]zero|public domain|pd)\b/i

export const isCommonsUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org'
  } catch {
    return false
  }
}

const text = (html: string | undefined): string => (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

export const commonsImages = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): StockImages => {
  const ask = async (params: Record<string, string>): Promise<z.infer<typeof found> | null> => {
    try {
      const url = `${api}?${new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1280', ...params })}`
      const response = await fetchImpl(url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const parsed = found.safeParse(await response.json())
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }
  const usable = (pages: NonNullable<z.infer<typeof found>['query']>['pages']) =>
    Object.values(pages).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((p) => {
      const file = p.imageinfo[0]
      return file && free.test(file.extmetadata?.LicenseShortName?.value ?? '') && isCommonsUrl(file.thumburl) ? [{ page: p, file }] : []
    })
  return {
    search: async (query, page) => {
      const got = await ask({ generator: 'search', gsrsearch: `${query.slice(0, 100)} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(perPage), gsrinfo: 'totalhits', gsroffset: String((page - 1) * perPage) })
      if (!got) return null
      const photos = usable(got.query?.pages ?? {}).map(({ page: p, file }) => ({
        id: String(p.pageid),
        source: 'commons',
        thumb: file.thumburl,
        user: text(file.extmetadata?.Artist?.value),
        pageUrl: file.descriptionurl,
        tags: `${p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')} ${text(file.extmetadata?.ImageDescription?.value)}`,
      }))
      return { total: got.query?.searchinfo?.totalhits ?? photos.length, photos }
    },
    download: async (id) => {
      if (!/^\d{1,12}$/.test(id)) return null
      const got = await ask({ pageids: id })
      const first = got?.query ? usable(got.query.pages)[0] : undefined
      return first?.file.thumburl ?? null
    },
  }
}
