import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import type { Brand } from '../../api/brand'
import type { Profile } from '../../api/profile'
import { BrandContext } from '../../brand/BrandContext'
import { t } from '../../messages'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { byRole, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { TwoStepSection } from './TwoStepSection'

// My profile's phone set-up (#1509, ACCESS.md §4): the code goes by WhatsApp first, and after 20 seconds it can go again
// on WhatsApp or, while SMS is open, by SMS; with both channels off only the authenticator app is offered.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({}) }))

const both = { whatsapp: true, sms: true }
const none = { whatsapp: false, sms: false }
const profile = (change: Partial<Profile> = {}): Profile => ({
  name: 'Priya',
  email: 'priya@example.com',
  phone: '+919845011234',
  pendingEmail: null,
  passwordChangedAt: null,
  twoFactor: { method: null, backupCodesLeft: null },
  codeChannels: both,
  ...change,
})
const brand: Brand = { productName: 'Northstar', primaryColor: null, accentColor: null, font: null, corner: null, helpUrl: null, supportUrl: null, supportEmail: null, googleSignIn: false, files: { logoLight: null, logoDark: null, mark: null } }
const step = (channel: string) => ({ setSecondFactor: { done: null, hint: '•••• 1234', channel, secret: null, uri: null, backupCodes: null } })
const sendBy = (variables: Record<string, unknown>) => step(typeof variables.channel === 'string' ? variables.channel : 'whatsapp')

const show = async (shown: Profile, start: (variables: Record<string, unknown>) => unknown = sendBy): Promise<{ renderer: ReactTestRenderer; calls: Call[] }> => {
  const { client, calls } = fakeApi({ 'mutation Start': start })
  mockSession.client = client
  const renderer = await renderShell(
    <BrandContext.Provider value={{ brand, source: 'network', domain: 'store.example.com' }}>
      <TwoStepSection profile={shown} onChanged={jest.fn()} />
    </BrandContext.Provider>,
  )
  return { renderer, calls }
}

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

const tick = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) await act(async () => void jest.advanceTimersByTime(1000))
}

const typeInto = async (renderer: ReactTestRenderer, label: string, value: string) => {
  const field = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!field) throw new Error(`no field "${label}"`)
  await act(async () => (field.props.onChangeText as (text: string) => void)(value))
}

/** Turn on, the phone option, the password, Next: the code goes by the default channel. */
const startPhoneSetUp = async (renderer: ReactTestRenderer) => {
  await press(pressableNamed(renderer, t('profile.turnOn')))
  const phone = byRole(renderer, 'radio')[1]
  if (!phone) throw new Error('no phone option')
  await press(phone)
  await typeInto(renderer, t('profile.stepPassword'), 'a long password')
  await press(pressableNamed(renderer, t('profile.next')))
  await settle()
}

const againWhatsapp = t('codeResend.againWhatsapp')
const insteadSms = t('codeResend.insteadSms')
const links = (renderer: ReactTestRenderer) => [againWhatsapp, insteadSms, t('codeResend.insteadWhatsapp'), t('codeResend.againSms')].filter((label) => pressablesNamed(renderer, label).length > 0)
const starts = (calls: Call[]) => calls.filter((call) => call.query.includes('mutation Start')).map((call) => call.variables)

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('My profile’s phone set-up', () => {
  it('says the code went to WhatsApp, and after 20 seconds sends it again on WhatsApp or by SMS, with the password again', async () => {
    const { renderer, calls } = await show(profile())
    await startPhoneSetUp(renderer)

    expect(starts(calls)).toEqual([{ method: 'sms', password: 'a long password', channel: null }])
    expect(hasText(renderer, 'Type the code we sent to •••• 1234')).toBe(true)
    expect(hasText(renderer, 'We sent a code to WhatsApp on •••• 1234.')).toBe(true)
    expect(links(renderer)).toEqual([])

    await tick(20)
    expect(links(renderer)).toEqual([againWhatsapp, insteadSms])

    await press(pressableNamed(renderer, insteadSms))
    await settle()
    expect(starts(calls).at(-1)).toEqual({ method: 'sms', password: 'a long password', channel: 'sms' })
    expect(hasText(renderer, 'Sent by SMS to •••• 1234.')).toBe(true)
    expect(hasText(renderer, 'You can ask again in 20s.')).toBe(true)
  })

  it('hides the SMS link while SMS is off', async () => {
    const { renderer } = await show(profile({ codeChannels: { whatsapp: true, sms: false } }))
    await startPhoneSetUp(renderer)
    await tick(20)
    expect(links(renderer)).toEqual([againWhatsapp])
  })

  it('waits the seconds the API gives when SMS is asked for too soon', async () => {
    const { renderer } = await show(profile(), (variables) => {
      if (variables.channel === 'sms') throw new ApiError('TOO_SOON', 'Wait.', { seconds: 9 })
      return sendBy(variables)
    })
    await startPhoneSetUp(renderer)
    await tick(20)
    await press(pressableNamed(renderer, insteadSms))
    await settle()
    expect(hasText(renderer, 'Wait 9s, then ask again.')).toBe(true)
    expect(hasText(renderer, 'You can ask again in 9s.')).toBe(true)
  })

  it('drops SMS when the API says it is off', async () => {
    const { renderer } = await show(profile(), (variables) => {
      if (variables.channel === 'sms') throw new ApiError('CHANNEL_OFF', 'Off.')
      return sendBy(variables)
    })
    await startPhoneSetUp(renderer)
    await tick(20)
    await press(pressableNamed(renderer, insteadSms))
    await settle()
    expect(hasText(renderer, t('codeResend.off.sms'))).toBe(true)
    expect(links(renderer)).toEqual([againWhatsapp])
  })

  it('says to use an authenticator app when no code can reach the phone', async () => {
    const { renderer } = await show(profile(), () => {
      throw new ApiError('CHANNEL_OFF', 'Off.')
    })
    await startPhoneSetUp(renderer)
    expect(hasText(renderer, t('errors.profile.CHANNEL_OFF'))).toBe(true)
  })

  it('says when there is no connection, and keeps the links', async () => {
    const { renderer } = await show(profile(), (variables) => {
      if (variables.channel) throw new TypeError('Network request failed')
      return sendBy(variables)
    })
    await startPhoneSetUp(renderer)
    await tick(20)
    await press(pressableNamed(renderer, againWhatsapp))
    await settle()
    expect(hasText(renderer, t('errors.NO_RESPONSE'))).toBe(true)
    expect(links(renderer)).toEqual([againWhatsapp, insteadSms])
  })

  it('offers only the authenticator app while both channels are off', async () => {
    const { renderer } = await show(profile({ codeChannels: none }))
    await press(pressableNamed(renderer, t('profile.turnOn')))
    expect(byRole(renderer, 'radio')).toHaveLength(1)
    expect(hasText(renderer, t('profile.methodApp'))).toBe(true)
    expect(hasText(renderer, t('profile.methodSms'))).toBe(false)
  })

  it('tells a phone-method person their codes are paused, and offers the switch to the app', async () => {
    const { renderer } = await show(profile({ twoFactor: { method: 'sms', backupCodesLeft: 8 }, codeChannels: none }))
    expect(hasText(renderer, t('profile.methodSmsPaused', { product: 'Northstar' }))).toBe(true)
    expect(pressablesNamed(renderer, t('profile.useApp'))).toHaveLength(1)

    const app = await show(profile({ twoFactor: { method: 'app', backupCodesLeft: 8 }, codeChannels: none }))
    expect(pressablesNamed(app.renderer, t('profile.useSms'))).toHaveLength(0)
  })
})
