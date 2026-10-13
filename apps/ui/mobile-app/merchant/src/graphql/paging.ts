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
