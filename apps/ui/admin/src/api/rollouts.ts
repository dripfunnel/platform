// Core rollouts on the Admin API (CONSOLE-DESIGN L2, SAAS §10): the Rollouts list, one rollout's stores, and
// start, pause, resume and roll back, each with a reason the API audits.
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import type { StaffRole } from '../features/shell/staffRoles'
import { query } from './client'
import { isoString, pageInfoSchema } from './decode'

export const rolloutStates = ['canary', 'waves', 'paused', 'done', 'rolled_back'] as const
export type RolloutState = (typeof rolloutStates)[number]

export const storeUpgradeStates = ['pending', 'running', 'passed', 'migrated', 'pinned', 'baseline', 'live', 'reverted'] as const
export type StoreUpgradeState = (typeof storeUpgradeStates)[number]

export const rolloutActions = ['pause', 'resume', 'rollBack'] as const
export type RolloutAction = (typeof rolloutActions)[number]

// fleet.read and fleet.manage are held by the same two roles (ACCESS §5.4); the API is the check.
export const fleetReaders: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']
export const fleetManagers: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']

const rolloutSchema = z.object({
  id: z.string(),
  version: z.string(),
  security: z.boolean(),
  state: z.enum(rolloutStates),
  percent: z.number().int().min(0).max(100),
  reason: z.string(),
  startedAt: isoString,
  finishedAt: isoString.nullable(),
  stores: z.array(z.object({ state: z.enum(storeUpgradeStates), count: z.number().int().nonnegative() })),
})
export type Rollout = z.infer<typeof rolloutSchema>

const storeSchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  storeCode: z.string(),
  partnerName: z.string(),
  canary: z.boolean(),
  fromVersion: z.string(),
  state: z.enum(storeUpgradeStates),
  error: z.string().nullable(),
  startedAt: isoString.nullable(),
  finishedAt: isoString.nullable(),
})
export type RolloutStore = z.infer<typeof storeSchema>

export interface RolloutPage {
  items: readonly Rollout[]
  pageInfo: PageInfo
}

export interface RolloutDetail {
  rollout: Rollout
  stores: { items: readonly RolloutStore[]; pageInfo: PageInfo }
}

const rolloutFields = 'id version security state percent reason startedAt finishedAt stores { state count }'
const pageInfoFields = 'pageInfo { startCursor endCursor hasPreviousPage hasNextPage }'

export const rolloutPageSize = 25

// `caller` only spares a role the API would refuse the round trip: it gets the page's no-access view.
export const loadRollouts = async (page: Pick<PageRequest, 'after'>, caller: StaffRole): Promise<RolloutPage | null> => {
  if (!fleetReaders.includes(caller)) return null
  const { coreRollouts } = await query(
    `query Rollouts($after: String) { coreRollouts(after: $after) { items { ${rolloutFields} } ${pageInfoFields} } }`,
    z.object({ coreRollouts: z.object({ items: z.array(rolloutSchema), pageInfo: pageInfoSchema }) }),
    { after: page.after },
  )
  return coreRollouts
}

// Null for a rollout the API doesn't know; `caller` as for the list.
export const loadRollout = async (id: string, filter: { state?: StoreUpgradeState | undefined }, page: PageRequest, caller: StaffRole): Promise<RolloutDetail | null | 'denied'> => {
  if (!fleetReaders.includes(caller)) return 'denied'
  const { coreRollout, coreRolloutStores } = await query(
    `query Rollout($id: ID!, $state: CoreRolloutStoreState, $after: String, $before: String) {
      coreRollout(id: $id) { ${rolloutFields} }
      coreRolloutStores(id: $id, state: $state, after: $after, before: $before) {
        items { storeId storeName storeCode partnerName canary fromVersion state error startedAt finishedAt } ${pageInfoFields}
      }
    }`,
    z.object({ coreRollout: rolloutSchema.nullable(), coreRolloutStores: z.object({ items: z.array(storeSchema), pageInfo: pageInfoSchema }).nullable() }),
    { id, state: filter.state, after: page.after, before: page.before },
  )
  return coreRollout && coreRolloutStores ? { rollout: coreRollout, stores: coreRolloutStores } : null
}

// The rollout another start ran into: the one running or paused, if it is on the first page.
export const activeRollout = (page: RolloutPage | null): Rollout | null =>
  page?.items.find((r) => r.state === 'canary' || r.state === 'waves' || r.state === 'paused') ?? null

// Which steer the API takes in each state (apps/api saas/fleet/admin.ts).
export const actionsFor = (state: RolloutState): readonly RolloutAction[] => {
  if (state === 'canary' || state === 'waves') return ['pause', 'rollBack']
  if (state === 'paused') return ['resume', 'rollBack']
  if (state === 'done') return ['rollBack']
  return []
}

const answer = z.object({ id: z.string(), state: z.enum(rolloutStates) })
const mutationField = { pause: 'pauseCoreRollout', resume: 'resumeCoreRollout', rollBack: 'rollBackCoreRollout' } as const

export const steerRollout = async (action: RolloutAction, id: string, reason: string): Promise<void> => {
  const field = mutationField[action]
  await query(`mutation Steer($id: ID!, $reason: String!) { ${field}(id: $id, reason: $reason) { id state } }`, z.object({ [field]: answer }), { id, reason })
}

export const startRollout = async (input: { version: string; security: boolean; reason: string }): Promise<string> => {
  const { startCoreRollout } = await query(
    `mutation Start($version: String!, $security: Boolean!, $reason: String!) { startCoreRollout(version: $version, security: $security, reason: $reason) { id state } }`,
    z.object({ startCoreRollout: answer }),
    input,
  )
  return startCoreRollout.id
}

// The codes start and the steers refuse with (apps/api saas/fleet/admin.ts FleetRefusal), each worded by the screens.
export const rolloutRefusals = ['INVALID_INPUT', 'NOT_FOUND', 'ROLLOUT_ACTIVE', 'WRONG_STATE', 'FORBIDDEN'] as const
export type RolloutRefusal = (typeof rolloutRefusals)[number]
