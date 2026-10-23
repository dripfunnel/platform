import { z } from 'zod'
import { ApiError } from './errors'

// Cursor paging as the Store API's lists page (a record's id is its cursor; `before` steps back, `after` forward).
export const pageInfoSchema = z.object({
  startCursor: z.string().nullable(),
  endCursor: z.string().nullable(),
  hasPreviousPage: z.boolean(),
  hasNextPage: z.boolean(),
})

export type PageInfo = z.infer<typeof pageInfoSchema>

export type PageRequest = { after?: string; before?: string }

export const nextPage = (pageInfo: PageInfo): PageRequest | null => (pageInfo.hasNextPage && pageInfo.endCursor ? { after: pageInfo.endCursor } : null)

export const previousPage = (pageInfo: PageInfo): PageRequest | null => (pageInfo.hasPreviousPage && pageInfo.startCursor ? { before: pageInfo.startCursor } : null)

/** The most pages `allPages` reads: 25 of 50 holds every list it is used for (500 collections, 1,000 hand-picked products, 200 filters or size charts). */
export const maxPages = 25

/**
 * Every page of a list, following each page's `endCursor` until the API says there is no more. A list still going after `maxPages` is a
 * BAD_RESPONSE (a cursor that never ends, or a list past its documented limit), never a quietly cut-off one.
 */
export const allPages = async <T>(readPage: (after: string | null) => Promise<{ nodes: T[]; pageInfo: PageInfo }>): Promise<T[]> => {
  const all: T[] = []
  let after: string | null = null
  for (let read = 0; read < maxPages; read += 1) {
    const page: { nodes: T[]; pageInfo: PageInfo } = await readPage(after)
    all.push(...page.nodes)
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return all
    after = page.pageInfo.endCursor
  }
  throw new ApiError('BAD_RESPONSE', `A list went on past ${maxPages} pages.`)
}
