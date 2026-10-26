import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, type Request } from '../../testing/harness'
import { AccountScreen } from './AccountScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const mine = (over: object = {}) => ({ account: { name: 'Ana Rao', email: 'ana@example.com', phone: null, addresses: [{ id: 'a1', name: 'Home', line1: '1 Lake Rd', city: 'Jaipur', country: 'IN' }], ...over }, store: { markets: [{ countries: ['IN'] }] } })

const fill = async (screen: ReactTestRenderer, label: string, value: string) => {
  const input = screen.root.findAll((node) => node.props.accessibilityLabel?.startsWith(label) && typeof node.props.onChangeText === 'function')[0]
  if (!input) throw new Error(`No field "${label}"`)
  await act(async () => input.props.onChangeText(value))
}

beforeEach(() => mockPush.mockClear())

describe('Account', () => {
  it('asks a guest to sign in or create an account, and asks the API for nothing', async () => {
    const shop = fakeShop(() => mine())
    const screen = await render(<AccountScreen />, shop)
    expect(hasText(screen, t('account.guest.title'))).toBe(true)
    expect(shop.requests).toHaveLength(0)
    await press(screen, t('auth.signInButton'))
    expect(mockPush).toHaveBeenLastCalledWith('/sign-in')
    await press(screen, t('auth.create'))
    expect(mockPush).toHaveBeenLastCalledWith('/register')
  })

  it('shows the signed-in shopper’s details and how many addresses are saved, and opens them', async () => {
    const screen = await render(<AccountScreen />, fakeShop(() => mine(), { signedIn: true }))
    expect(hasText(screen, 'ana@example.com')).toBe(true)
    expect(hasText(screen, t('account.addresses', { count: 1 }))).toBe(true)
    await press(screen, t('account.addresses', { count: 1 }))
    expect(mockPush).toHaveBeenLastCalledWith('/account/addresses')
  })

  it('renames the account only once the name has changed', async () => {
    const shop = fakeShop((r: Request) => (r.query.includes('updateAccount') ? { updateAccount: true } : mine()), { signedIn: true })
    const screen = await render(<AccountScreen />, shop)
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === t('account.saveName'))).toHaveLength(0)
    await fill(screen, t('account.name'), '  Ana R  ')
    await press(screen, t('account.saveName'))
    expect(shop.requests.find((r) => r.query.includes('updateAccount'))?.variables).toEqual({ name: 'Ana R' })
  })

  it('signs out: ends the session on the phone and shows the guest state', async () => {
    const shop = fakeShop(() => mine(), { signedIn: true })
    const screen = await render(<AccountScreen />, shop)
    await press(screen, t('account.signOut'))
    expect(shop.sessions).toEqual([null])
  })

  it('lets go of a session the API does not know any more', async () => {
    const shop = fakeShop(() => ({ account: null, store: null }), { signedIn: true })
    const screen = await render(<AccountScreen />, shop)
    expect(shop.sessions).toEqual([null])
    expect(hasText(screen, t('account.guest.title'))).toBe(true)
  })

  it('shows a load error by its code with a retry, and the offline state', async () => {
    let fail: ApiError | null = new ApiError('RATE_LIMITED', 'x')
    const broken = await render(
      <AccountScreen />,
      fakeShop(() => {
        if (fail) throw fail
        return mine()
      }, { signedIn: true }),
    )
    expect(hasText(broken, t('errors.RATE_LIMITED'))).toBe(true)
    fail = null
    await press(broken, t('states.retry'))
    expect(hasText(broken, 'ana@example.com')).toBe(true)

    const offline = await render(
      <AccountScreen />,
      fakeShop(() => {
        throw new ApiError('NO_RESPONSE', 'x')
      }, { signedIn: true }),
    )
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
  })
})
