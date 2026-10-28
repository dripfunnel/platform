import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Written from apps/api/schema/delivery.graphql: one delivery and the steps that carry it to the door (docs/api/DELIVERY.md §3, §4).
const addressSchema = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
})
export type Address = z.infer<typeof addressSchema>

const pinSchema = { latitude: z.number().nullable(), longitude: z.number().nullable() }

const deliverySchema = z.object({
  id: z.string(),
  state: z.enum(['assigned', 'picked_up', 'delivered', 'failed', 'cancelled', 'packing', 'searching', 'unassigned']),
  area: z.string().nullable(),
  failedReason: z.string().nullable(),
  currency: z.string().nullable(),
  cashDueAmount: z.string().nullable(),
  warehouse: z.object({ name: z.string().nullable(), address: addressSchema.nullable(), ...pinSchema }).nullable(),
  lines: z.array(z.object({ name: z.string().nullable(), versionName: z.string().nullable(), quantity: z.number().nullable() })).nullable(),
  customer: z.object({ name: z.string().nullable(), phone: z.string().nullable(), address: addressSchema.nullable(), note: z.string().nullable(), ...pinSchema }).nullable(),
})
export type RiderDelivery = z.infer<typeof deliverySchema>

const fields = `id state area failedReason currency cashDueAmount
  warehouse { name latitude longitude address { line1 line2 city region postalCode country } }
  lines { name versionName quantity }
  customer { name phone note latitude longitude address { line1 line2 city region postalCode country } }`

/** One of this rider's deliveries; the customer's details come only once it is picked up and still theirs. Null when it is not theirs. */
export const fetchDelivery = async (client: ApiClient, id: string): Promise<RiderDelivery | null> => {
  const { delivery } = decode(z.object({ delivery: deliverySchema.nullable() }), await client.request<unknown>(`query($id: ID!) { delivery(id: $id) { ${fields} } }`, { id }))
  return delivery
}

/** Refused `NOT_ASSIGNED` when it is not this rider's to hand back. */
export const handBack = async (client: ApiClient, id: string): Promise<void> => {
  await client.request('mutation($id: ID!) { handBack(id: $id) }', { id })
}

/** Refused `NOT_ASSIGNED`, `NOT_ENOUGH_STOCK` or `NOT_HANDED_OVER`. */
export const markPickedUp = async (client: ApiClient, id: string): Promise<void> => {
  await client.request('mutation($id: ID!) { markPickedUp(id: $id) }', { id })
}

export type Step = { at: string; key: string }

/** Refused `WRONG_CODE`, `CODE_LOCKED`, `CASH_NOT_CONFIRMED`, `NOT_PICKED_UP` or `CODE_UNCONFIRMED`. A resend with the same `key` does nothing twice. */
export const markDelivered = async (client: ApiClient, id: string, { code, cashCollected, at, key }: Step & { code: string; cashCollected: boolean | null }): Promise<void> => {
  await client.request('mutation($id: ID!, $code: String!, $cashCollected: Boolean, $at: String!, $key: String!) { markDelivered(id: $id, code: $code, cashCollected: $cashCollected, at: $at, key: $key) }', { id, code, cashCollected, at, key })
}

export type NotDeliveredReason = 'no_one_home' | 'refused' | 'wrong_address'

export const markFailed = async (client: ApiClient, id: string, { reason, at, key }: Step & { reason: NotDeliveredReason }): Promise<void> => {
  await client.request('mutation($id: ID!, $reason: NotDeliveredReason!, $at: String!, $key: String!) { markFailed(id: $id, reason: $reason, at: $at, key: $key) }', { id, reason, at, key })
}
