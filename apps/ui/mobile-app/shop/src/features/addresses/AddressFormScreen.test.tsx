import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, hasText, press, pressableNamed, render, type Request } from '../../testing/harness'
import { AddressFormScreen } from './AddressFormScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockBack = jest.fn()
const mockLocation = { granted: true, coords: { latitude: 26.9124, longitude: 75.7873 }, fail: false }
const mockMap = { animateToRegion: jest.fn(), props: null as null | { onPress: (e: { nativeEvent: { coordinate: object } }) => void } }

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn(), canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: () => Promise.resolve({ granted: mockLocation.granted }),
  getCurrentPositionAsync: () => (mockLocation.fail ? Promise.reject(new Error('no fix')) : Promise.resolve({ coords: mockLocation.coords })),
}))
// The native map does not run in a test: the stub records how it is used and draws a marker only when there is a pin.
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  const MapView = React.forwardRef((props: { children?: unknown; onPress: (e: { nativeEvent: { coordinate: object } }) => void }, ref) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockMap.animateToRegion }))
    mockMap.props = props
    return <View testID="map">{props.children as never}</View>
  })
  MapView.displayName = 'MapView'
  return { __esModule: true, default: MapView, Marker: (props: object) => <View testID="marker" {...props} /> }
})

const mine = (addresses: object[] = [], countries = ['IN']) => ({ account: { name: 'Ana', email: 'ana@example.com', phone: null, addresses }, store: { markets: [{ countries }] } })
const saved = (over: object = {}) => ({ id: 'a1', name: 'Home', line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, isDefault: true, latitude: 26.9, longitude: 75.8, ...over })

const fill = async (screen: ReactTestRenderer, label: string, value: string) => {
  const input = screen.root.findAll((node) => node.props.accessibilityLabel?.startsWith(label) && typeof node.props.onChangeText === 'function')[0]
  if (!input) throw new Error(`No field "${label}"`)
  await act(async () => input.props.onChangeText(value))
}

const fillIndia = async (screen: ReactTestRenderer) => {
  await fill(screen, t('address.name'), 'Ana Rao')
  await fill(screen, t('address.line1'), '12 Sample Lane')
  await fill(screen, t('address.city'), 'Jaipur')
  await fill(screen, t('address.state'), 'Rajasthan')
  await fill(screen, t('address.pin'), '302017')
}

const saves = (requests: Request[]) => requests.filter((r) => r.query.includes('saveAddress'))

beforeEach(() => {
  mockBack.mockClear()
  mockMap.animateToRegion.mockClear()
  Object.assign(mockLocation, { granted: true, fail: false })
})

describe('an address with a map pin', () => {
  it('cannot be saved without the pin, and says so', async () => {
    const shop = fakeShop(() => mine(), { signedIn: true })
    const screen = await render(<AddressFormScreen id={null} />, shop)
    await fillIndia(screen)
    await press(screen, t('address.save'))
    expect(hasText(screen, t('address.pinRequired'))).toBe(true)
    expect(saves(shop.requests)).toHaveLength(0)
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('is saved with its pin once it is dropped, and the shopper goes back', async () => {
    const shop = fakeShop((r) => (r.query.includes('saveAddress') ? { saveAddress: 'new-id' } : mine()), { signedIn: true })
    const screen = await render(<AddressFormScreen id={null} />, shop)
    await fillIndia(screen)
    await press(screen, t('address.map.drop'))
    expect(screen.root.findAllByProps({ testID: 'marker' }).length).toBeGreaterThan(0)
    await press(screen, t('address.save'))
    expect(saves(shop.requests)[0]?.variables).toMatchObject({
      id: null,
      isDefault: true,
      address: { name: 'Ana Rao', line1: '12 Sample Lane', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, latitude: 20, longitude: 0 },
    })
    expect(mockBack).toHaveBeenCalled()
  })

  it('moves when the map is tapped, so the pin can be put on the door', async () => {
    const shop = fakeShop(() => mine(), { signedIn: true })
    const screen = await render(<AddressFormScreen id={null} />, shop)
    await press(screen, t('address.map.drop'))
    await act(async () => mockMap.props?.onPress({ nativeEvent: { coordinate: { latitude: 26.5, longitude: 75.5 } } }))
    expect(screen.root.findAllByProps({ testID: 'marker' })[0]?.props.coordinate).toEqual({ latitude: 26.5, longitude: 75.5 })
  })

  it('takes the pin from the phone’s location when the shopper allows it, and shows the place', async () => {
    const screen = await render(<AddressFormScreen id={null} />, fakeShop(() => mine(), { signedIn: true }))
    await press(screen, t('address.map.useLocation'))
    expect(screen.root.findAllByProps({ testID: 'marker' })[0]?.props.coordinate).toEqual({ latitude: 26.9124, longitude: 75.7873 })
    expect(mockMap.animateToRegion).toHaveBeenCalled()
  })

  it('says how to go on when the location is refused or cannot be found, and puts no pin on the map', async () => {
    mockLocation.granted = false
    const screen = await render(<AddressFormScreen id={null} />, fakeShop(() => mine(), { signedIn: true }))
    await press(screen, t('address.map.useLocation'))
    expect(hasText(screen, t('address.map.denied'))).toBe(true)
    expect(screen.root.findAllByProps({ testID: 'marker' })).toHaveLength(0)

    Object.assign(mockLocation, { granted: true, fail: true })
    await press(screen, t('address.map.useLocation'))
    expect(hasText(screen, t('address.map.failed'))).toBe(true)
  })

  it('checks the fields the country needs: PIN code for India', async () => {
    const shop = fakeShop(() => mine(), { signedIn: true })
    const screen = await render(<AddressFormScreen id={null} />, shop)
    await fillIndia(screen)
    await fill(screen, t('address.pin'), '12')
    await press(screen, t('address.map.drop'))
    await press(screen, t('address.save'))
    expect(hasText(screen, t('form.invalidPostal'))).toBe(true)
    expect(saves(shop.requests)).toHaveLength(0)
  })

  it('shows the store’s countries to choose from when it sells to several, with the fields of the one chosen', async () => {
    const screen = await render(<AddressFormScreen id={null} />, fakeShop(() => mine([], ['IN', 'US']), { signedIn: true }))
    expect(screen.root.findAll((node) => node.props.accessibilityRole === 'radio').length).toBeGreaterThan(0)
    expect(hasText(screen, t('address.name'))).toBe(false)
    await press(screen, 'United States')
    expect(hasText(screen, t('address.zip'))).toBe(true)
    await press(screen, 'India')
    expect(hasText(screen, t('address.pin'))).toBe(true)
  })

  it('opens a saved address as it is, with its pin, and saves a change to the same address', async () => {
    const shop = fakeShop((r) => (r.query.includes('saveAddress') ? { saveAddress: 'a1' } : mine([saved()])), { signedIn: true })
    const screen = await render(<AddressFormScreen id="a1" />, shop)
    expect(screen.root.findAllByProps({ testID: 'marker' })[0]?.props.coordinate).toEqual({ latitude: 26.9, longitude: 75.8 })
    await fill(screen, t('address.line1'), '2 Lake Rd')
    await press(screen, t('address.save'))
    expect(saves(shop.requests)[0]?.variables).toMatchObject({ id: 'a1', address: { line1: '2 Lake Rd', latitude: 26.9, longitude: 75.8 } })
  })

  it('says an address that is not there is not found', async () => {
    const screen = await render(<AddressFormScreen id="gone" />, fakeShop(() => mine([saved()]), { signedIn: true }))
    expect(hasText(screen, t('addresses.notFound.title'))).toBe(true)
  })

  it('words a refusal by its code and stays on the form', async () => {
    const shop = fakeShop(
      (r) => {
        if (r.query.includes('saveAddress')) throw new ApiError('TOO_MANY', 'x')
        return mine()
      },
      { signedIn: true },
    )
    const screen = await render(<AddressFormScreen id={null} />, shop)
    await fillIndia(screen)
    await press(screen, t('address.map.drop'))
    await press(screen, t('address.save'))
    expect(hasText(screen, t('errors.TOO_MANY'))).toBe(true)
    expect(mockBack).not.toHaveBeenCalled()
    expect(pressableNamed(screen, t('address.save'))).toBeDefined()
  })
})
