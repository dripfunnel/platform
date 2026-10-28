import { z } from 'zod'
import { decode, pageInfoSchema, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Written from apps/api/schema/delivery.graphql: offers, being Online and the rider's current delivery (docs/api/DELIVERY.md §3, §4).
const offerSchema = z.object({
  id: z.string(),
  deliveryId: z.string(),
  warehouse: z.string().nullable(),
  area: z.string().nullable(),
  distanceM: z.number().nullable(),
  itemCount: z.number().nullable(),
  expiresAt: z.string(),
})
export type Offer = z.infer<typeof offerSchema>

export type OfferPage = { offers: Offer[]; endCursor: string | null; hasNextPage: boolean }

/** The offers' page size: 20, with Show more for the rest (docs/api/DELIVERY.md §4). */
export const offersPageSize = 20

export const fetchOffers = async (client: ApiClient, after: string | null = null): Promise<OfferPage> => {
  const { offers } = decode(
    z.object({ offers: z.object({ nodes: z.array(offerSchema), pageInfo: pageInfoSchema }) }),
    await client.request<unknown>('query($first: Int, $after: String) { offers(first: $first, after: $after) { nodes { id deliveryId warehouse area distanceM itemCount expiresAt } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } } }', { first: offersPageSize, after }),
  )
  return { offers: offers.nodes, endCursor: offers.pageInfo.endCursor, hasNextPage: offers.pageInfo.hasNextPage }
}

/** Refused `TAKEN` when another rider was first, `ON_DELIVERY` while this rider has a delivery, `OFFLINE` when not online. */
export const acceptOffer = async (client: ApiClient, id: string): Promise<void> => {
  await client.request('mutation($id: ID!) { acceptOffer(id: $id) }', { id })
}

export const declineOffer = async (client: ApiClient, id: string): Promise<void> => {
  await client.request('mutation($id: ID!) { declineOffer(id: $id) }', { id })
}

const currentSchema = z.object({
  id: z.string(),
  state: z.enum(['assigned', 'picked_up']),
  area: z.string().nullable(),
  warehouse: z.object({ name: z.string().nullable() }).nullable(),
})
export type CurrentDelivery = z.infer<typeof currentSchema>

/** The delivery the rider is on: picked up first, else the oldest assigned (docs/api/DELIVERY.md §3). Null when there is none; `hidden` are ones already done on the phone. */
export const fetchCurrentDelivery = async (client: ApiClient, hidden: ReadonlySet<string> = new Set()): Promise<CurrentDelivery | null> => {
  const { deliveries } = decode(
    z.object({ deliveries: z.object({ nodes: z.array(z.unknown()) }) }),
    await client.request<unknown>('query($state: [DeliveryState!]) { deliveries(state: $state, first: 20) { nodes { id state area warehouse { name } } } }', { state: ['assigned', 'picked_up'] }),
  )
  const current = deliveries.nodes.map((node) => decode(currentSchema, node)).filter((delivery) => !hidden.has(delivery.id))
  return current.find((delivery) => delivery.state === 'picked_up') ?? current[0] ?? null
}

/** Being available for offers. Refused `RIDER_HAS_PARCEL` going offline after pickup. */
export const setOnline = async (client: ApiClient, online: boolean): Promise<void> => {
  await client.request('mutation($online: Boolean!) { setOnline(online: $online) }', { online })
}

export type Position = { lat: number; lng: number; accuracy: number; at: string }

/** The latest point only: the API keeps one row per rider and a trail is never kept (docs/api/DELIVERY.md §7). */
export const reportPosition = async (client: ApiClient, { lat, lng, accuracy, at }: Position): Promise<void> => {
  await client.request('mutation($lat: Float!, $lng: Float!, $accuracy: Float!, $at: String!) { reportPosition(lat: $lat, lng: $lng, accuracy: $accuracy, at: $at) }', { lat, lng, accuracy, at })
}

export type PushPlatform = 'ios' | 'android'

export const registerPushDevice = async (client: ApiClient, token: string, platform: PushPlatform): Promise<void> => {
  await client.request('mutation($token: String!, $platform: PushPlatform!) { registerPushDevice(token: $token, platform: $platform) }', { token, platform })
}

export const unregisterPushDevice = async (client: ApiClient, token: string): Promise<void> => {
  await client.request('mutation($token: String!) { unregisterPushDevice(token: $token) }', { token })
}
