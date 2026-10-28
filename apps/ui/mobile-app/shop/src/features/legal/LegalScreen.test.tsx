import * as WebBrowser from 'expo-web-browser'
import { act } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, hasText, isDisabled, press, pressableNamed, render } from '../../testing/harness'
import { LegalScreen } from './LegalScreen'
import { PolicyLinks } from './PolicyLinks'

jest.setTimeout(120_000)

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
type NetState = { isConnected: boolean; isInternetReachable: boolean }
const mockNet: { listener: ((state: NetState) => void) | null } = { listener: null }
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetState) => void) => {
      mockNet.listener = listener
      return () => undefined
    },
  },
}))

const mockOpen = jest.mocked(WebBrowser.openBrowserAsync)

beforeEach(() => mockOpen.mockReset().mockResolvedValue({ type: 'dismiss' } as unknown as WebBrowser.WebBrowserResult))

describe('the legal pages', () => {
  it('lists the five pages and opens each from the storefront’s address, built from the store’s host', async () => {
    const screen = await render(<LegalScreen />, fakeShop(() => ({})))
    expect(hasText(screen, t('legal.note', { host: 'acme.my-store.one' }))).toBe(true)
    await press(screen, t('legal.terms'))
    expect(mockOpen).toHaveBeenLastCalledWith('https://acme.my-store.one/policies/terms/')
    await press(screen, t('legal.shipping'))
    expect(mockOpen).toHaveBeenLastCalledWith('https://acme.my-store.one/policies/shipping/')
    await press(screen, t('legal.notice'))
    expect(mockOpen).toHaveBeenLastCalledWith('https://acme.my-store.one/policies/legal/')
  })

  it('say when a page could not be opened', async () => {
    mockOpen.mockRejectedValue(new Error('no browser'))
    const screen = await render(<LegalScreen />, fakeShop(() => ({})))
    await press(screen, t('legal.privacy'))
    expect(hasText(screen, t('legal.failed'))).toBe(true)
  })

  it('are links beside the checkout’s review sentence, one for each page it names', async () => {
    const screen = await render(<PolicyLinks kinds={['terms', 'returns', 'privacy']} />, fakeShop(() => ({})))
    await press(screen, t('legal.returns'))
    expect(mockOpen).toHaveBeenLastCalledWith('https://acme.my-store.one/policies/returns/')
    expect(() => pressableNamed(screen, t('legal.shipping'))).toThrow()
  })

  it('are off while the phone is offline, since they are the website’s pages', async () => {
    const screen = await render(<LegalScreen />, fakeShop(() => ({})))
    await act(async () => mockNet.listener?.({ isConnected: false, isInternetReachable: false }))
    expect(isDisabled(pressableNamed(screen, t('legal.terms')))).toBe(true)
    await act(async () => mockNet.listener?.({ isConnected: true, isInternetReachable: true }))
    expect(isDisabled(pressableNamed(screen, t('legal.terms')))).toBe(false)
  })
})
