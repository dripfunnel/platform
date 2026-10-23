import SchemaBuilder from '@pothos/core'
import type { DeliveryContext } from './access'

/** One builder for the Delivery API; each area file adds its types and fields to it (api/README.md §3). */
export const createDeliveryBuilder = () => {
  const builder = new SchemaBuilder<{ Context: DeliveryContext }>({})
  builder.queryType({})
  builder.mutationType({})
  return builder
}

export type DeliveryBuilder = ReturnType<typeof createDeliveryBuilder>
