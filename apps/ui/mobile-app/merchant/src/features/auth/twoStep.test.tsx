import { AccessibilityInfo } from 'react-native'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { t } from '../../messages'
import { hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { pendingStore, type Pending } from './pending'
import { TwoStepScreen } from './TwoStepScreen'

// The two-step screen's phone code (#1509, ACCESS.md §4): where it went, and after 20 seconds "Send again on WhatsApp"
// and, while SMS is open, "Send by SMS instead", against answers shaped as the Store API's send-code route gives them.
jest.setTimeout(120_000)

type Answer = Record<string, unknown> | null
const mockNetwork: { answer: (body: Record<string, unknown>) => Answer; bodies: Record<string, unknown>[] } = { answer: () => null, bodies: [] }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }), Redirect: () => null }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ useSession: () => ({ status: 'signedOut', notice: null }), session: () => ({}), restOptions: () => ({ domain: 'store.example.com' }) }))
// A fake portal host: null is no answer at all, as offline.
jest.mock('./deps', () => ({
  flowDeps: () => ({
    rest: {
      domain: 'store.example.com',
      fetchImpl: (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as Record<string, unknown>
        mockNetwork.bodies.push(body)
        const answer = mockNetwork.answer(body)
        return answer ? Promise.resolve({ json: () => Promise.resolve(answer) }) : Promise.reject(new TypeError('Network request failed'))
      },
    },
    session: { open: jest.fn() },
    pending: jest.requireActual<typeof import('./pending')>('./pending').pendingStore,
  }),
}))

const both = { whatsapp: true, sms: true }
const sentBy = (channel: string, codeChannels = both) => ({ ok: true, hint: '•••• 1234', channel, codeChannels })
const refusal = (code: string, more: Record<string, unknown> = {}) => ({ ok: false, code, ...more })

const open = async (change: Partial<Extract<Pending, { step: 'second-factor' }>> = {}): Promise<ReactTestRenderer> => {
  await act(async () => pendingStore.set({ step: 'second-factor', token: 'pending-token', method: 'sms', sent: { channel: 'whatsapp', hint: '•••• 1234' }, channels: both, opening: null, ...change }))
  return renderShell(<TwoStepScreen />)
}

const tick = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) await act(async () => void jest.advanceTimersByTime(1000))
}

const againWhatsapp = t('codeResend.againWhatsapp')
const insteadSms = t('codeResend.insteadSms')
const links = (renderer: ReactTestRenderer) => [againWhatsapp, insteadSms, t('codeResend.insteadWhatsapp'), t('codeResend.againSms'), t('codeResend.sendWhatsapp'), t('codeResend.sendSms')].filter((label) => pressablesNamed(renderer, label).length > 0)

beforeEach(() => {
  jest.useFakeTimers()
  mockNetwork.answer = (body) => sentBy(typeof body.channel === 'string' ? body.channel : 'whatsapp')
  mockNetwork.bodies = []
  jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear()
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('the two-step screen’s phone code', () => {
  it('says the code went to WhatsApp, and after 20 seconds offers it again on WhatsApp or by SMS', async () => {
    const renderer = await open()
    expect(hasText(renderer, t('auth.twoStepSms'))).toBe(true)
    expect(hasText(renderer, 'We sent a code to WhatsApp on •••• 1234.')).toBe(true)
    expect(hasText(renderer, 'You can ask again in 20s.')).toBe(true)
    expect(links(renderer)).toEqual([])

    await tick(19)
    expect(hasText(renderer, 'You can ask again in 1s.')).toBe(true)
    expect(links(renderer)).toEqual([])

    await tick(1)
    expect(links(renderer)).toEqual([againWhatsapp, insteadSms])
    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'link' && node.props.accessibilityLabel === insteadSms).length).toBeGreaterThan(0)
  })

  it('announces the wait as it starts and as it ends, politely, never each second', async () => {
    await open()
    await tick(20)
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    expect(announce.mock.calls).toEqual([
      ['We sent a code to WhatsApp on •••• 1234. You can ask for another code in a few seconds.', { queue: true }],
      [t('codeResend.readyAnnounced'), { queue: true }],
    ])
  })

  it('sends it by SMS on "Send by SMS instead", says so, and waits again', async () => {
    const renderer = await open()
    await tick(20)
    await press(pressableNamed(renderer, insteadSms))

    expect(mockNetwork.bodies.at(-1)).toEqual({ channel: 'sms' })
    expect(hasText(renderer, 'Sent by SMS to •••• 1234.')).toBe(true)
    expect(hasText(renderer, t('auth.resent'))).toBe(true)
    expect(hasText(renderer, 'You can ask again in 20s.')).toBe(true)
    await tick(20)
    expect(links(renderer)).toEqual([t('codeResend.insteadWhatsapp'), t('codeResend.againSms')])
  })

  it('sends it again on WhatsApp on "Send again on WhatsApp"', async () => {
    const renderer = await open()
    await tick(20)
    await press(pressableNamed(renderer, againWhatsapp))
    expect(mockNetwork.bodies.at(-1)).toEqual({ channel: 'whatsapp' })
    expect(hasText(renderer, 'We sent a code to WhatsApp on •••• 1234.')).toBe(true)
  })

  it('hides the SMS link while SMS is off', async () => {
    const renderer = await open({ channels: { whatsapp: true, sms: false } })
    await tick(20)
    expect(links(renderer)).toEqual([againWhatsapp])
  })

  it('waits the seconds the API gives when SMS is asked for too soon', async () => {
    mockNetwork.answer = (body) => (body.channel === 'sms' ? refusal('TOO_SOON', { seconds: 12 }) : sentBy('whatsapp'))
    const renderer = await open()
    await tick(20)
    await press(pressableNamed(renderer, insteadSms))
    expect(hasText(renderer, 'Wait 12s, then ask again.')).toBe(true)
    expect(hasText(renderer, 'You can ask again in 12s.')).toBe(true)
    expect(hasText(renderer, 'We sent a code to WhatsApp on •••• 1234.')).toBe(true)
  })

  it('drops SMS when the API says it is off, and says to ask on WhatsApp', async () => {
    mockNetwork.answer = (body) => (body.channel === 'sms' ? refusal('CHANNEL_OFF') : sentBy('whatsapp'))
    const renderer = await open()
    await tick(20)
    await press(pressableNamed(renderer, insteadSms))
    expect(hasText(renderer, t('codeResend.off.sms'))).toBe(true)
    expect(links(renderer)).toEqual([againWhatsapp])
  })

  it('says when there is no connection, and keeps the links to try again', async () => {
    mockNetwork.answer = () => null
    const renderer = await open()
    await tick(20)
    await press(pressableNamed(renderer, insteadSms))
    expect(hasText(renderer, t('errors.NO_RESPONSE'))).toBe(true)
    expect(links(renderer)).toEqual([againWhatsapp, insteadSms])
  })

  it('opens saying why no code went, with no links while neither channel can send', async () => {
    const renderer = await open({ sent: null, channels: { whatsapp: false, sms: false }, opening: { text: t('errors.code.CHANNEL_OFF'), wait: null } })
    expect(hasText(renderer, t('auth.twoStepSmsUnsent'))).toBe(true)
    expect(hasText(renderer, t('errors.code.CHANNEL_OFF'))).toBe(true)
    expect(links(renderer)).toEqual([])
    expect(pressablesNamed(renderer, t('auth.useBackup'))).toHaveLength(1)
  })

  it('offers a first code at once when the opening send failed offline', async () => {
    const renderer = await open({ sent: null, opening: { text: t('errors.NO_RESPONSE'), wait: null } })
    expect(links(renderer)).toEqual([t('codeResend.sendWhatsapp'), t('codeResend.sendSms')])
    await press(pressableNamed(renderer, t('codeResend.sendWhatsapp')))
    expect(hasText(renderer, 'We sent a code to WhatsApp on •••• 1234.')).toBe(true)
    expect(hasText(renderer, t('auth.resent'))).toBe(false)
  })

  it('shows no phone links for an authenticator app, and never a full number', async () => {
    const app = await open({ method: 'app', sent: null, channels: { whatsapp: false, sms: false } })
    expect(hasText(app, t('auth.twoStepApp'))).toBe(true)
    await tick(20)
    expect(links(app)).toEqual([])

    const phone = await open()
    await tick(20)
    expect(texts(phone).join(' ')).not.toMatch(/\d{5,}/)
  })
})
