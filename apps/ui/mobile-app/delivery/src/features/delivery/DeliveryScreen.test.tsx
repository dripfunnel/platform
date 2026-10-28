import { Linking } from 'react-native'
import { act } from 'react-test-renderer'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { PendingProvider, usePending, type Pending } from '../../pending/PendingContext'
import { fakeSession, fill, flush, hasButton, hasText, isDisabled, press, pressableNamed, render, type Request } from '../../testing/harness'
import { DeliveryScreen } from './DeliveryScreen'

let mockConnected = true
jest.mock('@dripfunnel/mobile-shared/connection', () => ({ useOnline: () => mockConnected }))
const mockKeystore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => Promise.resolve(mockKeystore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => (mockKeystore.set(key, value), Promise.resolve()),
  deleteItemAsync: (key: string) => (mockKeystore.delete(key), Promise.resolve()),
}))

let pending!: Pending
const Probe = () => {
  pending = usePending()
  return null
}

const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate, push: jest.fn() }) }))
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  return { __esModule: true, default: () => <View testID="map" />, Marker: () => null }
})
const mockOpen = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)

const address = { line1: '12 MG Road', line2: null, city: 'Pune', region: 'MH', postalCode: '411001', country: 'IN' }
const warehouse = { name: 'Pune godown', latitude: 18.52, longitude: 73.85, address }
const lines = [{ name: 'Linen shirt', versionName: 'M', quantity: 2 }]
const assigned = { id: 'd-1', state: 'assigned', area: 'Whitefield', failedReason: null, currency: 'INR', cashDueAmount: null, warehouse, lines, customer: null }
const customer = { name: 'Asha Rao', phone: '+91 98765 43210', note: 'Ring twice', latitude: 12.97, longitude: 77.75, address: { ...address, line1: '4 Lake View', city: 'Bengaluru' } }
const pickedUp = { ...assigned, state: 'picked_up', customer }

let current: unknown
let onDelivered: (variables: Record<string, unknown>) => unknown
const sent: Request[] = []
const answer = (request: Request): unknown => {
  sent.push(request)
  if (request.query.includes('markDelivered')) return onDelivered(request.variables ?? {})
  if (request.query.includes('markPickedUp')) {
    current = pickedUp
    return { markPickedUp: true }
  }
  if (request.query.includes('handBack') || request.query.includes('markFailed')) return { ok: true }
  return { delivery: current }
}
// The sheet's confirm button and the footer's link share a name, as in the prototype: the sheet's is the later one.
const pressLast = async (screen: Parameters<typeof press>[0], name: string) => {
  const named = screen.root.findAll((node) => node.props.accessibilityLabel === name && typeof node.props.onPress === 'function')
  await act(async () => named[named.length - 1]?.props.onPress())
  await flush()
}

const refuse = (code: string) => () => {
  throw new ApiError(code, 'refused')
}

// The first render loads react-native's lazy modules cold: over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  current = assigned
  await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
}, 120_000)

beforeEach(() => {
  jest.clearAllMocks()
  sent.length = 0
  current = assigned
  onDelivered = () => ({ markDelivered: true })
})

describe('before pickup', () => {
  it('shows the warehouse, the items and only the customer’s area', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    expect(hasText(screen, 'Pune godown')).toBe(true)
    expect(hasText(screen, '12 MG Road, Pune, MH, 411001')).toBe(true)
    expect(hasText(screen, 'Linen shirt · M')).toBe(true)
    expect(hasText(screen, 'Whitefield')).toBe(true)
    expect(hasText(screen, 'Asha Rao')).toBe(false)
  })

  it('opens the phone’s map on the warehouse', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.navigate'))
    expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('18.52,73.85'))
  })

  it('picks up, then shows the customer’s details', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.pickedUp'))
    expect(hasText(screen, 'Asha Rao')).toBe(true)
    expect(hasText(screen, 'Ring twice')).toBe(true)
    expect(hasButton(screen, t('delivery.call'))).toBe(true)
  })

  it('hands back only after the sheet is confirmed, then goes Home', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.handBack'))
    expect(sent.some((request) => request.query.includes('handBack'))).toBe(false)
    await pressLast(screen, t('delivery.handBackSheet.confirm'))
    expect(sent.some((request) => request.query.includes('handBack'))).toBe(true)
    expect(mockNavigate).toHaveBeenCalledWith('/home')
  })

  it('says so when the pickup is refused', async () => {
    const session = fakeSession((request) => {
      if (request.query.includes('markPickedUp')) throw new ApiError('NOT_ENOUGH_STOCK', 'x')
      return { delivery: assigned }
    })
    const screen = await render(<DeliveryScreen id="d-1" />, session)
    await press(screen, t('delivery.pickedUp'))
    expect(hasText(screen, t('errors.NOT_ENOUGH_STOCK'))).toBe(true)
  })
})

describe('at the door', () => {
  beforeEach(() => {
    current = pickedUp
  })

  it('calls the customer and opens the map on their pin', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.call'))
    expect(mockOpen).toHaveBeenCalledWith('tel:+919876543210')
    await press(screen, t('delivery.navigate'))
    expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('12.97,77.75'))
  })

  it('delivers a prepaid order with the four digits, with no cash question', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.delivered'))
    expect(hasText(screen, t('delivery.code.title'))).toBe(true)
    expect(isDisabled(pressableNamed(screen, t('delivery.code.confirm')))).toBe(true)
    await fill(screen, t('delivery.code.label'), '25a80')
    await press(screen, t('delivery.code.confirm'))
    const sentCode = sent.find((request) => request.query.includes('markDelivered'))?.variables
    expect(sentCode).toMatchObject({ id: 'd-1', code: '2580', cashCollected: null })
    expect(hasText(screen, t('delivery.result.title'))).toBe(true)
  })

  it('asks for the cash first on a cash-on-delivery order, and sends that it was collected', async () => {
    current = { ...pickedUp, cashDueAmount: '129900' }
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.delivered'))
    expect(hasText(screen, t('delivery.cashSheet.title', { amount: '₹1,299.00' }))).toBe(true)
    expect(hasText(screen, t('delivery.code.title'))).toBe(false)

    await press(screen, t('delivery.cashSheet.confirm', { amount: '₹1,299.00' }))
    await fill(screen, t('delivery.code.label'), '2580')
    await press(screen, t('delivery.code.confirm'))
    expect(sent.find((request) => request.query.includes('markDelivered'))?.variables).toMatchObject({ cashCollected: true })
    expect(hasText(screen, t('delivery.result.cash', { amount: '₹1,299.00' }))).toBe(true)
  })

  it('does not ask for a code when the cash is not yet collected', async () => {
    current = { ...pickedUp, cashDueAmount: '129900' }
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.delivered'))
    await press(screen, t('delivery.cashSheet.notYet'))
    expect(hasText(screen, t('delivery.code.title'))).toBe(false)
  })

  it('says the code was wrong and that repeated mistakes lock it, without a count the app cannot know, and clears the field', async () => {
    onDelivered = refuse('WRONG_CODE')
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.delivered'))
    await fill(screen, t('delivery.code.label'), '1111')
    await press(screen, t('delivery.code.confirm'))
    expect(hasText(screen, t('errors.WRONG_CODE'))).toBe(true)
    expect(hasText(screen, 'try left') || hasText(screen, 'tries left')).toBe(false)
    expect(isDisabled(pressableNamed(screen, t('delivery.code.confirm')))).toBe(true)
  })

  it('tells the rider to ask the store once the code is locked, and takes the entry away', async () => {
    onDelivered = refuse('CODE_LOCKED')
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.delivered'))
    await fill(screen, t('delivery.code.label'), '1111')
    await press(screen, t('delivery.code.confirm'))
    expect(hasText(screen, t('delivery.code.lockedTitle'))).toBe(true)
    expect(hasButton(screen, t('delivery.code.confirm'))).toBe(false)
    expect(hasButton(screen, t('delivery.notDelivered'))).toBe(true)
  })

  it('names the reason when it is not delivered, then says where to return the parcel', async () => {
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    await press(screen, t('delivery.notDelivered'))
    expect(isDisabled(pressableNamed(screen, t('delivery.failedSheet.confirm')))).toBe(true)
    await press(screen, t('delivery.failedSheet.reason.no_one_home'))
    await press(screen, t('delivery.failedSheet.confirm'))
    expect(sent.find((request) => request.query.includes('markFailed'))?.variables).toMatchObject({ reason: 'no_one_home' })
    expect(hasText(screen, t('delivery.returnParcel.titleReturn', { warehouse: 'Pune godown' }))).toBe(true)
    expect(hasText(screen, 'Asha Rao')).toBe(false)
  })

})

describe('without signal', () => {
  const withQueue = (id = 'd-1') => (
    <PendingProvider>
      <DeliveryScreen id={id} />
      <Probe />
    </PendingProvider>
  )

  beforeEach(() => {
    current = pickedUp
    mockConnected = true
    mockKeystore.clear()
  })

  const deliver = async (screen: Parameters<typeof press>[0]) => {
    await press(screen, t('delivery.delivered'))
    await fill(screen, t('delivery.code.label'), '2580')
    await press(screen, t('delivery.code.confirm'))
  }

  it('keeps Delivered on the phone when the API does not answer, and says it is waiting for signal', async () => {
    onDelivered = refuse('NO_RESPONSE')
    const screen = await render(withQueue(), fakeSession(answer))
    await deliver(screen)
    expect(hasText(screen, t('delivery.saved.title'))).toBe(true)
    expect(pending.steps).toMatchObject([{ kind: 'delivered', deliveryId: 'd-1', code: '2580' }])
    expect(hasButton(screen, t('delivery.code.confirm'))).toBe(false)
  })

  it('sends nothing and keeps the step when the phone already has no signal, and the code gets one try', async () => {
    mockConnected = false
    const screen = await render(withQueue(), fakeSession(answer))
    await press(screen, t('delivery.delivered'))
    expect(hasText(screen, t('delivery.noSignalCode.title'))).toBe(true)
    await fill(screen, t('delivery.code.label'), '2580')
    await press(screen, t('delivery.code.confirm'))
    expect(sent.some((request) => request.query.includes('markDelivered'))).toBe(false)
    expect(hasText(screen, t('delivery.saved.title'))).toBe(true)
    expect(pending.steps).toHaveLength(1)
  })

  it('keeps Not delivered the same way, and still says where to return the parcel', async () => {
    mockConnected = false
    const screen = await render(withQueue(), fakeSession(answer))
    await press(screen, t('delivery.notDelivered'))
    await press(screen, t('delivery.failedSheet.reason.refused'))
    await press(screen, t('delivery.failedSheet.confirm'))
    expect(pending.steps).toMatchObject([{ kind: 'failed', reason: 'refused' }])
    expect(hasText(screen, t('delivery.returnParcel.titleReturn', { warehouse: 'Pune godown' }))).toBe(true)
    expect(hasText(screen, t('delivery.saved.notDelivered', { time: '' }).slice(0, 15))).toBe(true)
  })

  it('offers nothing more on reopening a delivery whose step is kept', async () => {
    mockConnected = false
    mockKeystore.set('df.pending.acme.my-store.one', JSON.stringify({ steps: [{ kind: 'delivered', deliveryId: 'd-1', at: '2026-10-28T10:00:00.000Z', key: 'k', code: '2580', cashCollected: null }], notices: [] }))
    const screen = await render(withQueue(), fakeSession(answer))
    expect(hasText(screen, t('delivery.saved.title'))).toBe(true)
    expect(hasButton(screen, t('delivery.delivered'))).toBe(false)
    expect(hasButton(screen, t('delivery.notDelivered'))).toBe(false)
  })

  it('says the store will confirm the delivery when a late code did not match', async () => {
    onDelivered = refuse('CODE_UNCONFIRMED')
    const screen = await render(withQueue(), fakeSession(answer))
    await deliver(screen)
    expect(hasText(screen, t('delivery.unconfirmed.title'))).toBe(true)
    expect(pending.steps).toEqual([])
    expect(pending.hidden.has('d-1')).toBe(true)
  })
})

describe('a delivery that is no longer the rider’s to carry', () => {
  it('says the store cancelled it', async () => {
    current = { ...assigned, state: 'cancelled' }
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    expect(hasText(screen, t('delivery.cancelled.title'))).toBe(true)
  })

  it('says the store recalled it and where to bring the parcel', async () => {
    current = { ...assigned, state: 'failed', failedReason: 'recalled' }
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    expect(hasText(screen, t('delivery.returnParcel.recalled'))).toBe(true)
    expect(hasText(screen, t('delivery.returnParcel.titleBring', { warehouse: 'Pune godown' }))).toBe(true)
  })

  it('says it is not theirs when the API returns none', async () => {
    current = null
    const screen = await render(<DeliveryScreen id="d-1" />, fakeSession(answer))
    expect(hasText(screen, t('errors.NOT_FOUND'))).toBe(true)
  })
})
