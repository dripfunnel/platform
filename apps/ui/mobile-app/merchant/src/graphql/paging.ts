import { z } from 'zod'

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

/** Every page of a list, following each page's `endCursor` until the API says there is no more. */
export const allPages = async <T>(readPage: (after: string | null) => Promise<{ nodes: T[]; pageInfo: PageInfo }>): Promise<T[]> => {
  const all: T[] = []
  let after: string | null = null
  for (;;) {
    const page: { nodes: T[]; pageInfo: PageInfo } = await readPage(after)
    all.push(...page.nodes)
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return all
    after = page.pageInfo.endCursor
  }
}
