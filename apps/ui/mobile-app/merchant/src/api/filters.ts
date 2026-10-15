import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// Filters (facets) on the Store API (CATALOG-DESIGN.md I): what shoppers narrow by, and internal tags only the team sees.

const filterSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  revision: z.number().int(),
  shopperVisible: z.boolean(),
  values: z.array(z.object({ id: z.string(), name: z.string(), products: z.number().int() })),
})
export type Filter = z.infer<typeof filterSchema>
export type FilterValue = Filter['values'][number]

/** Every filter in the store's order, each value with how many products use it. */
export const loadFilters = (client: ApiClient): Promise<Filter[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          'query Filters($after: String) { facets(first: 50, after: $after) { nodes { id name position revision shopperVisible values { id name products } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
          z.object({ facets: z.object({ nodes: z.array(filterSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).facets,
  )
