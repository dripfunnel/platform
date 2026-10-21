import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Orders (FIRST-RELEASE §6, PortalOrders; apps/api/schema/store.graphql, src/apis/store/orders.ts): the list, its chips
// and its export. A supplier's rows carry no total, payment or shopper.

export const orderFilters = ['ALL', 'TO_SHIP', 'PARTLY_SHIPPED', 'SHIPPED', 'CANCELLED_REFUNDED', 'PAYMENT_PENDING'] as const
export type OrderFilter = (typeof orderFilters)[number]

export const moneySchema = z.object({ amount: z.string(), currency: z.string() })
export type ApiMoney = z.infer<typeof moneySchema>

const summarySchema = z.object({
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
  // A supplier's own part: to_ship, sent_to_store, partly_shipped, shipped, delivered or cancelled.
  partState: z.string().nullable(),
  shippingMode: z.string().nullable(),
})
export type OrderSummary = z.infer<typeof summarySchema>

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() })

export interface OrderPage {
  rows: OrderSummary[]
  next: string | null
  previous: string | null
}

export const orderPageSize = 25

export const loadOrders = async (filter: OrderFilter, search: string, cursor: { after?: string | null; before?: string | null } = {}): Promise<OrderPage> => {
  const { orders } = await query(
    `query Orders($filter: OrderFilter, $search: String, $first: Int, $after: String, $before: String) {
      orders(filter: $filter, search: $search, first: $first, after: $after, before: $before) {
        nodes { id number placedAt state paymentState fulfilmentState paymentMethod total { amount currency } test customerName city items partState shippingMode }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    z.object({ orders: z.object({ nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
    { filter, search: search.trim() || null, first: orderPageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: orders.nodes, next: orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null, previous: orders.pageInfo.hasPreviousPage ? orders.pageInfo.startCursor : null }
}

const countsSchema = z.object({ all: z.number(), toShip: z.number(), partlyShipped: z.number(), shipped: z.number(), cancelledRefunded: z.number(), paymentPending: z.number() })
export type OrderCounts = z.infer<typeof countsSchema>

export const loadOrderCounts = async (): Promise<OrderCounts> =>
  (await query('{ orderCounts { all toShip partlyShipped shipped cancelledRefunded paymentPending } }', z.object({ orderCounts: countsSchema }))).orderCounts

/** The store's own zone, the one the list's times are in (FIRST-RELEASE §6); a supplier reads no store settings. */
export const loadStoreTimeZone = async (): Promise<string | null> =>
  (await query('{ storeInfo { timeZone } }', z.object({ storeInfo: z.object({ timeZone: z.string() }).nullable() }))).storeInfo?.timeZone ?? null

export const loadOrderExport = async (id: string): Promise<ExportJob | null> =>
  readExportJob((await query(`query E($id: ID!) { orderExport(id: $id) { ${exportJobFields} } }`, z.object({ orderExport: exportJobSchema.nullable() }), { id })).orderExport)

/** The list as it's filtered and searched, as a job the shell's watcher follows. */
export const requestOrderExport = async (filter: OrderFilter, search: string): Promise<ExportJob> => {
  const { exportOrders: id } = await query('mutation E($f: OrderFilter, $s: String) { exportOrders(filter: $f, search: $s) }', z.object({ exportOrders: z.string() }), { f: filter, s: search.trim() || null })
  return { id, state: 'preparing', entries: null, url: null, expiresAt: null }
}
