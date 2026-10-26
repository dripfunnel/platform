import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, type Request } from '../../testing/harness'
import { AddressesScreen } from './AddressesScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const address = (id: string, over: object = {}) => ({ id, name: `Home ${id}`, line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: null, isDefault: false, latitude: 26.9, longitude: 75.8, ...over })
const mine = (addresses: object[]) => ({ account: { name: 'Ana', email: 'ana@example.com', phone: null, addresses }, store: { markets: [{ countries: ['IN'] }] } })

beforeEach(() => mockPush.mockClear())

describe('saved addresses', () => {
  it('lists each address with its default mark and whether it has a pin', async () => {
    const screen = await render(<AddressesScreen />, fakeShop(() => mine([address('a1', { isDefault: true }), address('a2', { latitude: null, longitude: null })]), { signedIn: true }))
    expect(hasText(screen, 'Home a1')).toBe(true)
    expect(hasText(screen, t('addresses.default'))).toBe(true)
    expect(hasText(screen, t('addresses.pinned'))).toBe(true)
    expect(hasText(screen, t('addresses.noPin'))).toBe(true)
    expect(hasText(screen, '1 Lake Rd, Jaipur, Rajasthan, 302017, India')).toBe(true)
  })

  it('has an empty state that offers to add one', async () => {
    const screen = await render(<AddressesScreen />, fakeShop(() => mine([]), { signedIn: true }))
    expect(hasText(screen, t('addresses.empty.title'))).toBe(true)
    await press(screen, t('addresses.add'))
    expect(mockPush).toHaveBeenCalledWith('/account/address')
  })

  it('opens an address to edit it', async () => {
    const screen = await render(<AddressesScreen />, fakeShop(() => mine([address('a1')]), { signedIn: true }))
    await press(screen, t('addresses.edit'))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/account/address', params: { id: 'a1' } })
  })

  it('states what deleting an address does before it deletes, and reloads after', async () => {
    let list = [address('a1'), address('a2')]
    const shop = fakeShop(
      (r: Request) => {
        if (r.query.includes('deleteAddress')) {
          list = list.filter((a) => a.id !== r.variables?.id)
          return { deleteAddress: true }
        }
        return mine(list)
      },
      { signedIn: true },
    )
    const screen = await render(<AddressesScreen />, shop)
    await press(screen, t('addresses.delete')) // the first card's
    expect(hasText(screen, t('addresses.deleteBody', { name: 'Home a1' }))).toBe(true)
    expect(shop.requests.some((r) => r.query.includes('deleteAddress'))).toBe(false)
    await press(screen, t('addresses.deleteConfirm'))
    expect(shop.requests.find((r) => r.query.includes('deleteAddress'))?.variables).toEqual({ id: 'a1' })
    expect(hasText(screen, 'Home a1')).toBe(false)
    expect(hasText(screen, 'Home a2')).toBe(true)
  })

  it('can be backed out of without deleting', async () => {
    const shop = fakeShop(() => mine([address('a1')]), { signedIn: true })
    const screen = await render(<AddressesScreen />, shop)
    await press(screen, t('addresses.delete'))
    await press(screen, t('common.cancel'))
    expect(shop.requests.some((r) => r.query.includes('deleteAddress'))).toBe(false)
  })

  it('shows a load error by its code, and says the shopper is signed out when the API knows no account', async () => {
    const broken = await render(
      <AddressesScreen />,
      fakeShop(() => {
        throw new ApiError('SIGNED_OUT', 'x')
      }, { signedIn: true }),
    )
    expect(hasText(broken, t('errors.SIGNED_OUT'))).toBe(true)
    const none = await render(<AddressesScreen />, fakeShop(() => ({ account: null, store: null }), { signedIn: true }))
    expect(hasText(none, t('account.guest.title'))).toBe(true)
  })
})
