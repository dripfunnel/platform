import type { PageInfo } from '@dripfunnel/shared/graphql'
import { z } from 'zod'

// One page of a cursor-paged list, as every Platform API list answers it (FIRST-RELEASE §16).
export interface Page<T> {
  items: readonly T[]
  pageInfo: PageInfo
}

export const pageInfoSchema = z.object({ startCursor: z.string().nullable(), endCursor: z.string().nullable(), hasPreviousPage: z.boolean(), hasNextPage: z.boolean() })

export const pageInfoFields = 'pageInfo { startCursor endCursor hasPreviousPage hasNextPage }'
