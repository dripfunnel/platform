import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, type Request } from '../../testing/harness'
import { EmailCodeScreen } from './EmailCodeScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn(), canGoBack: () => true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const fill = async (screen: ReactTestRenderer, label: string, value: string) => {
  const input = screen.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!input) throw new Error(`No field "${label}"`)
  await act(async () => input.props.onChangeText(value))
}

const answer = (request: Request) => (request.query.includes('verifySignInCode') ? { verifySignInCode: { sessionToken: 'sess-9' } } : { requestSignInCode: true })
const calls = (requests: Request[], name: string) => requests.filter((r) => r.query.includes(name))

beforeEach(() => mockBack.mockClear())

describe('creating an account', () => {
  it('sends a code to the email, then makes the account with the code, a name and a password', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<EmailCodeScreen mode="register" />, shop)
    await fill(screen, t('auth.email'), 'ana@example.com')
    await press(screen, t('auth.sendCode'))
    expect(calls(shop.requests, 'requestSignInCode')[0]?.variables).toEqual({ channel: 'EMAIL', to: 'ana@example.com' })

    await fill(screen, t('auth.code'), '123456')
    await fill(screen, t('auth.register.name'), 'Ana Rao')
    await fill(screen, t('auth.password'), 'a long enough password')
    await press(screen, t('auth.register.button'))
    expect(calls(shop.requests, 'verifySignInCode')[0]?.variables).toEqual({ channel: 'EMAIL', to: 'ana@example.com', code: '123456', name: 'Ana Rao', password: 'a long enough password' })
    expect(shop.sessions).toEqual(['sess-9'])
    expect(mockBack).toHaveBeenCalled()
  })

  it('needs a name and a password of ten characters before it asks the API', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<EmailCodeScreen mode="register" />, shop)
    await fill(screen, t('auth.email'), 'ana@example.com')
    await press(screen, t('auth.sendCode'))
    await fill(screen, t('auth.code'), '123456')
    await fill(screen, t('auth.password'), 'short')
    await press(screen, t('auth.register.button'))
    expect(hasText(screen, t('form.shortPassword'))).toBe(true)
    expect(hasText(screen, t('form.required'))).toBe(true)
    expect(calls(shop.requests, 'verifySignInCode')).toHaveLength(0)
  })

  it('words a refused code by its code and keeps no session', async () => {
    const shop = fakeShop((request) => {
      if (request.query.includes('verifySignInCode')) throw new ApiError('CODE_REFUSED', 'x')
      return { requestSignInCode: true }
    })
    const screen = await render(<EmailCodeScreen mode="register" />, shop)
    await fill(screen, t('auth.email'), 'ana@example.com')
    await press(screen, t('auth.sendCode'))
    await fill(screen, t('auth.code'), '000000')
    await fill(screen, t('auth.register.name'), 'Ana')
    await fill(screen, t('auth.password'), 'a long enough password')
    await press(screen, t('auth.register.button'))
    expect(hasText(screen, t('errors.CODE_REFUSED'))).toBe(true)
    expect(shop.sessions).toEqual([])
  })
})

describe('resetting a password', () => {
  it('uses the same code, with a new password and no name, and signs the shopper in', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<EmailCodeScreen mode="reset" />, shop)
    expect(hasText(screen, t('auth.reset.intro'))).toBe(true)
    await fill(screen, t('auth.email'), 'ana@example.com')
    await press(screen, t('auth.sendCode'))
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === t('auth.register.name'))).toHaveLength(0)
    await fill(screen, t('auth.code'), '654321')
    await fill(screen, t('auth.reset.newPassword'), 'my brand new password')
    await press(screen, t('auth.reset.button'))
    expect(calls(shop.requests, 'verifySignInCode')[0]?.variables).toEqual({ channel: 'EMAIL', to: 'ana@example.com', code: '654321', name: null, password: 'my brand new password' })
    expect(shop.sessions).toEqual(['sess-9'])
  })

  it('refuses a malformed email without asking the API, and lets the shopper change the email after the code is sent', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<EmailCodeScreen mode="reset" />, shop)
    await fill(screen, t('auth.email'), 'nope')
    await press(screen, t('auth.sendCode'))
    expect(hasText(screen, t('form.invalidEmail'))).toBe(true)
    expect(calls(shop.requests, 'requestSignInCode')).toHaveLength(0)
    await fill(screen, t('auth.email'), 'ana@example.com')
    await press(screen, t('auth.sendCode'))
    await press(screen, t('auth.differentEmail'))
    expect(hasText(screen, t('auth.sendCode'))).toBe(true)
  })
})
