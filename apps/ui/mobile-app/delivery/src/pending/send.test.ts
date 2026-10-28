import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { flushSteps } from './send'
import type { PendingStep } from './store'

const delivered = (deliveryId: string): PendingStep => ({ kind: 'delivered', deliveryId, at: '2026-10-28T10:00:00.000Z', key: `key-${deliveryId}`, code: '2580', cashCollected: null })
const failed = (deliveryId: string): PendingStep => ({ kind: 'failed', deliveryId, at: '2026-10-28T10:05:00.000Z', key: `key-${deliveryId}`, reason: 'no_one_home' })

const sent: { query: string; variables: Record<string, unknown> | undefined }[] = []
const clientAnswering = (answer: (id: unknown) => void): ApiClient => ({
  request: <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
    sent.push({ query, variables })
    try {
      answer(variables?.['id'])
      return Promise.resolve({ ok: true } as T)
    } catch (error) {
      return Promise.reject(error)
    }
  },
})

beforeEach(() => {
  sent.length = 0
})

describe('flushSteps', () => {
  it('sends the steps in the order they were taken, each with its own time and key', async () => {
    const result = await flushSteps(clientAnswering(() => undefined), [delivered('d-1'), failed('d-2')])
    expect(sent.map((request) => request.variables?.['id'])).toEqual(['d-1', 'd-2'])
    expect(sent[0]?.query).toContain('markDelivered')
    expect(sent[0]?.variables).toMatchObject({ code: '2580', at: '2026-10-28T10:00:00.000Z', key: 'key-d-1' })
    expect(sent[1]?.query).toContain('markFailed')
    expect(sent[1]?.variables).toMatchObject({ reason: 'no_one_home', at: '2026-10-28T10:05:00.000Z', key: 'key-d-2' })
    expect(result).toEqual({ left: [], notices: [], sent: true })
  })

  it('stops at the first step with no answer and keeps it and every step after it', async () => {
    const steps = [delivered('d-1'), failed('d-2'), failed('d-3')]
    const result = await flushSteps(
      clientAnswering((id) => {
        if (id === 'd-2') throw new ApiError('NO_RESPONSE', 'offline')
      }),
      steps,
    )
    expect(sent).toHaveLength(2)
    expect(result.left).toEqual([steps[1], steps[2]])
    expect(result.sent).toBe(true)
  })

  it('keeps every step when the session has ended', async () => {
    const steps = [delivered('d-1')]
    const result = await flushSteps(clientAnswering(() => { throw new ApiError('UNAUTHENTICATED', 'signed out') }), steps)
    expect(result).toEqual({ left: steps, notices: [], sent: false })
  })

  it('tells the rider about a late wrong code, drops it, and carries on with the next step', async () => {
    const result = await flushSteps(
      clientAnswering((id) => {
        if (id === 'd-1') throw new ApiError('CODE_UNCONFIRMED', 'store confirms')
      }),
      [delivered('d-1'), failed('d-2')],
    )
    expect(result.notices).toEqual([{ deliveryId: 'd-1', code: 'CODE_UNCONFIRMED' }])
    expect(result.left).toEqual([])
    expect(sent).toHaveLength(2)
  })

  it('drops a step the API refused, with the reason for the rider', async () => {
    const result = await flushSteps(clientAnswering(() => { throw new ApiError('NOT_ASSIGNED', 'not yours') }), [failed('d-1')])
    expect(result).toEqual({ left: [], notices: [{ deliveryId: 'd-1', code: 'NOT_ASSIGNED' }], sent: false })
  })
})
