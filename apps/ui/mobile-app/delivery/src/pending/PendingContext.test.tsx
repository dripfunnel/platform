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
let mockWriteFails = false
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => Promise.resolve(mockKeystore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    if (mockWriteFails) return Promise.reject(new Error('keystore full'))
    mockKeystore.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    mockKeystore.delete(key)
    return Promise.resolve()
  },
}))

const step: PendingStep = { kind: 'delivered', deliveryId: 'd-1', at: '2026-10-28T10:00:00.000Z', key: 'k-1', code: '2580', cashCollected: null }
let rider = 'r-1'
const storeKey = (id: string) => `df.pending.acme.my-store.one.rider.${id}`

let pending!: Pending
const Probe = () => {
  pending = usePending()
  return null
}

const sent: Request[] = []
let reply: () => void = () => undefined
let gate: Promise<void> | null = null
let meFails: ApiError | null = null
const answer = (request: Request): unknown => {
  if (request.query === '{ me }') {
    if (meFails) throw meFails
    return { me: { id: rider } }
  }
  sent.push(request)
  if (gate) return gate.then(reply).then(() => ({ ok: true }))
  reply()
  return { ok: true }
}

const wait = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))))

beforeEach(() => {
  mockConnected = true
  mockWriteFails = false
  mockKeystore.clear()
  sent.length = 0
  rider = 'r-1'
  reply = () => undefined
  gate = null
  meFails = null
})

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  await render(<PendingProvider><Probe /></PendingProvider>, fakeSession(answer))
}, 120_000)

const mount = async () => {
  const view = await render(<PendingProvider><Probe /></PendingProvider>, fakeSession(answer))
  await wait()
  return view
}

describe('retryAfterMs', () => {
  it('starts at 5 seconds, doubles, and stops at 5 minutes', () => {
    expect([0, 1, 2, 5, 6, 20].map(retryAfterMs)).toEqual([5_000, 10_000, 20_000, 160_000, 300_000, 300_000])
  })
})

describe('the steps waiting for signal', () => {
  it('are kept in secure storage, hidden from the current delivery, and sent as soon as there is signal', async () => {
    mockConnected = false
    await mount()
    await act(async () => void (await pending.keep(step)))
    await wait()
    expect(sent).toHaveLength(0)
    expect(pending.hidden.has('d-1')).toBe(true)
    expect(mockKeystore.get(storeKey('r-1'))).toContain('"key":"k-1"')

    await act(async () => setConnected(true))
    await wait()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.variables).toMatchObject({ id: 'd-1', code: '2580', key: 'k-1', at: step.at })
    expect(pending.steps).toEqual([])
    expect(pending.sentCount).toBe(1)
    expect(mockKeystore.has(storeKey('r-1'))).toBe(false)
  })

  it('are loaded again after the app was closed, from the last rider when the phone has no signal', async () => {
    mockConnected = false
    mockKeystore.set(storeKey('r-1'), JSON.stringify({ steps: [step], notices: [] }))
    mockKeystore.set('df.pending.acme.my-store.one.last', 'r-1')
    const session = fakeSession(() => {
      throw new ApiError('NO_RESPONSE', 'offline')
    })
    await render(<PendingProvider><Probe /></PendingProvider>, session)
    await wait()
    expect(pending.steps).toEqual([step])
  })

  it('are never shown to, or sent for, another rider who signs in on the same phone', async () => {
    mockConnected = false
    mockKeystore.set(storeKey('r-1'), JSON.stringify({ steps: [step], notices: [{ deliveryId: 'd-0', code: 'NOT_ASSIGNED' }] }))
    rider = 'r-2'
    await mount()
    await act(async () => setConnected(true))
    await wait()
    expect(pending.steps).toEqual([])
    expect(pending.notices).toEqual([])
    expect(sent).toHaveLength(0)
    expect(mockKeystore.has(storeKey('r-1'))).toBe(true)
  })

  it('are not put under the last rider when the rider could not be told for another reason than no signal', async () => {
    mockKeystore.set('df.pending.acme.my-store.one.last', 'r-1')
    mockKeystore.set(storeKey('r-1'), JSON.stringify({ steps: [step], notices: [] }))
    meFails = new ApiError('BAD_RESPONSE', 'no data')
    await mount()
    expect(pending.steps).toEqual([])
    let kept = true
    await act(async () => void (kept = await pending.keep({ ...step, key: 'k-9' })))
    expect(kept).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('keep only the newer step of a delivery that was replaced while the older was being sent', async () => {
    let release!: () => void
    gate = new Promise<void>((resolve) => (release = resolve))
    reply = () => {
      throw new ApiError('NO_RESPONSE', 'offline')
    }
    await mount()
    await act(async () => void (await pending.keep(step)))
    await wait()
    await act(async () => void (await pending.keep({ ...step, key: 'k-2' })))
    await act(async () => release())
    await wait()
    expect(pending.steps.map((kept) => kept.key)).toEqual(['k-2'])
  })

  it('are forgotten with the last rider when the account is deleted', async () => {
    mockConnected = false
    await mount()
    await act(async () => void (await pending.keep(step)))
    expect(mockKeystore.has(storeKey('r-1'))).toBe(true)
    await act(async () => pending.forget())
    expect(pending.steps).toEqual([])
    expect(mockKeystore.has(storeKey('r-1'))).toBe(false)
    expect(mockKeystore.has('df.pending.acme.my-store.one.last')).toBe(false)
  })

  it('are not told to the rider as kept when they could not be written', async () => {
    mockConnected = false
    await mount()
    mockWriteFails = true
    let kept = true
    await act(async () => void (kept = await pending.keep(step)))
    expect(kept).toBe(false)
    expect(pending.steps).toEqual([])
    expect(pending.hidden.has('d-1')).toBe(false)
  })

  it('stay kept when the API does not answer', async () => {
    reply = () => {
      throw new ApiError('NO_RESPONSE', 'offline')
    }
    await mount()
    await act(async () => void (await pending.keep(step)))
    await wait()
    expect(pending.steps).toEqual([step])
    expect(mockKeystore.get(storeKey('r-1'))).toContain('"key":"k-1"')
  })

  it('leave the delivery with the store when the code arrives late and does not match', async () => {
    reply = () => {
      throw new ApiError('CODE_UNCONFIRMED', 'store confirms')
    }
    await mount()
    await act(async () => void (await pending.keep(step)))
    await wait()
    expect(pending.steps).toEqual([])
    expect(pending.notices).toEqual([{ deliveryId: 'd-1', code: 'CODE_UNCONFIRMED', dismissed: false }])
    expect(pending.hidden.has('d-1')).toBe(true)
    await act(async () => pending.dismissNotice('d-1'))
    expect(pending.notices).toEqual([{ deliveryId: 'd-1', code: 'CODE_UNCONFIRMED', dismissed: true }])
    expect(pending.hidden.has('d-1')).toBe(true)
    expect(mockKeystore.get(storeKey('r-1'))).toContain('"dismissed":true')
  })

  it('drop any other notice once it is dismissed', async () => {
    mockConnected = false
    mockKeystore.set(storeKey('r-1'), JSON.stringify({ steps: [], notices: [{ deliveryId: 'd-0', code: 'NOT_ASSIGNED' }] }))
    await mount()
    expect(pending.notices).toEqual([{ deliveryId: 'd-0', code: 'NOT_ASSIGNED', dismissed: false }])
    await act(async () => pending.dismissNotice('d-0'))
    expect(pending.notices).toEqual([])
  })

  it('replace an earlier step of the same delivery', async () => {
    mockConnected = false
    await mount()
    await act(async () => void (await pending.keep(step)))
    await act(async () => void (await pending.keep({ ...step, key: 'k-2' })))
    expect(pending.steps.map((kept) => kept.key)).toEqual(['k-2'])
    await flush()
  })
})
