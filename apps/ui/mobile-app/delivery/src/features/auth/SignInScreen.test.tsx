import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { errorText, t } from '../../messages'
import { fakeSession, fill, hasButton, hasText, isDisabled, pressableNamed, press, render, type Request } from '../../testing/harness'
import { resendSeconds, SignInScreen, triesPerCode } from './SignInScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('../../api/rider', () => ({ ...jest.requireActual('../../api/rider'), fetchStoreCountry: jest.fn(async () => 'IN') }))

const calls = (requests: Request[], name: string) => requests.filter((r) => r.query.includes(name))

const asksFor = async (screen: ReactTestRenderer, number = '98765 43210') => {
  await fill(screen, t('signIn.phone.number'), number)
  await press(screen, t('signIn.phone.send'))
}

const advance = (seconds: number) => act(async () => void jest.advanceTimersByTime(seconds * 1000))

beforeEach(() => {
  jest.useFakeTimers()
  mockReplace.mockClear()
})
afterEach(() => jest.useRealTimers())

describe('getting in: the mobile number', () => {
  it('preselects the store’s country code and asks for the code in international form', async () => {
    const session = fakeSession(() => ({ requestCode: true }), { signedIn: false })
    const screen = await render(<SignInScreen />, session)
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === t('signIn.phone.countryCode') && node.props.value === '+91')).not.toHaveLength(0)

    await asksFor(screen)

    expect(calls(session.requests, 'requestCode')[0]?.variables).toEqual({ phone: '+919876543210' })
    expect(hasText(screen, t('signIn.code.title'))).toBe(true)
    expect(hasText(screen, '+919876543210')).toBe(true)
  })

  it('does not ask the API for a number that cannot be one', async () => {
    const session = fakeSession(() => ({ requestCode: true }), { signedIn: false })
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen, '12')
    expect(hasText(screen, t('signIn.phone.invalid'))).toBe(true)
    expect(session.requests).toHaveLength(0)
  })

  it('shows a refusal by its code and stays on the number', async () => {
    const session = fakeSession(
      () => {
        throw new ApiError('RATE_LIMITED', 'x')
      },
      { signedIn: false },
    )
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    expect(hasText(screen, errorText('RATE_LIMITED', 'signIn'))).toBe(true)
    expect(hasText(screen, t('signIn.phone.title'))).toBe(true)
  })
})

describe('getting in: the code', () => {
  const answers = (code: (request: Request) => unknown) => (request: Request) => (request.query.includes('requestCode') ? { requestCode: true } : code(request))

  it('waits before the code can be asked for again, then asks again and waits again', async () => {
    const session = fakeSession(answers(() => ({})), { signedIn: false })
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)

    expect(hasText(screen, t('signIn.code.resendIn', { seconds: resendSeconds }))).toBe(true)
    expect(hasButton(screen, t('signIn.code.resend'))).toBe(false)

    await advance(resendSeconds - 1)
    expect(hasText(screen, t('signIn.code.resendIn', { seconds: 1 }))).toBe(true)
    expect(hasButton(screen, t('signIn.code.resend'))).toBe(false)

    await advance(1)
    expect(hasButton(screen, t('signIn.code.resend'))).toBe(true)

    await press(screen, t('signIn.code.resend'))
    expect(calls(session.requests, 'requestCode')).toHaveLength(2)
    expect(hasText(screen, t('signIn.code.resent'))).toBe(true)
    expect(hasText(screen, t('signIn.code.resendIn', { seconds: resendSeconds }))).toBe(true)
  })

  it('takes only a 6-digit code before asking the API', async () => {
    const session = fakeSession(answers(() => ({})), { signedIn: false })
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    await fill(screen, t('signIn.code.label'), '12ab')
    await press(screen, t('signIn.code.submit'))
    expect(hasText(screen, t('signIn.code.invalid'))).toBe(true)
    expect(calls(session.requests, 'signIn(')).toHaveLength(0)
  })

  it('keeps the session and goes on when the code is right', async () => {
    const session = fakeSession(answers(() => ({ signIn: { sessionToken: 'token-1' } })), { signedIn: false })
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    await fill(screen, t('signIn.code.label'), '123456')
    await press(screen, t('signIn.code.submit'))

    expect(calls(session.requests, 'signIn(')[0]?.variables).toEqual({ phone: '+919876543210', code: '123456' })
    expect(session.events).toEqual(['start:token-1'])
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('words a wrong code the same for a number that was never invited', async () => {
    const session = fakeSession(
      answers(() => {
        throw new ApiError('CODE_REFUSED', 'x')
      }),
      { signedIn: false },
    )
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    await fill(screen, t('signIn.code.label'), '111111')
    await press(screen, t('signIn.code.submit'))
    expect(hasText(screen, errorText('CODE_REFUSED', 'signIn'))).toBe(true)
    expect(hasText(screen, 'invite this number')).toBe(true)
  })

  it('says a suspended rider’s account is paused', async () => {
    const session = fakeSession(
      answers(() => {
        throw new ApiError('RIDER_SUSPENDED', 'x')
      }),
      { signedIn: false },
    )
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    await fill(screen, t('signIn.code.label'), '111111')
    await press(screen, t('signIn.code.submit'))
    expect(hasText(screen, errorText('RIDER_SUSPENDED'))).toBe(true)
    expect(session.events).toEqual([])
  })

  it('locks the code after its tries are used, and offers no new one', async () => {
    const session = fakeSession(
      answers(() => {
        throw new ApiError('CODE_REFUSED', 'x')
      }),
      { signedIn: false },
    )
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    for (let attempt = 0; attempt < triesPerCode; attempt += 1) {
      await fill(screen, t('signIn.code.label'), '111111')
      await press(screen, t('signIn.code.submit'))
    }
    expect(hasText(screen, errorText('RATE_LIMITED', 'signIn'))).toBe(true)
    expect(isDisabled(pressableNamed(screen, t('signIn.code.submit')))).toBe(true)
    await advance(resendSeconds)
    expect(hasButton(screen, t('signIn.code.resend'))).toBe(false)
  })

  it('goes back to the number to change it', async () => {
    const session = fakeSession(answers(() => ({})), { signedIn: false })
    const screen = await render(<SignInScreen />, session)
    await asksFor(screen)
    await press(screen, t('signIn.code.change'))
    expect(hasText(screen, t('signIn.phone.title'))).toBe(true)
  })
})
