// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../../api/profile'
import { fill, messages } from '../../messages'
import { productName } from '../common/productName'

// My profile's cards driven as a person would: password, two-step, details, appearance and activity paging.

const words = messages.profile
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('../../api/profile')
})

const profile = (twoFactor: Profile['twoFactor'], extra: Partial<Profile> = {}): Profile => ({
  name: 'Farhan Ali',
  email: 'farhan@kesari.example',
  pendingEmail: null,
  phone: '+919845011234',
  theme: null,
  passwordChangedAt: null,
  twoFactor,
  codeChannels: { whatsapp: true, sms: true },
  ...extra,
})
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
// The closed "turn off" dialog has a password field too; the set-up's comes first.
const setUpPassword = (value: string) => fireEvent.change(screen.getAllByLabelText(words.twoStep.password)[0] as HTMLElement, { target: { value } })

describe('two-step sign-in', () => {
  it('offers everyone, an Owner included, the way to turn it off, only with their password (#1008)', async () => {
    const turnOffSecondFactor = vi.fn().mockResolvedValue(undefined)
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), turnOffSecondFactor }))
    const { TwoStep } = await import('./TwoStep')
    const view = render(<TwoStep profile={profile({ method: 'app', backupCodesLeft: 8 })} onChanged={() => undefined} onToast={() => undefined} />)
    expect(screen.getByRole('button', { name: words.twoStep.turnOff })).toBeTruthy()
    view.unmount()

    const onChanged = vi.fn()
    render(<TwoStep profile={profile({ method: 'app', backupCodesLeft: 8 })} onChanged={onChanged} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.turnOff }))
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.offConfirm }))
    expect(turnOffSecondFactor).not.toHaveBeenCalled()
    typeIn(words.twoStep.password, 'my password')
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.offConfirm }))
    await settle()
    expect(turnOffSecondFactor).toHaveBeenCalledWith('my password')
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('sends the password with turning it on and with switching method, never without it', async () => {
    const startSecondFactor = vi.fn().mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', uri: null, hint: null, done: false, backupCodes: null })
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), startSecondFactor }))
    const { TwoStep } = await import('./TwoStep')
    const view = render(<TwoStep profile={profile({ method: null, backupCodesLeft: 0 })} onChanged={() => undefined} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.turnOn }))
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.next }))
    expect(screen.getByRole('alert').textContent).toBe(words.twoStep.passwordMissing)
    expect(startSecondFactor).not.toHaveBeenCalled()
    setUpPassword('pw one')
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.next }))
    await settle()
    expect(startSecondFactor).toHaveBeenLastCalledWith('app', 'pw one')
    view.unmount()

    render(<TwoStep profile={profile({ method: 'app', backupCodesLeft: 8 })} onChanged={() => undefined} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.useSms }))
    setUpPassword('pw two')
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.next }))
    await settle()
    expect(startSecondFactor).toHaveBeenLastCalledWith('sms', 'pw two')
    expect(startSecondFactor).toHaveBeenCalledTimes(2)
  })
})

describe('the phone set-up (ACCESS.md §4)', () => {
  const codes = messages.codeResend
  const tick = async (seconds: number) => {
    await act(async () => vi.advanceTimersByTimeAsync(0))
    for (let i = 0; i < seconds; i++) await act(async () => vi.advanceTimersByTimeAsync(1000))
  }
  const step = (channel: 'whatsapp' | 'sms') => ({ secret: null, uri: null, hint: '•••• 1234', done: false, backupCodes: null, channel })
  const startPhone = async (channels = { whatsapp: true, sms: true }) => {
    const { TwoStep } = await import('./TwoStep')
    render(<TwoStep profile={profile({ method: null, backupCodesLeft: 0 }, { codeChannels: channels })} onChanged={() => undefined} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.turnOn }))
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(words.twoStep.sms) }))
    setUpPassword('pw')
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.next }))
    await tick(0)
  }

  afterEach(() => vi.useRealTimers())

  it('says the code went to WhatsApp, and after 20 seconds sends the next by SMS with the password', async () => {
    vi.useFakeTimers()
    const startSecondFactor = vi.fn().mockResolvedValue(step('whatsapp'))
    const resendSecondFactorCode = vi.fn().mockResolvedValue(step('sms'))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), startSecondFactor, resendSecondFactorCode }))
    await startPhone()
    expect(screen.getByText(fill(codes.sentWhatsapp, { hint: '•••• 1234' }))).toBeTruthy()
    expect(screen.queryByRole('button', { name: codes.insteadSms })).toBeNull()
    await tick(20)
    fireEvent.click(screen.getByRole('button', { name: codes.insteadSms }))
    await tick(0)
    expect(resendSecondFactorCode).toHaveBeenCalledWith('pw', 'sms')
    expect(screen.getByText(fill(codes.sentSms, { hint: '•••• 1234' }))).toBeTruthy()
  })

  it('hides the SMS link while SMS is off, and waits the seconds TOO_SOON names', async () => {
    vi.useFakeTimers()
    const { ApiError } = await import('@dripfunnel/shared/graphql')
    const startSecondFactor = vi.fn().mockResolvedValue(step('whatsapp'))
    const resendSecondFactorCode = vi.fn().mockRejectedValue(new ApiError('TOO_SOON', 'wait', { seconds: 4 }))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), startSecondFactor, resendSecondFactorCode }))
    await startPhone({ whatsapp: true, sms: false })
    await tick(20)
    expect(screen.queryByRole('button', { name: codes.insteadSms })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: codes.againWhatsapp }))
    await tick(0)
    expect(screen.getByRole('alert').textContent).toBe(fill(codes.tooSoon, { seconds: '4' }))
    expect(screen.getByText(fill(codes.wait, { seconds: '4' }))).toBeTruthy()
  })

  it('says why no code went when the channel is off', async () => {
    const { ApiError } = await import('@dripfunnel/shared/graphql')
    const startSecondFactor = vi.fn().mockRejectedValue(new ApiError('CHANNEL_OFF', 'off'))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), startSecondFactor }))
    vi.useFakeTimers()
    await startPhone()
    expect(screen.getByRole('alert').textContent).toBe(words.twoStep.noChannel)
  })

  it('offers only the authenticator app while no code can reach the phone, and says a phone method is paused', async () => {
    const { TwoStep } = await import('./TwoStep')
    const off = { whatsapp: false, sms: false }
    const view = render(<TwoStep profile={profile({ method: null, backupCodesLeft: 0 }, { codeChannels: off })} onChanged={() => undefined} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.twoStep.turnOn }))
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([`${words.twoStep.app}${words.twoStep.appPick}`])
    view.unmount()

    const appView = render(<TwoStep profile={profile({ method: 'app', backupCodesLeft: 8 }, { codeChannels: off })} onChanged={() => undefined} onToast={() => undefined} />)
    expect(screen.queryByRole('button', { name: words.twoStep.useSms })).toBeNull()
    appView.unmount()

    render(<TwoStep profile={profile({ method: 'sms', backupCodesLeft: 8 }, { codeChannels: off })} onChanged={() => undefined} onToast={() => undefined} />)
    expect(screen.getByText(fill(words.twoStep.paused, { product: productName() }))).toBeTruthy()
    expect(screen.getByRole('button', { name: words.twoStep.useApp })).toBeTruthy()
  })
})

describe('your details', () => {
  it('asks for the password before sending a new email, and keeps saved details when the email is refused', async () => {
    const { ApiError } = await import('@dripfunnel/shared/graphql')
    const saved = profile({ method: null, backupCodesLeft: 0 }, { name: 'Farhan A' })
    const updateProfile = vi.fn().mockResolvedValue(saved)
    const changeEmail = vi.fn().mockRejectedValue(new ApiError('INVALID_CREDENTIALS', 'no'))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), updateProfile, changeEmail }))
    const { Details } = await import('./Details')
    const onSaved = vi.fn()
    render(<Details profile={profile({ method: null, backupCodesLeft: 0 })} onSaved={onSaved} onChanged={() => undefined} onToast={() => undefined} />)
    typeIn(words.details.name, 'Farhan A')
    typeIn(words.details.email, 'farhan@new.example')
    fireEvent.click(screen.getByRole('button', { name: words.details.save }))
    expect(screen.getByRole('alert').textContent).toBe(words.details.passwordMissing)
    expect(updateProfile).not.toHaveBeenCalled()
    expect(changeEmail).not.toHaveBeenCalled()

    typeIn(words.details.password, 'wrong')
    fireEvent.click(screen.getByRole('button', { name: words.details.save }))
    await settle()
    expect(updateProfile).toHaveBeenCalledWith({ name: 'Farhan A', phone: '+919845011234' })
    expect(changeEmail).toHaveBeenCalledWith('farhan@new.example', 'wrong')
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(screen.getByRole('alert').textContent).toBe(words.twoStep.wrongPassword)
  })
})

describe('appearance', () => {
  it('saves only the theme, and puts this device back when the account refuses it', async () => {
    const setTheme = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(profile({ method: null, backupCodesLeft: 0 }, { theme: 'dark' }))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), setTheme }))
    const { Appearance } = await import('./Appearance')
    const onFailed = vi.fn()
    const onSaved = vi.fn()
    render(<Appearance saved="light" onSaved={onSaved} onFailed={onFailed} />)
    const dark = screen.getByRole('radio', { name: words.appearance.dark })
    fireEvent.click(dark)
    await settle()
    expect(setTheme).toHaveBeenCalledWith('dark')
    expect(onFailed).toHaveBeenCalledOnce()
    expect(localStorage.getItem('df-store-theme')).toBe('light')
    fireEvent.click(dark)
    await settle()
    expect(onSaved).toHaveBeenCalledOnce()
    expect(localStorage.getItem('df-store-theme')).toBe('dark')
  })

  it('lets only the latest pick answer, so a slow refusal of an earlier one changes nothing', async () => {
    let refuseDark: (() => void) | undefined
    const setTheme = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (refuseDark = () => reject(new Error('offline')))))
      .mockResolvedValueOnce(profile({ method: null, backupCodesLeft: 0 }, { theme: 'light' }))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), setTheme }))
    const { Appearance } = await import('./Appearance')
    const onFailed = vi.fn()
    render(<Appearance saved="dark" onSaved={() => undefined} onFailed={onFailed} />)
    fireEvent.click(screen.getByRole('radio', { name: words.appearance.dark }))
    fireEvent.click(screen.getByRole('radio', { name: words.appearance.light }))
    await settle()
    await act(async () => refuseDark?.())
    await settle()
    expect(onFailed).not.toHaveBeenCalled()
    expect(localStorage.getItem('df-store-theme')).toBe('light')
  })
})

describe('changing your password', () => {
  it('closes the form and clears its fields once the change is made, and keeps them open on a refusal', async () => {
    const { ApiError } = await import('@dripfunnel/shared/graphql')
    const changePassword = vi.fn().mockRejectedValueOnce(new ApiError('INVALID_CREDENTIALS', 'no')).mockResolvedValueOnce(undefined)
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), changePassword }))
    const { PasswordCard } = await import('./PasswordCard')
    const onChanged = vi.fn()
    render(<PasswordCard changedAt={null} onChanged={onChanged} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.password.open }))
    typeIn(words.password.current, 'old one')
    typeIn(words.password.next, 'a long new one')
    typeIn(words.password.again, 'a long new one')
    fireEvent.click(screen.getByRole('button', { name: words.password.save }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.twoStep.wrongPassword)
    expect((screen.getByLabelText(words.password.next) as HTMLInputElement).value).toBe('a long new one')
    fireEvent.click(screen.getByRole('button', { name: words.password.save }))
    await settle()
    expect(changePassword).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText(words.password.current)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.password.open }))
    expect((screen.getByLabelText(words.password.current) as HTMLInputElement).value).toBe('')
  })

  it('shows or hides each box with its own eye button, starting hidden (#1747)', async () => {
    const { PasswordCard } = await import('./PasswordCard')
    render(<PasswordCard changedAt={null} onChanged={() => undefined} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.password.open }))
    const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement
    typeIn(words.password.next, 'a long new one')
    expect(screen.getAllByRole('button', { name: words.password.showPassword })).toHaveLength(3)
    expect([words.password.current, words.password.next, words.password.again].map((label) => box(label).type)).toEqual(['password', 'password', 'password'])
    fireEvent.click(screen.getAllByRole('button', { name: words.password.showPassword })[1] as HTMLElement)
    expect([words.password.current, words.password.next, words.password.again].map((label) => box(label).type)).toEqual(['password', 'text', 'password'])
    expect(box(words.password.next).value).toBe('a long new one')
    const hide = screen.getByRole('button', { name: words.password.hidePassword })
    expect(hide.hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(hide)
    expect(box(words.password.next).type).toBe('password')
    expect(screen.queryByRole('button', { name: words.password.hidePassword })).toBeNull()
  })
})

describe('your activity', () => {
  it('asks for an older page once however fast it is clicked, and keeps the rows when it fails', async () => {
    const entry = (id: string) => ({ id, occurredAt: '2026-10-05T00:00:00.000Z', action: 'person.signed_in', result: 'success' as const, storeId: null, target: null })
    let release: (() => void) | undefined
    const loadMyActivity = vi
      .fn()
      .mockResolvedValueOnce({ entries: [entry('a')], next: 'c1' })
      .mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(new Error('offline')))))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), loadMyActivity }))
    const { MyActivity } = await import('./MyActivity')
    render(<MyActivity storeNames={new Map()} />)
    await settle()
    const more = screen.getByRole('button', { name: words.activity.more })
    fireEvent.click(more)
    fireEvent.click(more)
    await settle()
    expect(loadMyActivity).toHaveBeenCalledTimes(2)
    expect(screen.getByText(words.activity.loading)).toBeTruthy()
    await act(async () => release?.())
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.activity.error)
    expect(screen.getAllByText(words.activity.actions['person.signed_in'])).toHaveLength(1)
  })
})
