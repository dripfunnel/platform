import { Linking } from 'react-native'
import { AppState } from 'react-native'
import { act } from 'react-test-renderer'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, texts, type Request } from '../../testing/harness'
import { deliveryRead, orderRead, rider } from '../../testing/orders'
import { TrackingScreen } from './TrackingScreen'

jest.setTimeout(60_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
const mockReplace = jest.fn()
// The real hook runs when the screen comes into view and its cleanup when it leaves; a test does the same by hand.
const mockFocus: { enter: (() => void) | null; leave: (() => void) | null } = { enter: null, leave: null }
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace, canGoBack: () => false }),
    useFocusEffect: (effect: () => (() => void) | undefined) => {
      useEffect(() => {
        const cleanup = effect()
        mockFocus.enter = () => void effect()
        mockFocus.leave = () => void cleanup?.()
        return cleanup
      }, [effect])
    },
  }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
// The native map does not run in a test: the stub reports where the rider is drawn.
const mockMap = { regions: [] as { latitude: number; longitude: number }[], markers: 0 }
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  const MapView = React.forwardRef((props: { accessibilityLabel?: string; initialRegion: { latitude: number; longitude: number }; children?: unknown }, ref) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: (region: { latitude: number; longitude: number }) => void mockMap.regions.push(region) }))
    return <View testID="map" accessibilityLabel={props.accessibilityLabel}>{props.children as never}</View>
  })
  MapView.displayName = 'MapView'
  return { __esModule: true, default: MapView, Marker: () => { mockMap.markers += 1; return <View testID="marker" /> } }
})

const openUrl = jest.spyOn(Linking, 'openURL')
const appState: { handler: ((state: string) => void) | null } = { handler: null }
const removeListener = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  mockReplace.mockClear()
  mockMap.regions = []
  mockMap.markers = 0
  openUrl.mockReset().mockResolvedValue(true)
  removeListener.mockClear()
  appState.handler = null
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    appState.handler = handler as (state: string) => void
    return { remove: removeListener }
  })
})
afterEach(() => jest.useRealTimers())

const position = { latitude: 26.91, longitude: 75.79, reportedAt: '2026-10-27T05:14:00Z' }
const eta = '2026-10-27T05:22:00Z'

const open = (delivery: unknown, over: Record<string, unknown> = {}) => {
  const shop = fakeShop(() => orderRead(over, delivery), { signedIn: true })
  return render(<TrackingScreen orderId="o-1" />, shop).then((screen) => ({ screen, shop }))
}
const orderReads = (requests: Request[]) => requests.filter((r) => r.query.includes('order(id')).length
const tick = (ms: number) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)))

describe('the tracking screen, in each state', () => {
  it('shows the steps alone while the order is packed or a rider is looked for', async () => {
    for (const state of ['packing', 'searching']) {
      const { screen } = await open(deliveryRead(state))
      expect(hasText(screen, t(`tracking.state.${state as 'packing' | 'searching'}`))).toBe(true)
      expect(hasText(screen, t('tracking.stepsTitle'))).toBe(true)
      expect(hasText(screen, t('tracking.code.title'))).toBe(false)
      expect(hasText(screen, t('tracking.rider'))).toBe(false)
      expect(mockMap.markers).toBe(0)
    }
  })

  it('shows the rider, the handover code large and readable, and a call, but no map, once a rider is assigned', async () => {
    const { screen } = await open(deliveryRead('assigned', { rider, handoverCode: '2580', position: null }))
    expect(hasText(screen, t('tracking.lead.assigned', { name: 'Asha' }))).toBe(true)
    expect(hasText(screen, t('tracking.rider'))).toBe(true)
    expect(hasText(screen, 'Asha')).toBe(true)
    expect(hasText(screen, `${t('tracking.vehicle.scooter')} · RJ14 0001`)).toBe(true)
    expect(hasText(screen, t('tracking.code.title'))).toBe(true)
    expect(hasText(screen, t('tracking.code.give'))).toBe(true)
    expect(hasText(screen, '2580')).toBe(true)
    expect(screen.root.findAll((n) => n.props.accessibilityLabel === t('tracking.code.label', { code: '2 5 8 0' })).length).toBeGreaterThan(0)
    expect(mockMap.markers).toBe(0)
  })

  it('calls the rider from the phone’s dialler, at their number with only digits and a plus', async () => {
    const { screen } = await open(deliveryRead('assigned', { rider, handoverCode: '2580' }))
    await press(screen, t('tracking.call', { name: 'Asha' }))
    expect(openUrl).toHaveBeenCalledWith('tel:+919876500000')
  })

  it('offers no call for a rider whose number is missing or not one', async () => {
    const { screen } = await open(deliveryRead('assigned', { rider: { ...rider, phone: null }, handoverCode: '2580' }))
    expect(hasText(screen, t('tracking.call', { name: 'Asha' }))).toBe(false)
  })

  it('adds the map with the rider’s position, the arrival time and when it was reported, once the rider has the parcel', async () => {
    const { screen } = await open(deliveryRead('picked_up', { rider, handoverCode: '2580', position, etaAt: eta }))
    expect(hasText(screen, t('tracking.state.picked_up'))).toBe(true)
    expect(screen.root.findAll((n) => n.props.testID === 'map').length).toBeGreaterThan(0)
    expect(screen.root.findAll((n) => n.props.accessibilityLabel === t('tracking.map.label', { name: 'Asha' })).length).toBeGreaterThan(0)
    expect(texts(screen).some((text) => text.startsWith('Arriving about 10:52'))).toBe(true)
    expect(texts(screen).some((text) => text.startsWith('Position updated 10:44'))).toBe(true)
    expect(hasText(screen, '2580')).toBe(true)
  })

  it('says the rider will appear on the map when there is no position yet', async () => {
    const { screen } = await open(deliveryRead('picked_up', { rider, handoverCode: '2580', position: null }))
    expect(hasText(screen, t('tracking.map.waiting', { name: 'Asha' }))).toBe(true)
    expect(mockMap.markers).toBe(0)
  })

  it('shows the steps alone once delivered, though a late answer still carries the rider, the code and a position', async () => {
    const { screen } = await open(deliveryRead('delivered', { rider, handoverCode: '2580', position, etaAt: eta }))
    expect(hasText(screen, t('tracking.lead.delivered'))).toBe(true)
    expect(hasText(screen, '2580')).toBe(false)
    expect(hasText(screen, t('tracking.rider'))).toBe(false)
    expect(mockMap.markers).toBe(0)
    expect(hasText(screen, t('tracking.map.eta', { time: '10:52 am GMT+5:30' }))).toBe(false)
  })

  it('says a delivery was not made, and keeps the steps', async () => {
    const { screen } = await open(deliveryRead('failed', { steps: [{ state: 'packing', at: '2026-10-27T04:44:00Z' }, { state: 'failed', at: '2026-10-27T05:25:00Z' }] }))
    expect(hasText(screen, t('tracking.lead.failed'))).toBe(true)
    expect(hasText(screen, t('tracking.progress.ended'))).toBe(true)
    expect(hasText(screen, t('tracking.code.title'))).toBe(false)
  })

  it('says a delivery was cancelled', async () => {
    const { screen } = await open(deliveryRead('cancelled'))
    expect(hasText(screen, t('tracking.lead.cancelled'))).toBe(true)
  })

  it('names the store’s time zone beside each step’s time', async () => {
    const { screen } = await open(deliveryRead('packing'))
    expect(texts(screen).some((text) => /10:14/.test(text) && /GMT\+5:30|IST/.test(text))).toBe(true)
  })

  it('says there is nothing to follow for an order with no delivery, and goes back to the order', async () => {
    const { screen } = await open(null)
    expect(hasText(screen, t('tracking.none.title'))).toBe(true)
    await press(screen, t('tracking.none.action'))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/orders/[id]', params: { id: 'o-1' } })
  })

  it('says it cannot show a delivery in a state it has no words for, and does not poll it', async () => {
    const { screen, shop } = await open(deliveryRead('teleporting'))
    expect(hasText(screen, t('tracking.unknown.title'))).toBe(true)
    await tick(45_000)
    expect(orderReads(shop.requests)).toBe(1)
  })

  it('is not found for a shopper the API finds no such order for, and has its error and offline states', async () => {
    expect(hasText((await open(null, {})).screen, t('tracking.none.title'))).toBe(true)
    const gone = await render(<TrackingScreen orderId="o-9" />, fakeShop(() => ({ order: null, store: { timeZone: null } }), { signedIn: true }))
    expect(hasText(gone, t('orders.notFound.title'))).toBe(true)
    const failing = await render(<TrackingScreen orderId="o-1" />, fakeShop(() => { throw new ApiError('SERVER', 'x') }, { signedIn: true }))
    expect(hasText(failing, t('states.error.title'))).toBe(true)
    const offline = await render(<TrackingScreen orderId="o-1" />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }, { signedIn: true }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
  })

  it('moves the map when a new answer brings the rider’s new position', async () => {
    let at = position
    const shop = fakeShop(() => orderRead({}, deliveryRead('picked_up', { rider, handoverCode: '2580', position: at, etaAt: eta })), { signedIn: true })
    await render(<TrackingScreen orderId="o-1" />, shop)
    mockMap.regions = []
    at = { latitude: 26.92, longitude: 75.8, reportedAt: '2026-10-27T05:15:00Z' }
    await tick(15_000)
    expect(mockMap.regions.at(-1)).toMatchObject({ latitude: 26.92, longitude: 75.8 })
  })
})

describe('asking again while it is open', () => {
  const live = () => deliveryRead('picked_up', { rider, handoverCode: '2580', position, etaAt: eta })

  it('asks every 15 seconds while the delivery is not over', async () => {
    const { shop } = await open(live())
    expect(orderReads(shop.requests)).toBe(1)
    await tick(14_000)
    expect(orderReads(shop.requests)).toBe(1)
    await tick(1_000)
    expect(orderReads(shop.requests)).toBe(2)
    await tick(15_000)
    expect(orderReads(shop.requests)).toBe(3)
    await tick(15_000)
    expect(orderReads(shop.requests)).toBe(4)
  })

  it('stops when the screen leaves the view, and asks at once when it comes back', async () => {
    const { shop } = await open(live())
    await act(async () => mockFocus.leave?.())
    await tick(60_000)
    expect(orderReads(shop.requests)).toBe(1)
    await act(async () => mockFocus.enter?.())
    await tick(0)
    expect(orderReads(shop.requests)).toBe(2)
    await tick(15_000)
    expect(orderReads(shop.requests)).toBe(3)
  })

  it('stops when the app goes to the background, and asks at once when it comes back', async () => {
    const { shop } = await open(live())
    await act(async () => appState.handler?.('background'))
    await tick(60_000)
    expect(orderReads(shop.requests)).toBe(1)
    await act(async () => appState.handler?.('active'))
    await tick(0)
    expect(orderReads(shop.requests)).toBe(2)
  })

  it('stops for good once the delivery is over', async () => {
    let state = 'picked_up'
    const shop = fakeShop(() => orderRead({}, state === 'picked_up' ? live() : deliveryRead('delivered', { rider, handoverCode: '2580' })), { signedIn: true })
    await render(<TrackingScreen orderId="o-1" />, shop)
    state = 'delivered'
    await tick(15_000)
    const reads = orderReads(shop.requests)
    expect(reads).toBe(2)
    await tick(120_000)
    expect(orderReads(shop.requests)).toBe(reads)
  })

  it('never polls a delivery that has not got to a rider’s hands to be over: it asks while packing, searching and assigned too', async () => {
    for (const state of ['packing', 'searching', 'assigned']) {
      const { shop } = await open(deliveryRead(state, state === 'assigned' ? { rider, handoverCode: '2580' } : {}))
      await tick(15_000)
      expect(orderReads(shop.requests)).toBe(2)
    }
  })

  it('stops listening to the app’s state when the screen goes away', async () => {
    const { screen } = await open(live())
    await act(async () => screen.unmount())
    expect(removeListener).toHaveBeenCalled()
  })
})

describe('the handover code', () => {
  it('is never logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined))
    const { shop } = await open(deliveryRead('picked_up', { rider, handoverCode: '2580', position, etaAt: eta }))
    await tick(30_000)
    expect(orderReads(shop.requests)).toBeGreaterThan(1)
    expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain('2580')
    spies.forEach((spy) => spy.mockRestore())
  })

  it('is never kept on the phone', async () => {
    await open(deliveryRead('assigned', { rider, handoverCode: '2580' }))
    const AsyncStorage = jest.requireMock<{ getAllKeys: () => Promise<string[]>; getItem: (key: string) => Promise<string | null> }>('@react-native-async-storage/async-storage')
    const kept = await Promise.all((await AsyncStorage.getAllKeys()).map((key) => AsyncStorage.getItem(key)))
    expect(JSON.stringify(kept)).not.toContain('2580')
  })
})
