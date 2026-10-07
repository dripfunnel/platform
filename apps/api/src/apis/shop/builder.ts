import SchemaBuilder from '@pothos/core'
import type { PageInfo } from '#core/paging'
import type { ShopContext } from './access'

/** One builder for the Shop API; each area file adds its types and fields to it (api/README.md §3). */
export const createShopBuilder = () => {
  const builder = new SchemaBuilder<{ Context: ShopContext }>({})
  builder.queryType({})
  const pageInfo = builder.objectRef<PageInfo>('PageInfo').implement({
    fields: (t) => ({
      startCursor: t.exposeString('startCursor', { nullable: true }),
      endCursor: t.exposeString('endCursor', { nullable: true }),
      hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
      hasNextPage: t.exposeBoolean('hasNextPage'),
    }),
  })
  const image = builder.objectRef<{ id: string; url: string }>('Image').implement({
    fields: (t) => ({ id: t.exposeID('id'), url: t.exposeString('url') }),
  })
  return { builder, pageInfo, image }
}

export type ShopBuilder = ReturnType<typeof createShopBuilder>
