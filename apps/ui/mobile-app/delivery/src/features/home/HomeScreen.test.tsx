import { t } from '../../messages'
import { fakeSession, hasText, press, render, type Request } from '../../testing/harness'
import { HomeScreen } from './HomeScreen'

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react')
  return { useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => void) => useEffect(effect, []) }
})
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) }))
jest.mock('../../location/online', () => ({ goOnline: jest.fn(), goOffline: jest.fn() }))
jest.mock('../../push/PushContext', () => ({ usePush: () => ({ refresh: 0, ended: null, dismissEnded: jest.fn() }) }))
jest.mock('../../push/push', () => ({ pushPermission: jest.fn().mockResolvedValue('granted') }))
const mockTracking = jest.fn()
jest.mock('../../location/tracking', () => ({ isTracking: () => mockTracking(), retime: jest.fn().mockResolvedValue(undefined) }))

const soon = new Date(Date.now() + 20 * 60_000).toISOString()
const offer = (id: string, area: string) => ({ id, deliveryId: `d-${id}`, warehouse: 'Pune godown', area, distanceM: 800, itemCount: 2, expiresAt: soon })
const page = (nodes: unknown[], endCursor: string | null, hasNextPage: boolean) => ({ offers: { nodes, pageInfo: { startCursor: null, endCursor, hasPreviousPage: false, hasNextPage } } })

let secondPage: () => unknown
const answer = ({ query, variables }: Request): unknown => {
  if (query.includes('deliveries(')) return { deliveries: { nodes: [] } }
  if (variables?.['after']) return secondPage()
  return page([offer('o1', 'Indiranagar')], 'c1', true)
}

beforeEach(() => mockTracking.mockResolvedValue(true))

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
