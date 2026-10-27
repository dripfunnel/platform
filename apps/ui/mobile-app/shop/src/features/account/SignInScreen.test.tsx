import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { TextInput } from 'react-native'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, type Answer, type Request } from '../../testing/harness'
import { SignInScreen } from './SignInScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockBack = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: mockReplace, push: jest.fn(), canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const store = (ways: { email: boolean; phone: boolean }, handle: (request: Request) => unknown = () => ({})): Answer => (request) => (request.query.includes('signInOptions') ? { signInOptions: ways } : handle(request))

const fill = async (screen: ReactTestRenderer, label: string, value: string) => {
  const input = screen.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!input) throw new Error(`No field "${label}"`)
  await act(async () => input.props.onChangeText(value))
}

const calls = (requests: Request[], name: string) => requests.filter((r) => r.query.includes(name))

beforeEach(() => {
  mockBack.mockClear()
  mockReplace.mockClear()
})

describe('getting in', () => {
  it('shows only the email and password form when the store signs in by email', async () => {
    const screen = await render(<SignInScreen />, fakeShop(store({ email: true, phone: false })))
    expect(hasText(screen, t('auth.password'))).toBe(true)
    expect(screen.root.findAll((node) => node.props.accessibilityRole === 'tab')).toHaveLength(0)
    expect(hasText(screen, t('auth.phone'))).toBe(false)
  })

  it('shows only the mobile code form when the store signs in by code', async () => {
    const screen = await render(<SignInScreen />, fakeShop(store({ email: false, phone: true })))
    expect(hasText(screen, t('auth.phone'))).toBe(true)
    expect(hasText(screen, t('auth.password'))).toBe(false)
    expect(screen.root.findAll((node) => node.props.accessibilityRole === 'tab')).toHaveLength(0)
    expect(hasText(screen, t('auth.forgot'))).toBe(false)
  })

  it('offers both ways when the store allows both, and switches between them', async () => {
    const screen = await render(<SignInScreen />, fakeShop(store({ email: true, phone: true })))
    expect(hasText(screen, t('auth.tabs.email'))).toBe(true)
    expect(hasText(screen, t('auth.tabs.phone'))).toBe(true)
    expect(hasText(screen, t('auth.password'))).toBe(true)
    await act(async () => screen.root.findAll((node) => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function')[1]?.props.onPress())
    expect(hasText(screen, t('auth.sendCode'))).toBe(true)
    expect(hasText(screen, t('auth.password'))).toBe(false)
  })

  it('says sign-in is not available when the store takes neither way', async () => {
    const screen = await render(<SignInScreen />, fakeShop(store({ email: false, phone: false })))
    expect(hasText(screen, t('auth.noMethods.title'))).toBe(true)
  })

  it('checks the email and password before asking the API', async () => {
    const shop = fakeShop(store({ email: true, phone: false }))
    const screen = await render(<SignInScreen />, shop)
    await press(screen, t('auth.signInButton'))
    expect(hasText(screen, t('form.required'))).toBe(true)
    await fill(screen, t('auth.email'), 'not an email')
    await fill(screen, t('auth.password'), 'secret-password')
    await press(screen, t('auth.signInButton'))
    expect(hasText(screen, t('form.invalidEmail'))).toBe(true)
    expect(calls(shop.requests, 'signIn(').length).toBe(0)
  })

  it('signs in with email and password, keeps the session token, and goes back', async () => {
    const shop = fakeShop(store({ email: true, phone: false }, () => ({ signIn: { sessionToken: 'sess-1' } })))
    const screen = await render(<SignInScreen />, shop)
    await fill(screen, t('auth.email'), ' ana@example.com ')
    await fill(screen, t('auth.password'), 'correct horse battery')
    await press(screen, t('auth.signInButton'))
    expect(calls(shop.requests, 'signIn(')[0]?.variables).toEqual({ email: 'ana@example.com', password: 'correct horse battery' })
    expect(shop.sessions).toEqual(['sess-1'])
    expect(mockBack).toHaveBeenCalled()
  })

  it('words a wrong password by its code, never saying whether the email has an account, and keeps nothing', async () => {
    const shop = fakeShop(
      store({ email: true, phone: false }, () => {
        throw new ApiError('SIGN_IN_REFUSED', 'x')
      }),
    )
    const screen = await render(<SignInScreen />, shop)
    await fill(screen, t('auth.email'), 'ana@example.com')
    await fill(screen, t('auth.password'), 'wrong password')
    await press(screen, t('auth.signInButton'))
    expect(hasText(screen, t('errors.SIGN_IN_REFUSED'))).toBe(true)
    expect(shop.sessions).toEqual([])
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('signs in by mobile code: asks for the code, then confirms it', async () => {
    const shop = fakeShop(store({ email: false, phone: true }, (request) => (request.query.includes('verifySignInCode') ? { verifySignInCode: { sessionToken: 'sess-2' } } : { requestSignInCode: true })))
    const screen = await render(<SignInScreen />, shop)
    await fill(screen, t('auth.phone'), '98765 43210')
    await press(screen, t('auth.sendCode'))
    expect(hasText(screen, t('form.invalidPhone'))).toBe(true)
    expect(calls(shop.requests, 'requestSignInCode').length).toBe(0)

    await fill(screen, t('auth.phone'), '+91 98765 43210')
    await press(screen, t('auth.sendCode'))
    expect(calls(shop.requests, 'requestSignInCode')[0]?.variables).toEqual({ channel: 'PHONE', to: '+919876543210' })
    expect(hasText(screen, t('auth.codeSent', { to: '+919876543210' }))).toBe(true)

    await fill(screen, t('auth.code'), '12')
    await press(screen, t('auth.signInButton'))
    expect(hasText(screen, t('form.invalidCode'))).toBe(true)
    await fill(screen, t('auth.code'), '123456')
    await press(screen, t('auth.signInButton'))
    expect(calls(shop.requests, 'verifySignInCode')[0]?.variables).toEqual({ channel: 'PHONE', to: '+919876543210', code: '123456', name: null, password: null })
    expect(shop.sessions).toEqual(['sess-2'])
  })

  it('words a wrong code by its code and lets the shopper ask again', async () => {
    const shop = fakeShop(
      store({ email: false, phone: true }, (request) => {
        if (request.query.includes('verifySignInCode')) throw new ApiError('CODE_REFUSED', 'x')
        return { requestSignInCode: true }
      }),
    )
    const screen = await render(<SignInScreen />, shop)
    await fill(screen, t('auth.phone'), '+919876543210')
    await press(screen, t('auth.sendCode'))
    await fill(screen, t('auth.code'), '000000')
    await press(screen, t('auth.signInButton'))
    expect(hasText(screen, t('errors.CODE_REFUSED'))).toBe(true)
    await press(screen, t('auth.sendAgain'))
    expect(calls(shop.requests, 'requestSignInCode')).toHaveLength(2)
  })

  it('shows a load error with a retry when the store’s ways cannot be read', async () => {
    let fail = true
    const screen = await render(
      <SignInScreen />,
      fakeShop((request) => {
        if (fail) throw new ApiError('RATE_LIMITED', 'x')
        return store({ email: true, phone: false })(request)
      }),
    )
    expect(hasText(screen, t('errors.RATE_LIMITED'))).toBe(true)
    fail = false
    await press(screen, t('states.retry'))
    expect(hasText(screen, t('auth.password'))).toBe(true)
  })

  it('has a field for the typed values that a screen reader names', async () => {
    const screen = await render(<SignInScreen />, fakeShop(store({ email: true, phone: false })))
    expect(screen.root.findAllByType(TextInput).map((input) => input.props.accessibilityLabel)).toEqual([t('auth.email'), t('auth.password')])
  })
})
