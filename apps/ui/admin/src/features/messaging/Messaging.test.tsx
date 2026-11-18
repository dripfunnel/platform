// @vitest-environment happy-dom
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@dripfunnel/shared/graphql'
import { savePlatformSms, setPlatformSmsRoute, type Messaging as MessagingData, type PlatformSmsAccount } from '../../api/messaging'
import { fill, messages } from '../../messages'
import { stubApi } from '../../testing/apiStub'
import { textOf } from '../../testing/textOf'
import { SmsAccountDialog, WhatsAppAccountDialog } from './AccountDialogs'
import { emptyMessaging, Messaging, problemText, type MessagingProps } from './Messaging'
import { refusalText, removeConsequence, routeSentence } from './MessagingScreen'

// Admin › Platform settings › Messaging (#1544): DripFunnel's SMS accounts, routes and WhatsApp account; Super admin edits.

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const words = messages.messaging
const sms = words.sms
const wa = words.whatsapp
const noop = () => undefined
const account = (provider: PlatformSmsAccount['provider'], o: Partial<PlatformSmsAccount> = {}): PlatformSmsAccount => ({
  provider,
  hint: '…m2Zp',
  status: 'ok',
  lastTestedAt: '2026-11-17T09:00:00Z',
  templatesComplete: provider === 'twilio' ? null : true,
  ...o,
})
const templates = (portal: string | null) => [
  { message: 'code.portal' as const, name: portal },
  { message: 'cart.reminder' as const, name: 'cart_saved' },
  { message: 'cart.reminder_code' as const, name: null },
]
const whatsAppAccount = (o: object = {}) => ({ hint: '…Zx9q', businessAccountId: '102030405060', phoneNumberId: '998877665544', language: 'en', templates: templates('portal_code'), status: 'ok' as const, lastTestedAt: '2026-11-17T09:00:00Z', ...o })
const data: MessagingData = {
  sms: {
    routes: [
      { route: 'india', provider: null, serving: 'msg91' },
      { route: 'rest', provider: null, serving: 'sns' },
    ],
    accounts: [account('msg91'), account('sns', { templatesComplete: false, status: 'rejected', hint: '…WXYZ' })],
  },
  whatsapp: { enabled: true, account: whatsAppAccount() },
}
// MSG91 alone: nothing sends outside India.
const indiaOnly: MessagingData = { ...data, sms: { routes: [{ route: 'india', provider: null, serving: 'msg91' }, { route: 'rest', provider: null, serving: null }], accounts: [account('msg91')] } }

const page = async (props: Partial<MessagingProps> = {}) => {
  const node: ReactNode = <Messaging messaging={data} forced={null} canManage testing={null} rejection={null} onAction={noop} onTest={noop} onReload={noop} {...props} />
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ['/settings'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('Messaging', () => {
  it('shows who sends each route, each account by its last four, and DripFunnel’s WhatsApp, never a secret', async () => {
    const text = textOf(await page())
    expect(text).toContain(fill(sms.sentBy, { provider: 'MSG91' }))
    expect(text).toContain(fill(sms.sentBy, { provider: 'AWS SNS' }))
    expect(text).toContain(sms.pickAuto)
    expect(text).toContain('…m2Zp')
    expect(text).toContain('…WXYZ')
    expect(text).toContain(sms.india.incomplete)
    expect(text).toContain(fill(sms.rejectedNote, { provider: 'AWS SNS' }))
    expect(text).toContain(sms.notSetUp)
    expect(text).toContain('…Zx9q')
    expect(text).toContain('portal_code')
    expect(text).toContain(words.notUsed)
    expect(text).toContain(wa.on)
  })

  it('gives a Super admin every change, and other staff the status only', async () => {
    const html = await page()
    for (const label of [fill(sms.setUp, { provider: 'Twilio' }), fill(sms.replace, { provider: 'MSG91' }), fill(sms.test, { provider: 'MSG91' }), fill(sms.remove, { provider: 'AWS SNS' }), fill(sms.change, { route: sms.routes.india })])
      expect(html).toContain(`aria-label="${label}"`)
    for (const label of [wa.replace, wa.test, wa.turnOff, wa.remove]) expect(textOf(html)).toContain(label)
    // No route can change while none of its providers has an account here.
    const alone = await page({ messaging: indiaOnly })
    expect(textOf(alone)).toContain(sms.unsent)
    expect(alone).not.toContain(`aria-label="${fill(sms.change, { route: sms.routes.rest })}"`)
    const readOnly = await page({ canManage: false })
    expect(readOnly).not.toContain('<button')
    expect(textOf(readOnly)).toContain(words.readOnly.title)
    expect(await page({ forced: 'readonly' })).not.toContain('<button')
  })

  it('offers Turn on only with code.portal named and Working, and says why', async () => {
    const off = (o: object) => page({ messaging: { ...data, whatsapp: { enabled: false, account: whatsAppAccount(o) } } })
    expect(textOf(await off({ templates: templates(null) }))).toContain(wa.needsCodeTemplate)
    expect(textOf(await off({ status: 'rejected' }))).toContain(wa.rejectedNote)
    expect(textOf(await off({}))).not.toContain(wa.needsCodeTemplate)
  })

  it('names what Meta refused at the last test', async () => {
    const rejected = { ...data, whatsapp: { enabled: false, account: whatsAppAccount({ status: 'rejected' }) } }
    const expected = fill(wa.problems.template, { name: 'portal_code', language: 'en', message: wa.messages['code.portal'] })
    expect(problemText({ problem: 'template', template: 'code.portal' }, rejected.whatsapp)).toBe(expected)
    expect(textOf(await page({ messaging: rejected, rejection: { problem: 'template', template: 'code.portal' } }))).toContain(expected)
  })

  it('renders the harness states', async () => {
    expect(await page({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await page({ forced: 'error' }))).toContain(words.error.title)
    const empty = textOf(await page({ forced: 'empty' }))
    expect(empty).toContain(wa.none)
    expect(empty.split(sms.unsent)).toHaveLength(3)
  })
})

describe('what a change says it does', () => {
  it('names the account a route goes through next, or that none does', () => {
    const accounts = data.sms.accounts
    expect(routeSentence(accounts, 'india', 'sns', sms.routeDialog.consequence, sms.routeDialog.consequenceNone)).toBe(fill(sms.routeDialog.consequence, { numbers: sms.routeNumbers.india, provider: 'MSG91' }))
    expect(routeSentence(indiaOnly.sms.accounts, 'rest', null, sms.routeDialog.consequence, sms.routeDialog.consequenceNone)).toBe(fill(sms.routeDialog.consequenceNone, { numbers: sms.routeNumbers.rest }))
  })

  it('says removing an account leaves its routes with the next one, or with none', () => {
    expect(removeConsequence(data.sms, 'msg91')).toBe([sms.removeDialog.deleted, fill(sms.removeDialog.routeNone, { numbers: sms.routeNumbers.india })].join(' '))
    expect(removeConsequence(data.sms, 'sns')).toBe([sms.removeDialog.deleted, fill(sms.removeDialog.routeNone, { numbers: sms.routeNumbers.rest })].join(' '))
    const unused = { routes: emptyMessaging.sms.routes, accounts: [account('msg91', { templatesComplete: false })] }
    expect(removeConsequence(unused, 'msg91')).toBe([sms.removeDialog.deleted, sms.removeDialog.none].join(' '))
    const both = { ...data.sms, accounts: [account('msg91'), account('sns')] }
    expect(removeConsequence(both, 'msg91')).toBe([sms.removeDialog.deleted, fill(sms.removeDialog.route, { numbers: sms.routeNumbers.india, provider: 'AWS SNS' })].join(' '))
  })

  it('words each refusal: an SMS one with its provider, a WhatsApp one by what Meta refused', () => {
    const problem = () => 'the token'
    expect(refusalText({ ok: false, reason: 'KEY_REJECTED', rejection: null }, 'twilio', problem)).toBe(fill(sms.refusals.KEY_REJECTED, { provider: 'Twilio' }))
    expect(refusalText({ ok: false, reason: 'KEY_REJECTED', rejection: { problem: 'token' } }, null, problem)).toBe('the token')
    expect(refusalText({ ok: false, reason: 'NO_CODE_TEMPLATE', rejection: null }, null, problem)).toBe(wa.refusals.NO_CODE_TEMPLATE)
  })
})

describe('the account dialogs', () => {
  const show = (dialog: HTMLElement) => dialog.setAttribute('open', '')
  const save = (label: string) => screen.getByRole('button', { name: label, hidden: true })
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

  it('holds back an SMS account until it is in shape and has a reason, then hands it over with the reason', async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      show(this)
    }
    const onSave = vi.fn()
    render(<SmsAccountDialog provider="twilio" error={null} onSave={onSave} onCancel={noop} />)
    type(sms.fields.accountSid, `AC${'0'.repeat(32)}`)
    expect(screen.getByText(sms.dialog.incomplete.twilio)).toBeTruthy()
    type(sms.fields.authToken, 'a'.repeat(32))
    type(sms.fields.messagingServiceSid, `MG${'1'.repeat(32)}`)
    expect((save(sms.dialog.save) as HTMLButtonElement).disabled).toBe(true)
    type(words.reason.label, 'New Twilio account')
    expect((screen.getByLabelText(sms.fields.authToken) as HTMLInputElement).type).toBe('password')
    await act(async () => fireEvent.click(save(sms.dialog.save)))
    expect(onSave).toHaveBeenCalledWith({ provider: 'twilio', accountSid: `AC${'0'.repeat(32)}`, authToken: 'a'.repeat(32), messagingServiceSid: `MG${'1'.repeat(32)}` }, 'New Twilio account')
  })

  it('won’t save DripFunnel’s WhatsApp without code.portal while it is on, and asks for the token again', async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      show(this)
    }
    render(<WhatsAppAccountDialog current={whatsAppAccount({ templates: templates(null) })} enabled error={null} onSave={vi.fn()} onCancel={noop} />)
    expect((screen.getByLabelText(wa.phoneNumberLabel) as HTMLInputElement).value).toBe('998877665544')
    expect((screen.getByLabelText(wa.tokenLabel) as HTMLInputElement).value).toBe('')
    type(wa.tokenLabel, `EAAG${'b'.repeat(40)}`)
    expect(screen.getByText(wa.dialog.codeTemplateNeeded)).toBeTruthy()
    type(wa.messages['code.portal'], 'portal_code')
    expect(screen.queryByText(wa.dialog.codeTemplateNeeded)).toBeNull()
  })
})

describe('the Admin API calls', () => {
  it('send the account and the reason, and word a refusal by its code', async () => {
    const api = stubApi({ data: { savePlatformSmsAccount: { ok: false, reason: 'KEY_REJECTED', status: null, problem: null, template: null } } })
    const result = await savePlatformSms({ provider: 'twilio', accountSid: 'AC1', authToken: 't', messagingServiceSid: 'MG1' }, 'Rotated')
    expect(result).toEqual({ ok: false, reason: 'KEY_REJECTED', rejection: null })
    expect(api.calls[0]?.variables).toEqual({ provider: 'twilio', accountSid: 'AC1', authToken: 't', messagingServiceSid: 'MG1', reason: 'Rotated' })
  })

  it('throws on a code this console doesn’t know', async () => {
    stubApi({ data: { setPlatformSmsRoute: { ok: false, reason: 'SOMETHING_NEW', status: null, problem: null, template: null } } })
    await expect(setPlatformSmsRoute('india', 'msg91', 'x')).rejects.toBeInstanceOf(ApiError)
  })

  it('takes a staff role’s refusal as an error the screen words', async () => {
    stubApi({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }], data: null })
    await expect(setPlatformSmsRoute('india', null, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
