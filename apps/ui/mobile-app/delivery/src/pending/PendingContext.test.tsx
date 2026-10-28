import { act } from 'react-test-renderer'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { fakeSession, flush, render, type Request } from '../testing/harness'
import { PendingProvider, retryAfterMs, usePending, type Pending } from './PendingContext'
import type { PendingStep } from './store'

let mockConnected = true
const mockListeners = new Set<() => void>()
const setConnected = (next: boolean) => {
  mockConnected = next
  mockListeners.forEach((listener) => listener())
}
jest.mock('@dripfunnel/mobile-shared/connection', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react')
  const subscribe = (listener: () => void) => (mockListeners.add(listener), () => void mockListeners.delete(listener))
  return { useOnline: () => useSyncExternalStore(subscribe, () => mockConnected) }
})
const mockKeystore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => Promise.resolve(mockKeystore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockKeystore.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    mockKeystore.delete(key)
    return Promise.resolve()
  },
}))

const step: PendingStep = { kind: 'delivered', deliveryId: 'd-1', at: '2026-10-28T10:00:00.000Z', key: 'k-1', code: '2580', cashCollected: null }
const storeKey = 'df.pending.acme.my-store.one'

let pending!: Pending
const Probe = () => {
  pending = usePending()
  return null
}

const sent: Request[] = []
let reply: () => void = () => undefined
const answer = (request: Request): unknown => {
  sent.push(request)
  reply()
  return { ok: true }
}

const wait = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))))

beforeEach(() => {
  mockConnected = true
  mockKeystore.clear()
  sent.length = 0
  reply = () => undefined
})

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  await render(<PendingProvider><Probe /></PendingProvider>, fakeSession(answer))
}, 120_000)

const mount = () =>render(<PendingProvider><Probe /></PendingProvider>, fakeSession(answer))

describe('retryAfterMs', () => {
  it('starts at 5 seconds, doubles, and stops at 5 minutes', () => {
    expect([0, 1, 2, 5, 6, 20].map(retryAfterMs)).toEqual([5_000, 10_000, 20_000, 160_000, 300_000, 300_000])
  })
})

describe('the steps waiting for signal', () => {
  it('are kept in secure storage, hidden from the current delivery, and sent as soon as there is signal', async () => {
    mockConnected = false
    await mount()
    await act(async () => pending.keep(step))
    await wait()
    expect(sent).toHaveLength(0)
    expect(pending.hidden.has('d-1')).toBe(true)
    expect(mockKeystore.get(storeKey)).toContain('"key":"k-1"')

    await act(async () => setConnected(true))
    await wait()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.variables).toMatchObject({ id: 'd-1', code: '2580', key: 'k-1', at: step.at })
    expect(pending.steps).toEqual([])
    expect(pending.sentCount).toBe(1)
    expect(mockKeystore.size).toBe(0)
  })

  it('are loaded again after the app was closed', async () => {
    mockConnected = false
    mockKeystore.set(storeKey, JSON.stringify({ steps: [step], notices: [] }))
    await mount()
    await flush()
    expect(pending.steps).toEqual([step])
  })

  it('stay kept when the API does not answer', async () => {
    reply = () => {
      throw new ApiError('NO_RESPONSE', 'offline')
    }
    await mount()
    await act(async () => pending.keep(step))
    await wait()
    expect(pending.steps).toEqual([step])
    expect(mockKeystore.get(storeKey)).toContain('"key":"k-1"')
  })

  it('leave the delivery with the store when the code arrives late and does not match', async () => {
    reply = () => {
      throw new ApiError('CODE_UNCONFIRMED', 'store confirms')
    }
    await mount()
    await act(async () => pending.keep(step))
    await wait()
    expect(pending.steps).toEqual([])
    expect(pending.notices).toEqual([{ deliveryId: 'd-1', code: 'CODE_UNCONFIRMED' }])
    expect(pending.hidden.has('d-1')).toBe(true)
    await act(async () => pending.dismissNotice('d-1'))
    expect(pending.hidden.has('d-1')).toBe(false)
  })

  it('replace an earlier step of the same delivery', async () => {
    mockConnected = false
    await mount()
    await act(async () => pending.keep(step))
    await act(async () => pending.keep({ ...step, key: 'k-2' }))
    expect(pending.steps.map((kept) => kept.key)).toEqual(['k-2'])
  })
})
