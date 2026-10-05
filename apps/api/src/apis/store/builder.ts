import SchemaBuilder from '@pothos/core'
import type { PageInfo } from '#core/paging'
import type { StoreContext } from './access'

/** One builder per Store API schema; each area file adds its types and fields to it (api/README.md §3). */
export const createStoreBuilder = () => {
  const builder = new SchemaBuilder<{ Context: StoreContext }>({})
  builder.queryType({})
  return builder
}

export type StoreBuilder = ReturnType<typeof createStoreBuilder>

/** The page shape every list returns: cursors, no totals (FIRST-RELEASE §19). Defined by the first list on a builder. */
export const pageInfoType = (builder: StoreBuilder) =>
  builder.objectRef<PageInfo>('PageInfo').implement({
    fields: (t) => ({
      startCursor: t.exposeString('startCursor', { nullable: true }),
      endCursor: t.exposeString('endCursor', { nullable: true }),
      hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
      hasNextPage: t.exposeBoolean('hasNextPage'),
    }),
  })
