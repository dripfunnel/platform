import { describe, expect, it } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { actionsFor, loadRollout, loadRollouts, startRollout, steerRollout } from './rollouts'

const rollout = { id: 'r1', version: '0.10.0', security: false, state: 'canary', percent: 0, reason: 'r', startedAt: '2026-11-06T00:00:00Z', finishedAt: null, stores: [] }
const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }


describe('rollouts API', () => {
  it('asks nothing for a role without fleet.read', async () => {
    const { calls, restore } = stubApi({ data: {} })
    expect(await loadRollouts({}, 'staff-support')).toBeNull()
    expect(await loadRollout('r1', {}, {}, 'staff-read-only')).toBe('denied')
    expect(calls).toHaveLength(0)
    restore()
  })

  it('loads the list with its cursor', async () => {
    const { calls, restore } = stubApi({ data: { coreRollouts: { items: [rollout], pageInfo } } })
    expect((await loadRollouts({ after: 'abc' }, 'staff-engineer'))?.items[0]?.version).toBe('0.10.0')
    expect(calls[0]?.variables).toEqual({ after: 'abc' })
    restore()
  })

  it('loads one rollout with its stores, filtered by state, and is null for an unknown one', async () => {
    const store = { storeId: 's1', storeName: 'A', storeCode: 'a', partnerName: 'P', canary: true, fromVersion: '0.9.0', state: 'pinned', error: 'gate_failed', startedAt: null, finishedAt: null }
    const found = stubApi({ data: { coreRollout: rollout, coreRolloutStores: { items: [store], pageInfo } } })
    const detail = await loadRollout('r1', { state: 'pinned' }, { after: 'c' }, 'staff-super-admin')
    expect(detail !== 'denied' && detail?.stores.items[0]?.error).toBe('gate_failed')
    expect(found.calls[0]?.variables).toMatchObject({ id: 'r1', state: 'pinned', after: 'c' })
    expect(found.calls[0]?.query).not.toContain('gate')
    found.restore()
    const missing = stubApi({ data: { coreRollout: null, coreRolloutStores: null } })
    expect(await loadRollout('nope', {}, {}, 'staff-engineer')).toBeNull()
    missing.restore()
  })

  it('sends each steer to its own mutation with the reason, and start with its version and kind', async () => {
    const pause = stubApi({ data: { pauseCoreRollout: { id: 'r1', state: 'paused' } } })
    await steerRollout('pause', 'r1', 'Looking at a canary')
    expect(pause.calls[0]?.query).toContain('pauseCoreRollout(id: $id, reason: $reason)')
    expect(pause.calls[0]?.variables).toEqual({ id: 'r1', reason: 'Looking at a canary' })
    pause.restore()
    const back = stubApi({ data: { rollBackCoreRollout: { id: 'r1', state: 'rolled_back' } } })
    await steerRollout('rollBack', 'r1', 'Bad build')
    expect(back.calls[0]?.query).toContain('rollBackCoreRollout')
    back.restore()
    const start = stubApi({ data: { startCoreRollout: { id: 'r2', state: 'canary' } } })
    expect(await startRollout({ version: '0.10.0', security: true, reason: 'Fix' })).toBe('r2')
    expect(start.calls[0]?.variables).toEqual({ version: '0.10.0', security: true, reason: 'Fix' })
    start.restore()
  })

  it('offers only the steers the API takes in each state', () => {
    expect(actionsFor('canary')).toEqual(['pause', 'rollBack'])
    expect(actionsFor('waves')).toEqual(['pause', 'rollBack'])
    expect(actionsFor('paused')).toEqual(['resume', 'rollBack'])
    expect(actionsFor('done')).toEqual(['rollBack'])
    expect(actionsFor('rolled_back')).toEqual([])
  })
})
