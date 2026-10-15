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

export type FilterInput = {
  id: string | null
  name: string
  position: number
  /** The revision read, for an existing filter: a save from an older read is refused, never undoing another's. */
  revision: number | null
  shopperVisible: boolean
  /** Every value it keeps, by id, and new ones without an id; a value left out is deleted. */
  values: { id: string | null; name: string }[]
}

export const saveFilter = async (client: ApiClient, input: FilterInput): Promise<string> =>
  (
    await typedQuery(client)('mutation SaveFilter($input: FacetInput!) { saveFacet(input: $input) }', z.object({ saveFacet: z.string() }), {
      input: {
        ...(input.id ? { id: input.id } : {}),
        ...(input.revision !== null ? { revision: input.revision } : {}),
        name: input.name,
        position: input.position,
        shopperVisible: input.shopperVisible,
        values: input.values.map((value) => (value.id ? { id: value.id, name: value.name } : { name: value.name })),
      },
    })
  ).saveFacet

/** Look-alike values into one; answers how many values went. */
export const mergeValues = async (client: ApiClient, into: string, from: string[]): Promise<number> =>
  (await typedQuery(client)('mutation MergeValues($into: ID!, $from: [ID!]!) { mergeFacetValues(into: $into, from: $from) }', z.object({ mergeFacetValues: z.number().int() }), { into, from })).mergeFacetValues
