import { act } from 'react-test-renderer'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeSession, flush, hasButton, hasText, press, render, type Request } from '../../testing/harness'
import { HomeScreen, takenStaysMs } from './HomeScreen'

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react')
  return { useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => void) => useEffect(effect, []) }
})
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) }))
const mockGoOffline = jest.fn()
jest.mock('../../location/online', () => ({ goOnline: jest.fn(), goOffline: (...args: unknown[]) => mockGoOffline(...args) }))
jest.mock('../../push/PushContext', () => ({ usePush: () => ({ refresh: 0, ended: null, dismissEnded: jest.fn() }) }))
jest.mock('../../push/push', () => ({ pushPermission: jest.fn().mockResolvedValue('granted') }))
const mockTracking = jest.fn()
const mockRetime = jest.fn()
jest.mock('../../location/tracking', () => ({ isTracking: () => mockTracking(), retime: (...args: unknown[]) => mockRetime(...args) }))

const soon = new Date(Date.now() + 20 * 60_000).toISOString()
const offer = (id: string, area: string) => ({ id, deliveryId: `d-${id}`, warehouse: 'Pune godown', area, distanceM: 800, itemCount: 2, expiresAt: soon })
const page = (nodes: unknown[], endCursor: string | null, hasNextPage: boolean) => ({ offers: { nodes, pageInfo: { startCursor: null, endCursor, hasPreviousPage: false, hasNextPage } } })
const delivery = (state: 'assigned' | 'picked_up') => ({ id: 'd-9', state, area: 'Whitefield', warehouse: { name: 'Pune godown' } })

let secondPage: () => unknown
let current: unknown[] = []
let onAccept: () => unknown
const answer = ({ query, variables }: Request): unknown => {
  if (query.includes('deliveries(')) return { deliveries: { nodes: current } }
  if (query.includes('acceptOffer')) return onAccept()
  if (variables?.['after']) return secondPage()
  return page([offer('o1', 'Indiranagar')], 'c1', true)
}

// The first render loads react-native's lazy modules cold: about 11 s here, over 30 s on a loaded CI runner (run 40674976346), so it is paid once, here.
beforeAll(async () => {
  mockTracking.mockResolvedValue(true)
  await render(<HomeScreen />, fakeSession(answer))
}, 120_000)

beforeEach(() => {
  jest.clearAllMocks()
  mockTracking.mockResolvedValue(true)
  mockGoOffline.mockResolvedValue(undefined)
  mockRetime.mockResolvedValue(undefined)
  current = []
  onAccept = () => ({ acceptOffer: true })
})

describe('Home: Show more', () => {
  it('says so when the next page cannot be loaded, and loads it on the next try', async () => {
    let tries = 0
    secondPage = () => {
      tries += 1
      if (tries === 1) throw new Error('no signal')
      return page([offer('o2', 'Koramangala')], null, false)
    }
    const screen = await render(<HomeScreen />, fakeSession(answer))
    expect(hasText(screen, 'Indiranagar')).toBe(true)

    await press(screen, t('home.showMore'))
    expect(hasText(screen, t('home.showMoreFailed'))).toBe(true)
    expect(hasText(screen, 'Koramangala')).toBe(false)

    await press(screen, t('home.showMore'))
    expect(hasText(screen, t('home.showMoreFailed'))).toBe(false)
    expect(hasText(screen, 'Koramangala')).toBe(true)
  })
})

describe('Home before the phone has said whether the rider is online', () => {
  it('shows neither Offline nor the offline note while it waits', async () => {
    mockTracking.mockReturnValue(new Promise(() => undefined))
    const screen = await render(<HomeScreen />, fakeSession(answer))
    expect(hasText(screen, t('online.off'))).toBe(false)
    expect(hasText(screen, t('online.offlineBody'))).toBe(false)
  })

  it('shows Online straight away for a rider whose task still runs', async () => {
    const screen = await render(<HomeScreen />, fakeSession(answer))
    expect(hasText(screen, t('online.on'))).toBe(true)
    expect(hasText(screen, t('online.off'))).toBe(false)
  })
})

describe('Home: going offline', () => {
  it('asks first when a delivery is assigned and not yet picked up, and hands it back only once confirmed', async () => {
    current = [delivery('assigned')]
    const screen = await render(<HomeScreen />, fakeSession(answer))
    await press(screen, t('online.switch'))
    expect(hasText(screen, t('online.handBack.title'))).toBe(true)
    expect(mockGoOffline).not.toHaveBeenCalled()

    await press(screen, t('online.handBack.confirm'))
    expect(mockGoOffline).toHaveBeenCalledTimes(1)
  })

  it('does not ask or go offline when the rider stays', async () => {
    current = [delivery('assigned')]
    const screen = await render(<HomeScreen />, fakeSession(answer))
    await press(screen, t('online.switch'))
    await press(screen, t('online.handBack.stay'))
    expect(mockGoOffline).not.toHaveBeenCalled()
  })

  it('never calls goOffline once the parcel is picked up, and says when they can', async () => {
    current = [delivery('picked_up')]
    const screen = await render(<HomeScreen />, fakeSession(answer))
    await press(screen, t('online.switch'))
    expect(mockGoOffline).not.toHaveBeenCalled()
    expect(hasText(screen, t('online.afterDelivery'))).toBe(true)
  })

  it('goes offline at once when there is no delivery', async () => {
    const screen = await render(<HomeScreen />, fakeSession(answer))
    await press(screen, t('online.switch'))
    expect(mockGoOffline).toHaveBeenCalledTimes(1)
  })
})

describe('Home: the delivery the rider is on', () => {
  it('stands in place of the offers while online', async () => {
    current = [delivery('assigned')]
    const screen = await render(<HomeScreen />, fakeSession(answer))
    expect(hasButton(screen, t('home.current.open'))).toBe(true)
    expect(hasText(screen, 'Indiranagar')).toBe(false)
  })

  it('shows even when the task is not running, as after a phone restart mid-delivery', async () => {
    mockTracking.mockResolvedValue(false)
    current = [delivery('picked_up')]
    const screen = await render(<HomeScreen />, fakeSession(answer))
    expect(hasButton(screen, t('home.current.open'))).toBe(true)
    expect(hasText(screen, t('online.off'))).toBe(true)
  })

  it('sends a picked-up rider’s position at the faster interval', async () => {
    current = [delivery('picked_up')]
    await render(<HomeScreen />, fakeSession(answer))
    expect(mockRetime).toHaveBeenCalledWith(true)
  })

  it('leaves the interval alone for an assigned delivery', async () => {
    current = [delivery('assigned')]
    await render(<HomeScreen />, fakeSession(answer))
    expect(mockRetime).not.toHaveBeenCalled()
  })
})

describe('Home: an offer another rider took', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('says so on its card, then drops it after a moment', async () => {
    onAccept = () => {
      throw new ApiError('TAKEN', 'Another rider already took this order.')
    }
    secondPage = () => page([], null, false)
    const screen = await render(<HomeScreen />, fakeSession(answer))
    await press(screen, t('home.accept'))
    expect(hasText(screen, t('home.taken'))).toBe(true)
    expect(hasButton(screen, t('home.accept'))).toBe(false)

    await act(async () => void jest.advanceTimersByTime(takenStaysMs))
    await flush()
    expect(hasText(screen, t('home.taken'))).toBe(false)
    expect(hasText(screen, 'Indiranagar')).toBe(false)
  })
})
