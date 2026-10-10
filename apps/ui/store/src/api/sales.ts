import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// Your sales (VendorViews, FIRST-RELEASE §17; `mySales` in apps/api/schema/store.graphql): a supplier's own sold lines,
// newest first, at the price sold before the order's discount and tax, with no totals.

const saleSchema = z.object({
  lineId: z.string(),
  orderNumber: z.string(),
  placedAt: z.string(),
  // placed or cancelled: the order's, not the supplier's part's.
  orderState: z.string(),
  name: z.string(),
  versionName: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().int(),
  refundedQuantity: z.number().int(),
  amount: moneySchema,
})
export type Sale = z.infer<typeof saleSchema>

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() })

export interface SalePage {
  rows: Sale[]
  next: string | null
  previous: string | null
}

export const salePageSize = 25

export const loadMySales = async (cursor: { after?: string | null; before?: string | null } = {}): Promise<SalePage> => {
  const { mySales } = await query(
    `query Sales($first: Int, $after: String, $before: String) {
      mySales(first: $first, after: $after, before: $before) {
        nodes { lineId orderNumber placedAt orderState name versionName sku quantity refundedQuantity amount { amount currency } }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    z.object({ mySales: z.object({ nodes: z.array(saleSchema), pageInfo: pageInfoSchema }) }),
    { first: salePageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: mySales.nodes, next: mySales.pageInfo.hasNextPage ? mySales.pageInfo.endCursor : null, previous: mySales.pageInfo.hasPreviousPage ? mySales.pageInfo.startCursor : null }
}
