import { z } from 'zod'
import type { PageOf } from './allPages'
import { query } from './client'

// Settings › Riders (SetRiders, docs/api/DELIVERY.md §5, §8): the Owner's own delivery people.

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

const riderFields = 'id name phone status online currentDeliveryId deliveriesDone'
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

/** Newest first, fifty a page. */
export const loadRiders = async (after: string | null): Promise<PageOf<Rider>> =>
  (
    await query(
      `query R($after: String) { riders(first: 50, after: $after) { nodes { ${riderFields} } pageInfo { hasNextPage endCursor } } }`,
      z.object({ riders: z.object({ nodes: z.array(riderSchema), pageInfo: pageInfoSchema }) }),
      { after },
    )
  ).riders

/** Texts the number the store's delivery app link. */
export const inviteRider = async (name: string, phone: string): Promise<void> => {
  await query(`mutation I($n: String!, $p: String!) { inviteRider(name: $n, phone: $p) { id } }`, z.object({ inviteRider: z.object({ id: z.string() }) }), { n: name, p: phone })
}

export const resendRiderInvitation = async (id: string): Promise<void> => {
  await query('mutation R($id: ID!) { resendRiderInvitation(id: $id) }', z.object({ resendRiderInvitation: z.boolean() }), { id })
}

/** Signs them out at once; refused RIDER_HAS_PARCEL while they carry a parcel. */
export const suspendRider = async (id: string): Promise<void> => {
  await query('mutation S($id: ID!) { suspendRider(id: $id) { id } }', z.object({ suspendRider: z.object({ id: z.string() }) }), { id })
}

export const restoreRider = async (id: string): Promise<void> => {
  await query('mutation R($id: ID!) { restoreRider(id: $id) { id } }', z.object({ restoreRider: z.object({ id: z.string() }) }), { id })
}

/** The row stays for past deliveries; the phone is erased. Refused RIDER_HAS_PARCEL like suspend. */
export const removeRider = async (id: string): Promise<void> => {
  await query('mutation R($id: ID!) { removeRider(id: $id) }', z.object({ removeRider: z.boolean() }), { id })
}

const planSchema = z.object({
  planCatalogue: z.array(z.object({ current: z.boolean(), values: z.array(z.object({ key: z.string(), enabled: z.boolean().nullable() })) })).nullable(),
})

/** Whether the current plan has own delivery and the store's own apps (Owner only, like Settings), which list their tabs. The rider limit is the API's: PLAN_LIMIT on invite carries it. */
export interface RiderPlan {
  ownDelivery: boolean
  ownApps: boolean
}

export const loadRiderPlan = async (): Promise<RiderPlan> => {
  const { planCatalogue } = await query('{ planCatalogue { current values { key enabled } } }', planSchema)
  const values = planCatalogue?.find((p) => p.current)?.values ?? []
  const on = (key: string) => values.some((v) => v.key === key && v.enabled === true)
  return { ownDelivery: on('own_delivery'), ownApps: on('own_apps') }
}
