import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi } from '../testing/fakeApi'
import { askDesign, runPollMs } from './storefront'

// A design run (storefront AI-STUDIO §4 "A design run"): askDesign starts it and answers at once, designRun reads its end.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => jest.useRealTimers())

describe('a design run from the phone', () => {
  it('starts under a UUID of its own and reads designRun under it until the run ends, through a lost read', async () => {
    jest.useFakeTimers()
    let reads = 0
    const { client, calls } = fakeApi({
      'mutation Ask(': (variables) => ({ askDesign: variables['run'] }),
      'designRun(': () => {
        reads += 1
        if (reads === 2) throw new ApiError('NO_RESPONSE', 'x')
        return { designRun: reads < 3 ? null : { outcome: 'changed', message: { text: 'Made it warmer.' } } }
      },
    })
    const answer = askDesign(client, 'Warmer')
    await jest.advanceTimersByTimeAsync(runPollMs * 2)
    expect(await answer).toEqual({ outcome: 'changed', reply: 'Made it warmer.' })
    const run = calls[0]?.variables['run']
    expect(run).toMatch(uuid)
    expect(calls.slice(1).map((c) => c.variables)).toEqual([{ run }, { run }, { run }])
  })

  it('throws a refusal from the start or from the run as the API sent it', async () => {
    const refused = fakeApi({ 'mutation Ask(': () => { throw new ApiError('STUDIO_QUEUED', 'x', { place: 2 }) } })
    await expect(askDesign(refused.client, 'x')).rejects.toMatchObject({ code: 'STUDIO_QUEUED', details: { place: 2 } })
    const failed = fakeApi({ 'mutation Ask(': (variables) => ({ askDesign: variables['run'] }), 'designRun(': () => { throw new ApiError('AI_BUDGET_REACHED', 'x') } })
    await expect(askDesign(failed.client, 'x')).rejects.toMatchObject({ code: 'AI_BUDGET_REACHED' })
  })

  it('gives up after a build’s clock and the gate after it, as a request that got no answer', async () => {
    jest.useFakeTimers()
    const { client } = fakeApi({ 'mutation Ask(': (variables) => ({ askDesign: variables['run'] }), 'designRun(': () => ({ designRun: null }) })
    const answer = askDesign(client, 'x').catch((error: unknown) => error)
    await jest.advanceTimersByTimeAsync(19 * 60_000 + runPollMs)
    expect(await answer).toMatchObject({ code: 'NO_RESPONSE' })
  })
})
