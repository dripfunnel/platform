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

const pageInfos = new WeakMap<StoreBuilder, ReturnType<typeof definePageInfo>>()

const definePageInfo = (builder: StoreBuilder) =>
  builder.objectRef<PageInfo>('PageInfo').implement({
    fields: (t) => ({
      startCursor: t.exposeString('startCursor', { nullable: true }),
      endCursor: t.exposeString('endCursor', { nullable: true }),
      hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
      hasNextPage: t.exposeBoolean('hasNextPage'),
    }),
  })

/** The page shape every list returns: cursors, no totals (FIRST-RELEASE §19). One per builder, however many areas ask. */
export const pageInfoType = (builder: StoreBuilder) => {
  const known = pageInfos.get(builder)
  if (known) return known
  const made = definePageInfo(builder)
  pageInfos.set(builder, made)
  return made
}

export interface Money {
  amount: string
  currency: string
}

const moneys = new WeakMap<StoreBuilder, ReturnType<typeof defineMoney>>()

const defineMoney = (builder: StoreBuilder) =>
  builder.objectRef<Money>('Money').implement({
    // Minor units as a string: GraphQL's Int is 32-bit and a price may pass it (DATA-MODEL §7.1).
    fields: (t) => ({ amount: t.exposeString('amount'), currency: t.exposeString('currency') }),
  })

/** Money as every area answers it, one type per builder. */
export const moneyType = (builder: StoreBuilder) => {
  const known = moneys.get(builder)
  if (known) return known
  const made = defineMoney(builder)
  moneys.set(builder, made)
  return made
}
