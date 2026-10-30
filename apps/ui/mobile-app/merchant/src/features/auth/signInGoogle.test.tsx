import type { Brand } from '../../api/brand'
import { BrandContext } from '../../brand/BrandContext'
import { t } from '../../messages'
import { hasText, press, pressableNamed, renderShell } from '../../testing/harness'
import { GoogleCancelled, googleClients, googleIdToken } from './google'
import { SignInScreen } from './SignInScreen'
import { startGoogleSignIn } from './signInFlow'

// Continue with Google on the app's Sign in (#1048): there only while the partner's Google client is on and the build has
// its clients, and each way it ends goes where a password sign-in would, or is worded.
jest.setTimeout(120_000)

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ useSession: () => ({ status: 'signedOut', notice: null }), session: () => ({}), restOptions: () => ({ domain: 'store.example.com' }) }))
// The whole module: its library needs a native binary a test run hasn't got.
jest.mock('./google', () => {
  class GoogleCancelled extends Error {}
  class GoogleUnavailable extends Error {}
  return { GoogleCancelled, GoogleUnavailable, googleClients: jest.fn(), googleIdToken: jest.fn() }
})
jest.mock('./signInFlow', () => ({ ...jest.requireActual<typeof import('./signInFlow')>('./signInFlow'), startGoogleSignIn: jest.fn() }))

const clients = { webClientId: 'web-client', iosClientId: 'ios-client' }
const brand = (googleSignIn: boolean): Brand => ({ productName: 'Northstar', primaryColor: null, accentColor: null, font: null, corner: null, helpUrl: null, supportUrl: null, supportEmail: null, googleSignIn, files: { logoLight: null, logoDark: null, mark: null } })
const show = (googleSignIn: boolean) =>
  renderShell(
    <BrandContext.Provider value={{ brand: brand(googleSignIn), source: 'network', domain: 'store.example.com' }}>
      <SignInScreen />
    </BrandContext.Provider>,
  )
const google = t('auth.googleButton')

beforeEach(() => {
  jest.mocked(googleClients).mockReturnValue(clients)
  jest.mocked(googleIdToken).mockResolvedValue('id-token')
  mockPush.mockReset()
})

describe('Continue with Google on Sign in', () => {
  it('is there while the partner has Google on and the build carries its clients, and not otherwise', async () => {
    expect(hasText(await show(true), google)).toBe(true)
    expect(hasText(await show(false), google)).toBe(false)
    jest.mocked(googleClients).mockReturnValue(null)
    expect(hasText(await show(true), google)).toBe(false)
  })

  it('sends Google’s token into the sign-in, and goes on to the second step as a password would', async () => {
    jest.mocked(startGoogleSignIn).mockResolvedValue('second-factor')
    const renderer = await show(true)
    await press(pressableNamed(renderer, google))
    expect(googleIdToken).toHaveBeenCalledWith(clients)
    expect(jest.mocked(startGoogleSignIn).mock.calls[0]?.[1]).toBe('id-token')
    expect(mockPush).toHaveBeenCalledWith('/two-step')
  })

  it('says a cancel was a cancel', async () => {
    jest.mocked(googleIdToken).mockRejectedValue(new GoogleCancelled())
    const renderer = await show(true)
    await press(pressableNamed(renderer, google))
    expect(hasText(renderer, t('auth.googleCancelled'))).toBe(true)
  })
})
