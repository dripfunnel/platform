import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { addressSchema, shipmentSchema } from './order'
import { moneySchema, type OrderQuery } from './orders'

// A supplier's own screens on the Store API as it is (FIRST-RELEASE (store) §17, ACCESS.md §7; apps/api src/apis/store/orders.ts, supplierTeam.ts): its part of
// an order, its sold lines and its team. The query for a part asks for no money, no payment and no contact, and shows what comes back.

const lineSchema = z.object({
  id: z.string(),
  name: z.string(),
  versionName: z.string().nullable(),
  quantity: z.number().int(),
  fulfilledQuantity: z.number().int(),
  sentToStoreQuantity: z.number().int(),
})
export type SupplierLine = z.infer<typeof lineSchema>

const partSchema = z.object({
  id: z.string(),
  // to-store (the supplier hands its lines to the store) or to-shopper (it ships them), as the order was placed.
  shippingMode: z.string(),
  state: z.string(),
  lines: z.array(lineSchema),
})
export type SupplierPart = z.infer<typeof partSchema>

const orderSchema = z.object({
  id: z.string(),
  number: z.string(),
  state: z.string(),
  placedAt: z.string(),
  // Only on a to-shopper part: the name and the delivery address, never the email or the phone (ACCESS.md §7.3).
  customerName: z.string().nullable(),
  shippingAddress: addressSchema.nullable(),
  parts: z.array(partSchema),
  shipments: z.array(shipmentSchema),
})
export type SupplierOrder = z.infer<typeof orderSchema>

const orderFields = `id number state placedAt customerName
  shippingAddress { name line1 line2 city region postalCode country }
  parts { id shippingMode state lines { id name versionName quantity fulfilledQuantity sentToStoreQuantity } }
  shipments { id kind supplierId warehouseName courierName trackingNumber trackingUrl shippedAt pickupRequestedAt lines { lineId quantity } }`

/** The supplier's part of the order, or null when it isn't there or isn't this supplier's: the two look the same (ACCESS.md §11). */
export const loadSupplierOrder = async (client: ApiClient, id: string): Promise<SupplierOrder | null> =>
  (await typedQuery(client)(`query SupplierOrder($id: ID!) { order(id: $id) { ${orderFields} } }`, z.object({ order: orderSchema.nullable() }), { id })).order

const orderRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  placedAt: z.string(),
  state: z.string(),
  // Only on a to-shopper part (ACCESS.md §7.3); the API answers null for a to-store one.
  customerName: z.string().nullable(),
  city: z.string().nullable(),
  items: z.number().int(),
  // The supplier's part of the order and the mode it was placed under: to-store or to-shopper.
  partState: z.string().nullable(),
  shippingMode: z.string().nullable(),
})
export type SupplierOrderRow = z.infer<typeof orderRowSchema>

const orderPageSize = 25

/** One page of the supplier's parts, as the API filters and searches them; `after` pages on. Asks for no money, payment or contact. */
export const loadSupplierOrders = async (client: ApiClient, { filter, search }: OrderQuery, after: string | null = null): Promise<{ rows: SupplierOrderRow[]; next: string | null }> => {
  const { orders } = await typedQuery(client)(
    `query SupplierOrders($filter: OrderFilter, $search: String, $first: Int, $after: String) {
      orders(filter: $filter, search: $search, first: $first, after: $after) {
        nodes { id number placedAt state customerName city items partState shippingMode }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    z.object({ orders: z.object({ nodes: z.array(orderRowSchema), pageInfo: pageInfoSchema }) }),
    { filter, search: search.trim() || null, first: orderPageSize, after },
  )
  return { rows: orders.nodes, next: orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null }
}

const placeSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })
export type SupplierPlace = z.infer<typeof placeSchema>

/** The supplier's own locations: the API answers a supplier no others. */
export const loadSupplierPlaces = (client: ApiClient): Promise<SupplierPlace[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          'query ShipFrom($after: String) { warehouses(first: 50, after: $after) { nodes { id name isDefault } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
          z.object({ warehouses: z.object({ nodes: z.array(placeSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).warehouses,
  )

/** The supplier's own name, for the words that say whose team and sales these are; null when the API doesn't say. */
export const loadSupplierName = async (client: ApiClient): Promise<string | null> =>
  (await typedQuery(client)('{ me { acting { seller { name } } } }', z.object({ me: z.object({ acting: z.object({ seller: z.object({ name: z.string() }).nullable() }).nullable() }) }))).me.acting?.seller?.name ?? null

const saleSchema = z.object({
  lineId: z.string(),
  orderNumber: z.string(),
  placedAt: z.string(),
  // placed or cancelled: the order's, not the supplier's part's.
  orderState: z.string(),
  name: z.string(),
  versionName: z.string().nullable(),
  quantity: z.number().int(),
  refundedQuantity: z.number().int(),
  // At the price sold, before the order's discount and tax.
  amount: moneySchema,
})
export type Sale = z.infer<typeof saleSchema>

const salePageSize = 25

/** One page of the supplier's sold lines, newest first; `after` pages on. */
export const loadMySales = async (client: ApiClient, after: string | null = null): Promise<{ rows: Sale[]; next: string | null }> => {
  const { mySales } = await typedQuery(client)(
    `query Sales($first: Int, $after: String) {
      mySales(first: $first, after: $after) {
        nodes { lineId orderNumber placedAt orderState name versionName quantity refundedQuantity amount { amount currency } }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    z.object({ mySales: z.object({ nodes: z.array(saleSchema), pageInfo: pageInfoSchema }) }),
    { first: salePageSize, after },
  )
  return { rows: mySales.nodes, next: mySales.pageInfo.hasNextPage ? mySales.pageInfo.endCursor : null }
}

export const teamRoles = ['supplier-admin', 'supplier-member'] as const
export type TeamRole = (typeof teamRoles)[number]

const teammateSchema = z.object({
  id: z.string(),
  kind: z.enum(['member', 'invitation']),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(teamRoles),
  you: z.boolean(),
  lastAdmin: z.boolean(),
  since: z.string(),
  expiresAt: z.string().nullable(),
  expired: z.boolean(),
})
export type Teammate = z.infer<typeof teammateSchema>

/** Everyone on the team and every invitation waiting: a team is small, so the screen reads it whole. A member's id is its membership's, an invitation's its own. */
export const loadMyTeam = (client: ApiClient): Promise<Teammate[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          'query Team($after: String) { mySupplierTeam(first: 50, after: $after) { nodes { id kind name email role you lastAdmin since expiresAt expired } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
          z.object({ mySupplierTeam: z.object({ nodes: z.array(teammateSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).mySupplierTeam,
  )

/** Answered as for any address (ACCESS.md §7.5), so the app says "sent" either way. */
export const inviteTeammate = async (client: ApiClient, email: string, role: TeamRole): Promise<void> => {
  await typedQuery(client)('mutation InviteTeammate($e: String!, $r: String!) { inviteSupplierUser(email: $e, role: $r) }', z.object({ inviteSupplierUser: z.string().nullable() }), { e: email, r: role })
}

export const resendTeamInvitation = async (client: ApiClient, invitationId: string): Promise<void> => {
  await typedQuery(client)('mutation ResendTeamInvitation($id: ID!) { resendSupplierInvitation(invitationId: $id) }', z.object({ resendSupplierInvitation: z.string().nullable() }), { id: invitationId })
}

export const revokeTeamInvitation = async (client: ApiClient, invitationId: string): Promise<void> => {
  await typedQuery(client)('mutation RevokeTeamInvitation($id: ID!) { revokeSupplierInvitation(invitationId: $id) }', z.object({ revokeSupplierInvitation: z.boolean() }), { id: invitationId })
}

/** Refused for the last admin (`LAST_ADMIN`). */
export const changeTeamRole = async (client: ApiClient, membershipId: string, role: TeamRole): Promise<void> => {
  await typedQuery(client)('mutation ChangeTeamRole($id: ID!, $r: String!) { changeSupplierRole(membershipId: $id, role: $r) }', z.object({ changeSupplierRole: z.boolean() }), { id: membershipId, r: role })
}

/** Out of this supplier at once; refused for the last admin (`LAST_ADMIN`). */
export const removeTeammate = async (client: ApiClient, membershipId: string): Promise<void> => {
  await typedQuery(client)('mutation RemoveTeammate($id: ID!) { removeSupplierUser(membershipId: $id) }', z.object({ removeSupplierUser: z.boolean() }), { id: membershipId })
}
