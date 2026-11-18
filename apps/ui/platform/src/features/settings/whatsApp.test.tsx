// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { senderOf } from '@dripfunnel/shared/messaging'
import { fill, messages } from '../../messages'
import { WhatsAppPanel } from './WhatsAppPanel'

const words = messages.settings.integrations.whatsapp
const token = ['EAAG', 'b'.repeat(40), 'Zx9q'].join('')
const templates = (portal: string | null) => [
  { message: 'code.portal', name: portal },
  { message: 'cart.reminder', name: 'cart_saved' },
  { message: 'cart.reminder_code', name: null },
]
const account = (o: object = {}) => ({ hint: '…Zx9q', businessAccountId: '102030405060', phoneNumberId: '998877665544', language: 'en', templates: templates('portal_code'), status: 'ok', lastTestedAt: '2026-11-16T09:00:00Z', ...o })
type Status = { enabled: boolean; account: object | null; dripfunnel?: boolean; choice?: string | null }
const none: Status = { enabled: false, account: null }
// The API's answer, whose account sends by its own rule (#1543); a test sets `dripfunnel` and `choice` where it needs them.
const answerOf = (s: Status) => ({ dripfunnel: false, choice: null, ...s, sender: senderOf(s.choice ?? null, s.account !== null, s.dripfunnel ?? false) })
const ok = { ok: true, reason: null, status: 'ok', problem: null, template: null }

const sent: string[] = []
let status: Status | 'fail' = none
let answers: Record<string, object | Promise<Response>> = {}
let loads = 0
beforeEach(() => {
  sent.length = 0
  status = none
  answers = {}
  loads = 0
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = String(init.body)
    sent.push(body)
    const mutation = ['saveWhatsAppAccount', 'testWhatsAppAccount', 'setWhatsAppEnabled', 'setWhatsAppChoice', 'removeWhatsAppAccount'].find((m) => body.includes(m))
    if (mutation) {
      const answer = answers[mutation] ?? ok
      return answer instanceof Promise ? answer : Promise.resolve(new Response(JSON.stringify({ data: { [mutation]: answer } })))
    }
    loads += 1
    return status === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(new Response(JSON.stringify({ data: { whatsAppAccount: answerOf(status) } })))
  })
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const fillForm = async (o: { business?: string; portal?: string } = {}) => {
  await userEvent.type(screen.getByLabelText(words.businessAccountLabel), o.business ?? '102030405060')
  await userEvent.type(screen.getByLabelText(words.phoneNumberLabel), '998877665544')
  await userEvent.type(screen.getByLabelText(words.tokenLabel), token)
  if (o.portal !== '') await userEvent.type(screen.getByLabelText(words.messages['code.portal']), o.portal ?? 'portal_code')
}

describe('WhatsApp on Integrations', () => {
  it('says there is no account yet, and offers to set one up', async () => {
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(words.none)).toBeTruthy()
    expect(screen.getByText(words.off)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.setUp })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.turnOn })).toBeNull()
  })

  it('holds back a form not in Meta’s shape, saves one that is, and never shows the token again', async () => {
    const toast = vi.fn()
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await fillForm({ business: 'acme' })
    expect(screen.getByText(words.dialog.incomplete)).toBeTruthy()
    await userEvent.clear(screen.getByLabelText(words.businessAccountLabel))
    await userEvent.type(screen.getByLabelText(words.businessAccountLabel), '102030405060')
    status = { enabled: false, account: account() }
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.saved))
    const save = sent.find((b) => b.includes('saveWhatsAppAccount')) ?? ''
    expect(JSON.parse(save).variables).toEqual({
      accessToken: token,
      businessAccountId: '102030405060',
      phoneNumberId: '998877665544',
      language: 'en',
      templates: [
        { message: 'code.portal', name: 'portal_code' },
        { message: 'cart.reminder', name: '' },
        { message: 'cart.reminder_code', name: '' },
      ],
    })
    expect(await screen.findByText('…Zx9q')).toBeTruthy()
    expect(screen.queryByText(token)).toBeNull()
    expect(screen.getByText('cart_saved')).toBeTruthy()
    expect(screen.getByText(words.notUsed)).toBeTruthy()
  })

  it('names the template Meta refused on save, and keeps the dialog open', async () => {
    answers.saveWhatsAppAccount = { ok: false, reason: 'KEY_REJECTED', status: null, problem: 'template', template: 'code.portal' }
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(fill(words.problems.template, { name: 'portal_code', language: 'en', message: words.messages['code.portal'] }))).toBeTruthy()
    answers.saveWhatsAppAccount = { ok: false, reason: 'KEY_REJECTED', status: null, problem: 'token', template: null }
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(words.problems.token)).toBeTruthy()
  })

  it('won’t save without code.portal while WhatsApp is on, and says why', async () => {
    status = { enabled: true, account: account() }
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.replace }))
    expect((screen.getByLabelText(words.businessAccountLabel) as HTMLInputElement).value).toBe('102030405060')
    expect((screen.getByLabelText(words.tokenLabel) as HTMLInputElement).value).toBe('')
    await userEvent.type(screen.getByLabelText(words.tokenLabel), token)
    await userEvent.clear(screen.getByLabelText(words.messages['code.portal']))
    expect(screen.getByText(words.dialog.codeTemplateNeeded)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.dialog.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows saving: the confirm waits for the answer', async () => {
    answers.saveWhatsAppAccount = new Promise<Response>(() => undefined)
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect((screen.getByRole('button', { name: words.dialog.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('tests the account: Working, or what Meta rejected and that WhatsApp went off', async () => {
    status = { enabled: true, account: account() }
    const toast = vi.fn()
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.test }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.ok))
    let release: (r: Response) => void = () => undefined
    answers.testWhatsAppAccount = new Promise<Response>((resolve) => (release = resolve))
    await userEvent.click(screen.getByRole('button', { name: words.test }))
    expect(screen.getByRole('button', { name: words.testing })).toBeTruthy()
    status = { enabled: false, account: account({ status: 'rejected' }) }
    release(new Response(JSON.stringify({ data: { testWhatsAppAccount: { ok: true, reason: null, status: 'rejected', problem: 'phone_number', template: null } } })))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.rejectedOff))
    expect(await screen.findByText(words.problems.phone_number)).toBeTruthy()
    expect(screen.getByText(words.rejectedNote)).toBeTruthy()
    expect(screen.getByText(words.statuses.rejected)).toBeTruthy()
  })

  it('turns on after restating what that does, and only with a Working code.portal', async () => {
    status = { enabled: false, account: account({ templates: templates(null) }) }
    const toast = vi.fn()
    const { unmount } = render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    expect(((await screen.findByRole('button', { name: words.turnOn })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(words.needsCodeTemplate)).toBeTruthy()
    unmount()
    status = { enabled: false, account: account() }
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.turnOn }))
    expect(screen.getByText(words.onDialog.consequence)).toBeTruthy()
    answers.setWhatsAppEnabled = { ok: false, reason: 'NO_CODE_TEMPLATE', status: null, problem: null, template: null }
    await userEvent.click(screen.getByRole('button', { name: words.onDialog.confirm }))
    expect(await screen.findByText(words.refusals.NO_CODE_TEMPLATE)).toBeTruthy()
    answers.setWhatsAppEnabled = ok
    status = { enabled: true, account: account() }
    await userEvent.click(screen.getByRole('button', { name: words.onDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.on))
    expect(sent.some((b) => b.includes('setWhatsAppEnabled') && JSON.parse(b).variables.enabled === true)).toBe(true)
    expect(await screen.findByRole('button', { name: words.turnOff })).toBeTruthy()
  })

  it('turns off after saying sign-up stops asking for a number and how codes go instead', async () => {
    status = { enabled: true, account: account() }
    const toast = vi.fn()
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.turnOff }))
    expect(screen.getByText(words.offDialog.consequence)).toBeTruthy()
    status = { enabled: false, account: account() }
    await userEvent.click(screen.getByRole('button', { name: words.offDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.off))
    expect(sent.some((b) => b.includes('setWhatsAppEnabled') && JSON.parse(b).variables.enabled === false)).toBe(true)
  })

  it('removes the account after restating the same, and says when it had gone already', async () => {
    status = { enabled: true, account: account() }
    const toast = vi.fn()
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.remove }))
    expect(screen.getByText(words.removeDialog.consequence)).toBeTruthy()
    answers.removeWhatsAppAccount = { ok: false, reason: 'NOT_FOUND', status: null, problem: null, template: null }
    await userEvent.click(screen.getByRole('button', { name: words.removeDialog.confirm }))
    expect(await screen.findByText(words.refusals.NOT_FOUND)).toBeTruthy()
    answers.removeWhatsAppAccount = ok
    status = none
    await userEvent.click(screen.getByRole('button', { name: words.removeDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.removed))
    expect(await screen.findByText(words.none)).toBeTruthy()
  })

  it('without an account of its own, turns on through DripFunnel’s, and says what DripFunnel turning it off would do (#1544)', async () => {
    status = { enabled: false, account: null, dripfunnel: true }
    const toast = vi.fn()
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    expect(await screen.findByText(words.noneOurs)).toBeTruthy()
    expect(screen.getByText(words.available)).toBeTruthy()
    expect(screen.getByText(words.sender.ours)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: words.turnOn }))
    expect(screen.getByText(words.onDialog.consequenceOurs)).toBeTruthy()
    status = { enabled: true, account: null, dripfunnel: true }
    await userEvent.click(screen.getByRole('button', { name: words.onDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.on))
    expect(await screen.findByRole('button', { name: words.turnOff })).toBeTruthy()
  })

  it('chooses whose account sends, Your account or DripFunnel’s', async () => {
    status = { enabled: true, account: account(), dripfunnel: true }
    const toast = vi.fn()
    render(<WhatsAppPanel mayChange blocked={null} onToast={toast} />)
    expect(await screen.findByText(words.sender.own)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: words.choiceDialog.change }))
    expect((screen.getByRole('radio', { name: new RegExp(`^${words.choiceDialog.own}`) }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(words.choiceDialog.oursHint)).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${words.choiceDialog.ours}`) }))
    expect(screen.getByText(words.choiceDialog.consequenceOurs)).toBeTruthy()
    status = { enabled: true, account: account(), dripfunnel: true, choice: 'dripfunnel' }
    await userEvent.click(screen.getByRole('button', { name: words.choiceDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.chosenOurs))
    expect(JSON.parse(sent.find((b) => b.includes('setWhatsAppChoice')) ?? '{}').variables).toEqual({ account: 'dripfunnel' })
    expect(await screen.findByText(words.sender.ours)).toBeTruthy()
  })

  it('while On, won’t choose its own account without code.portal, and lets it save one without while DripFunnel’s sends', async () => {
    status = { enabled: true, account: account({ templates: templates(null) }), dripfunnel: true, choice: 'dripfunnel' }
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.choiceDialog.change }))
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${words.choiceDialog.own}`) }))
    expect(screen.getByText(words.refusals.NO_CODE_TEMPLATE)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.choiceDialog.confirm }) as HTMLButtonElement).disabled).toBe(true)
    answers.setWhatsAppChoice = { ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE', status: null, problem: null, template: null }
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${words.choiceDialog.ours}`) }))
    await userEvent.click(screen.getByRole('button', { name: words.choiceDialog.confirm }))
    expect(await screen.findByText(words.refusals.DRIPFUNNEL_UNAVAILABLE)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: messages.settings.integrations.cancel }))
    await userEvent.click(screen.getByRole('button', { name: words.replace }))
    await fillForm({ portal: '' })
    expect(screen.queryByText(words.dialog.codeTemplateNeeded)).toBeNull()
  })

  it('says DripFunnel’s takes over when its own account is removed', async () => {
    status = { enabled: true, account: account(), dripfunnel: true }
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.remove }))
    expect(screen.getByText(words.removeDialog.consequenceOurs)).toBeTruthy()
  })

  it('shows a read-only console the account without a single change', async () => {
    status = { enabled: true, account: account(), dripfunnel: true }
    render(<WhatsAppPanel mayChange={false} blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText('…Zx9q')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows an impersonation the panel disabled with the reason, and never asks the API', async () => {
    const reason = fill(words.blocked, { user: 'Ana' })
    render(<WhatsAppPanel mayChange blocked={reason} onToast={vi.fn()} />)
    expect(screen.getByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.setUp }) as HTMLButtonElement).disabled).toBe(true)
    await Promise.resolve()
    expect(sent).toHaveLength(0)
  })

  it('says it couldn’t load, and tries again', async () => {
    status = 'fail'
    render(<WhatsAppPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(words.error.title)).toBeTruthy()
    status = none
    await userEvent.click(screen.getByRole('button', { name: words.error.retry }))
    expect(await screen.findByText(words.none)).toBeTruthy()
    expect(loads).toBe(2)
  })
})
