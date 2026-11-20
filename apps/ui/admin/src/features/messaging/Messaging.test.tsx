// @vitest-environment happy-dom
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@dripfunnel/shared/graphql'
import { removePlatformMapsKey, savePlatformMapsKey, savePlatformSms, setPlatformMapsEnabled, setPlatformSmsRoute, testPlatformMapsKey, type Messaging as MessagingData, type PlatformMaps, type PlatformSmsAccount } from '../../api/messaging'
import { fill, formatTime, messages } from '../../messages'
import { stubApi } from '../../testing/apiStub'
import { textOf } from '../../testing/textOf'
import { MapsKeyDialog, SmsAccountDialog, WhatsAppAccountDialog } from './AccountDialogs'
import { hooksHostFor } from './MapsPanel'
import { emptyMessaging, Messaging, problemText, type MessagingProps } from './Messaging'
import { mapsRefusalText, refusalText, removeConsequence, routeSentence } from './MessagingScreen'

// Admin › Platform settings › Messaging (#1544): DripFunnel's SMS accounts, routes and WhatsApp account; Super admin edits.

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const words = messages.messaging
const sms = words.sms
const wa = words.whatsapp
const maps = words.maps
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
  maps: { enabled: true, key: { hint: 'AIza…Ici4', status: 'ok', lastTestedAt: '2026-11-19T09:00:00Z' } },
}
const mapsKey = (o: Partial<NonNullable<PlatformMaps['key']>> = {}): NonNullable<PlatformMaps['key']> => ({ hint: 'AIza…Ici4', status: 'ok', lastTestedAt: '2026-11-19T09:00:00Z', ...o })
const withMaps = (maps: PlatformMaps): MessagingData => ({ ...data, maps })
// MSG91 alone: nothing sends outside India.
const indiaOnly: MessagingData = { ...data, sms: { routes: [{ route: 'india', provider: null, serving: 'msg91' }, { route: 'rest', provider: null, serving: null }], accounts: [account('msg91')] } }

const page = async (props: Partial<MessagingProps> = {}) => {
  const node: ReactNode = <Messaging messaging={data} forced={null} canManage testing={null} rejection={null} mapsProblem={null} hooksHost="hooks.dripfunnel.ai" onAction={noop} onTest={noop} onReload={noop} {...props} />
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

describe('Google Maps', () => {
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])

  it('shows the key only as its last four, with its status and when it was last checked', async () => {
    const text = textOf(await page())
    expect(text).toContain(maps.title)
    expect(text).toContain('AIza…Ici4')
    expect(text).toContain(maps.statuses.ok)
    expect(text).toContain(fill(maps.lastChecked, { when: formatTime('2026-11-19T09:00:00Z') }))
    expect(text).toContain(maps.on)
  })

  it('says no key, never checked, rejected with Google’s reason, and off', async () => {
    expect(textOf(await page({ messaging: withMaps({ enabled: false, key: null }) }))).toContain(maps.none)
    expect(textOf(await page({ messaging: withMaps({ enabled: false, key: mapsKey({ status: 'untested', lastTestedAt: null }) }) }))).toContain(maps.neverChecked)
    const rejected = withMaps({ enabled: false, key: mapsKey({ status: 'rejected' }) })
    const text = textOf(await page({ messaging: rejected, mapsProblem: 'geocoding_disabled' }))
    expect(text).toContain(maps.statuses.rejected)
    expect(text).toContain(maps.rejectedNote)
    expect(text).toContain(maps.problems.geocoding_disabled)
    expect(text).toContain(maps.off)
  })

  it('offers Turn on only for a Working key, and says why not', async () => {
    const off = (status: 'ok' | 'untested') => page({ messaging: withMaps({ enabled: false, key: mapsKey({ status }) }) })
    const untested = await off('untested')
    expect(untested).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${maps.turnOn}</button>`))
    expect(textOf(untested)).toContain(maps.needsWorking)
    expect(await off('ok')).not.toMatch(new RegExp(`<button[^>]*disabled[^>]*>${maps.turnOn}</button>`))
  })

  it('gives a Super admin Replace, Test, Turn off and Remove, and set-up alone when there is no key', async () => {
    const all = buttons(await page())
    for (const label of [maps.replace, maps.test, maps.turnOff, maps.remove]) expect(all).toContain(label)
    expect(buttons(await page({ messaging: withMaps({ enabled: false, key: null }) }))).toContain(maps.setUp)
  })

  it('gives other staff the status only, no button of the panel, and no way to change it when forced read-only', async () => {
    for (const html of [await page({ canManage: false }), await page({ forced: 'readonly' })]) {
      expect(buttons(html)).not.toContain(maps.replace)
      expect(buttons(html)).not.toContain(maps.test)
      expect(textOf(html)).toContain('AIza…Ici4')
    }
  })

  it('has the instructions: the three APIs, this environment’s real host, the API restriction and the roles', async () => {
    const html = await page({ hooksHost: 'hooks.dripfunnel.dev' })
    const text = textOf(html)
    expect(html).toContain('<details')
    expect(text).toContain(maps.howTo.summary)
    for (const api of ['Maps JavaScript API', 'Geocoding API', 'Places API (New)']) expect(text).toContain(api)
    expect(text).toContain('https://hooks.dripfunnel.dev/*')
    expect(text).toContain('Restrict key')
    for (const role of ['Service Usage Admin', 'API Keys Admin']) expect(text).toContain(role)
    for (const link of maps.howTo.links) expect(html).toContain(`href="${link.href}"`)
  })

  it('names the map page’s host from the console’s own', () => {
    expect(hooksHostFor('admin.dripfunnel.ai')).toBe('hooks.dripfunnel.ai')
    expect(hooksHostFor('admin.dripfunnel.dev')).toBe('hooks.dripfunnel.dev')
    expect(hooksHostFor('dev-admin.actuateminds.com')).toBe('dev-hooks.actuateminds.com')
    expect(hooksHostFor('Admin.DripFunnel.ai')).toBe('hooks.dripfunnel.ai')
    expect(hooksHostFor('admin.localhost')).toBe('hooks.localhost')
    expect(hooksHostFor('localhost')).toBe('hooks.localhost')
  })

  it('words a refusal by what Google refused, else by its code', () => {
    expect(mapsRefusalText({ ok: false, reason: 'KEY_REJECTED', problem: 'invalid' })).toBe(maps.problems.invalid)
    expect(mapsRefusalText({ ok: false, reason: 'KEY_REJECTED', problem: null })).toBe(maps.refusals.KEY_REJECTED)
    expect(mapsRefusalText({ ok: false, reason: 'NO_KEY', problem: null })).toBe(maps.refusals.NO_KEY)
  })

  it('shows the empty state with no key', async () => {
    expect(textOf(await page({ forced: 'empty' }))).toContain(maps.none)
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

describe('the Google Maps key dialog', () => {
  const show = (dialog: HTMLElement) => dialog.setAttribute('open', '')
  const key = `AIza${'a'.repeat(35)}`

  it('holds the key back until it is a whole Google key with a reason, hides it as it is typed, then hands it over', async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      show(this)
    }
    const onSave = vi.fn()
    render(<MapsKeyDialog error={null} onSave={onSave} onCancel={noop} />)
    const input = screen.getByLabelText(maps.keyLabel) as HTMLInputElement
    expect(input.type).toBe('password')
    const reveal = screen.getByRole('button', { name: maps.dialog.show, hidden: true })
    fireEvent.click(reveal)
    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: maps.dialog.hide, hidden: true }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: maps.dialog.hide, hidden: true }))
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'AIza-too-short' } })
    expect(screen.getByText(maps.dialog.incomplete)).toBeTruthy()
    fireEvent.change(input, { target: { value: `  ${key}  ` } })
    expect(screen.queryByText(maps.dialog.incomplete)).toBeNull()
    const save = screen.getByRole('button', { name: maps.dialog.save, hidden: true }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(words.reason.label), { target: { value: 'New project' } })
    await act(async () => fireEvent.click(save))
    expect(onSave).toHaveBeenCalledWith(key, 'New project')
  })
})

describe('the Admin API calls', () => {
  it('save, test, switch and remove the Google Maps key with the reason, and word a refusal by what Google refused', async () => {
    const ok = { ok: true, reason: null, status: 'ok', problem: null }
    const saved = stubApi({ data: { savePlatformMapsKey: ok } })
    expect(await savePlatformMapsKey('AIza-key', 'Rotated')).toEqual({ ok: true, status: 'ok', problem: null })
    expect(saved.calls[0]?.variables).toEqual({ key: 'AIza-key', reason: 'Rotated' })
    stubApi({ data: { savePlatformMapsKey: { ok: false, reason: 'KEY_REJECTED', status: null, problem: 'restricted' } } })
    expect(await savePlatformMapsKey('AIza-key', 'x')).toEqual({ ok: false, reason: 'KEY_REJECTED', problem: 'restricted' })
    stubApi({ data: { testPlatformMapsKey: { ok: true, reason: null, status: 'rejected', problem: 'invalid' } } })
    expect(await testPlatformMapsKey()).toEqual({ ok: true, status: 'rejected', problem: 'invalid' })
    const on = stubApi({ data: { setPlatformMapsEnabled: ok } })
    await setPlatformMapsEnabled(true, 'Ready')
    expect(on.calls[0]?.variables).toEqual({ enabled: true, reason: 'Ready' })
    const removed = stubApi({ data: { removePlatformMapsKey: ok } })
    await removePlatformMapsKey('Rotating')
    expect(removed.calls[0]?.variables).toEqual({ reason: 'Rotating' })
  })

  it('throws on a Maps code this console doesn’t know', async () => {
    stubApi({ data: { setPlatformMapsEnabled: { ok: false, reason: 'SOMETHING_NEW', status: null, problem: null } } })
    await expect(setPlatformMapsEnabled(true, 'x')).rejects.toBeInstanceOf(ApiError)
  })

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
