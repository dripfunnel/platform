import { z } from 'zod'
import type { PageOf } from './allPages'
import { query } from './client'

// Settings › Riders (SetRiders, docs/api/DELIVERY.md §5, §8): the Owner's own delivery people; read only in this part of #844.

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

const planSchema = z.object({
  planCatalogue: z.array(z.object({ current: z.boolean(), values: z.array(z.object({ key: z.string(), enabled: z.boolean().nullable() })) })).nullable(),
})

/** Whether the current plan has own delivery (Owner only, like Settings). The rider limit is the API's: PLAN_LIMIT on invite carries it. */
export interface RiderPlan {
  ownDelivery: boolean
}

export const loadRiderPlan = async (): Promise<RiderPlan> => {
  const { planCatalogue } = await query('{ planCatalogue { current values { key enabled } } }', planSchema)
  const values = planCatalogue?.find((p) => p.current)?.values ?? []
  return { ownDelivery: values.some((v) => v.key === 'own_delivery' && v.enabled === true) }
}
