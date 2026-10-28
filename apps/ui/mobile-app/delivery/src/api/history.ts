import { z } from 'zod'
import { decode, pageInfoSchema, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Written from apps/api/schema/delivery.graphql: a rider's past deliveries and the counts above them (docs/api/DELIVERY.md §4).
// No customer details and no pay: the fee is what the customer paid.
const pastSchema = z.object({
  id: z.string(),
  state: z.enum(['delivered', 'failed']),
  failedReason: z.string().nullable(),
  area: z.string().nullable(),
  warehouse: z.object({ name: z.string().nullable() }).nullable(),
  deliveredAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  feeAmount: z.string().nullable(),
  currency: z.string().nullable(),
})
export type PastDelivery = z.infer<typeof pastSchema>

export type HistoryPage = { deliveredToday: number; deliveredThisWeek: number; deliveries: PastDelivery[]; endCursor: string | null; hasNextPage: boolean }

/** The list's page size: 20, with Show more for the rest (docs/mobile-app/delivery/FIRST-RELEASE.md §2). */
export const historyPageSize = 20

/** Delivered, not delivered and recalled, newest first; a cancelled delivery never reached the rider. */
export const fetchHistory = async (client: ApiClient, after: string | null = null): Promise<HistoryPage> => {
  const { deliveries } = decode(
    z.object({
      deliveries: z.object({
        deliveredToday: z.number().nullable(),
        deliveredThisWeek: z.number().nullable(),
        nodes: z.array(pastSchema),
        pageInfo: pageInfoSchema,
      }),
    }),
    await client.request<unknown>(
      'query($state: [DeliveryState!], $first: Int, $after: String) { deliveries(state: $state, first: $first, after: $after) { deliveredToday deliveredThisWeek nodes { id state failedReason area warehouse { name } deliveredAt failedAt feeAmount currency } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } } }',
      { state: ['delivered', 'failed'], first: historyPageSize, after },
    ),
  )
  return {
    deliveredToday: deliveries.deliveredToday ?? 0,
    deliveredThisWeek: deliveries.deliveredThisWeek ?? 0,
    deliveries: deliveries.nodes,
    endCursor: deliveries.pageInfo.endCursor,
    hasNextPage: deliveries.pageInfo.hasNextPage,
  }
}
