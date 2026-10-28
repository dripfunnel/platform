import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Riders (SetRiders; docs/api/DELIVERY.md §5, §8): the Owner's own delivery people, with `riders.manage`.

export const riderStatuses = ['invited', 'active', 'suspended'] as const
export type RiderStatus = (typeof riderStatuses)[number]

const riderSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  status: z.enum(riderStatuses),
  online: z.boolean(),
  currentDeliveryId: z.string().nullable(),
  deliveriesDone: z.number().int(),
})
export type Rider = z.infer<typeof riderSchema>

/** Newest first. */
export const loadRiders = (client: ApiClient): Promise<Rider[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          'query Riders($after: String) { riders(first: 50, after: $after) { nodes { id name phone status online currentDeliveryId deliveriesDone } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
          z.object({ riders: z.object({ nodes: z.array(riderSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).riders,
  )

/** Texts the number the store's delivery app link. */
export const inviteRider = async (client: ApiClient, name: string, phone: string): Promise<void> => {
  await typedQuery(client)('mutation InviteRider($n: String!, $p: String!) { inviteRider(name: $n, phone: $p) { id } }', z.object({ inviteRider: z.object({ id: z.string() }) }), { n: name, p: phone })
}

export const resendRiderInvitation = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation ResendRider($id: ID!) { resendRiderInvitation(id: $id) }', z.object({ resendRiderInvitation: z.boolean() }), { id })
}

/** Signs them out at once; refused `RIDER_HAS_PARCEL` while they carry a parcel. */
export const suspendRider = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation SuspendRider($id: ID!) { suspendRider(id: $id) { id } }', z.object({ suspendRider: z.object({ id: z.string() }) }), { id })
}

export const restoreRider = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation RestoreRider($id: ID!) { restoreRider(id: $id) { id } }', z.object({ restoreRider: z.object({ id: z.string() }) }), { id })
}

/** The row stays for past deliveries and the phone is erased; refused `RIDER_HAS_PARCEL` like a suspend. */
export const removeRider = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation RemoveRider($id: ID!) { removeRider(id: $id) }', z.object({ removeRider: z.boolean() }), { id })
}

const planSchema = z.object({
  planCatalogue: z.array(z.object({ current: z.boolean(), values: z.array(z.object({ key: z.string(), enabled: z.boolean().nullable() })) })).nullable(),
})

/** Whether the current plan has own delivery; the rider limit is the API's (`PLAN_LIMIT` on an invite). */
export const loadOwnDeliveryPlan = async (client: ApiClient): Promise<boolean> => {
  const { planCatalogue } = await typedQuery(client)('{ planCatalogue { current values { key enabled } } }', planSchema)
  return (planCatalogue?.find((plan) => plan.current)?.values ?? []).some((value) => value.key === 'own_delivery' && value.enabled === true)
}
