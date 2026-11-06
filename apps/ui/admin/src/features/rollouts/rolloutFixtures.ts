import type { Rollout, RolloutDetail, RolloutPage, RolloutStore } from '../../api/rollouts'

const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }

export const rolloutOf = (over: Partial<Rollout> = {}): Rollout => ({
  id: 'f477af24-ed09-47c7-b649-710a098fa2fe',
  version: '0.8.1',
  security: false,
  state: 'paused',
  percent: 0,
  reason: 'Release promoted (SAAS §10)',
  startedAt: '2026-11-02T06:30:47.699Z',
  finishedAt: null,
  stores: [
    { state: 'live', count: 1 },
    { state: 'pinned', count: 3 },
  ],
  ...over,
})

export const storeOf = (over: Partial<RolloutStore> = {}): RolloutStore => ({
  storeId: '02bb1673-31b8-4025-8625-c82cf5ccb9ac',
  storeName: 'Jaipur Looms',
  storeCode: 'jaipur-looms',
  partnerName: 'Dripfunnel',
  canary: true,
  fromVersion: '0.6.1',
  state: 'pinned',
  error: 'gate_failed',
  startedAt: '2026-11-02T06:31:00.000Z',
  finishedAt: '2026-11-02T06:40:00.000Z',
  ...over,
})

export const listOf = (items: Rollout[]): RolloutPage => ({ items, pageInfo })

export const detailOf = (rollout: Rollout = rolloutOf(), stores: RolloutStore[] = [storeOf()]): RolloutDetail => ({ rollout, stores: { items: stores, pageInfo } })
