import { z } from 'zod'
import { pageInfoSchema, typedQuery, type ApiClient } from '../graphql'
import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from './exportJob'

// The Orders list on the Store API (FIRST-RELEASE.md §6, PortalOrders; apps/api src/apis/store/orders.ts): rows, the chips' counts and the
// export. Amounts arrive as digit strings of minor units. A supplier's To ship is MA 13 (#506), so only the merchant side is read here.

export const orderFilters = ['ALL', 'TO_SHIP', 'PARTLY_SHIPPED', 'SHIPPED', 'CANCELLED_REFUNDED', 'PAYMENT_PENDING'] as const
export type OrderFilter = (typeof orderFilters)[number]

export const moneySchema = z.object({ amount: z.string().regex(/^-?\d+$/), currency: z.string() })
export type ApiMoney = z.infer<typeof moneySchema>

const rowSchema = z.object({
  id: z.string(),
  number: z.string(),
  placedAt: z.string(),
  state: z.string(),
  paymentState: z.string().nullable(),
  fulfilmentState: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  total: moneySchema.nullable(),
  test: z.boolean().nullable(),
  customerName: z.string().nullable(),
  city: z.string().nullable(),
  items: z.number().int(),
})
export type OrderRow = z.infer<typeof rowSchema>

export type OrderQuery = { filter: OrderFilter; search: string }

const orderPageSize = 25

/** One page of the API's list; `after` pages on. Filtering and searching are the API's, never done here. */
export const loadOrders = async (client: ApiClient, { filter, search }: OrderQuery, after: string | null = null): Promise<{ rows: OrderRow[]; next: string | null }> => {
  const { orders } = await typedQuery(client)(
    `query Orders($filter: OrderFilter, $search: String, $first: Int, $after: String) {
      orders(filter: $filter, search: $search, first: $first, after: $after) {
        nodes { id number placedAt state paymentState fulfilmentState paymentMethod total { amount currency } test customerName city items }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    z.object({ orders: z.object({ nodes: z.array(rowSchema), pageInfo: pageInfoSchema }) }),
    { filter, search: search.trim() || null, first: orderPageSize, after },
  )
  return { rows: orders.nodes, next: orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null }
}

const countsSchema = z.object({ all: z.number(), toShip: z.number(), partlyShipped: z.number(), shipped: z.number(), cancelledRefunded: z.number(), paymentPending: z.number() })
export type OrderCounts = z.infer<typeof countsSchema>

export const loadOrderCounts = async (client: ApiClient): Promise<OrderCounts> =>
  (await typedQuery(client)('{ orderCounts { all toShip partlyShipped shipped cancelledRefunded paymentPending } }', z.object({ orderCounts: countsSchema }))).orderCounts

/** The list as it is filtered and searched, as a job to read back with `loadOrderExport`; answers the job's id. */
export const requestOrderExport = async (client: ApiClient, { filter, search }: OrderQuery): Promise<string> =>
  (await typedQuery(client)('mutation ExportOrders($filter: OrderFilter, $search: String) { exportOrders(filter: $filter, search: $search) }', z.object({ exportOrders: z.string() }), { filter, search: search.trim() || null })).exportOrders

export const loadOrderExport = async (client: ApiClient, id: string): Promise<ExportJob | null> =>
  readExportJob((await typedQuery(client)(`query OrderExport($id: ID!) { orderExport(id: $id) { ${exportJobFields} } }`, z.object({ orderExport: exportJobSchema.nullable() }), { id })).orderExport)
