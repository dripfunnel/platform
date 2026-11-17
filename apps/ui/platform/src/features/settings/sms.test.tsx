// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountForRoute, senderOf, smsRoutes, type SmsProvider, type SmsRoute } from '@dripfunnel/shared/messaging'
import { fill, messages } from '../../messages'
import { SmsPanel } from './SmsPanel'

const words = messages.settings.integrations.sms
const messageIds = Object.keys(words.messages) as (keyof typeof words.messages)[]
const authKey = ['k', 'A'.repeat(20), 'm2Zp'].join('')
const snsSecret = ['s', 'b'.repeat(35), 'WXYZ'].join('')
type Account = { provider: SmsProvider; templatesComplete: boolean | null; hint: string; status: string; lastTestedAt: string | null }
const account = (provider: SmsProvider, o: Partial<Account> = {}): Account => ({ provider, hint: '…m2Zp', status: 'ok', lastTestedAt: '2026-11-16T09:00:00Z', templatesComplete: provider === 'twilio' ? null : true, ...o })
// The API's answer, each route's sender by its own rule; `ours` is where DripFunnel's serves the partner (#1543).
const status = (o: { enabled?: boolean; india?: string | null; rest?: string | null; accounts?: Account[]; ours?: readonly SmsRoute[] } = {}) => {
  const accounts = o.accounts ?? []
  const ours = o.ours ?? []
  return {
    enabled: o.enabled ?? true,
    dripfunnel: ours.length > 0,
    routes: smsRoutes.map((route) => {
      const provider = (route === 'india' ? o.india : o.rest) ?? null
      return { route, provider, dripfunnel: ours.includes(route), sender: senderOf(provider, accountForRoute(accounts, route, provider) !== undefined, ours.includes(route)) }
    }),
    accounts,
  }
}
const ok = { ok: true, reason: null, status: 'ok' }
const refused = (reason: string) => ({ ok: false, reason, status: null })
const sentBy = (provider: string | null) => fill(words.sentByLine, { who: provider ? fill(words.sentBy.yours, { provider }) : words.sentBy.ours })

const sent: string[] = []
let current: object | 'fail' = status()
let answers: Record<string, object | Promise<Response>> = {}
let loads = 0
beforeEach(() => {
  sent.length = 0
  current = status()
  answers = {}
  loads = 0
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = String(init.body)
    sent.push(body)
    const mutation = ['saveSmsAccount', 'testSmsAccount', 'removeSmsAccount', 'setSmsRoute', 'setSmsEnabled'].find((m) => body.includes(m))
    if (mutation) {
      const answer = answers[mutation] ?? ok
      return answer instanceof Promise ? answer : Promise.resolve(new Response(JSON.stringify({ data: { [mutation]: answer } })))
    }
    loads += 1
    return current === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(new Response(JSON.stringify({ data: { smsAccounts: current } })))
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

const variablesOf = (mutation: string) => JSON.parse(sent.find((b) => b.includes(mutation)) ?? '{}').variables
const card = (provider: string) => {
  const title = screen.getAllByText(provider).find((el) => el.tagName === 'STRONG')
  const box = title?.closest('div')?.parentElement
  if (!box) throw new Error(`no ${provider} card`)
  return within(box)
}
const typeTemplates = async () => {
  for (const [i, message] of messageIds.entries()) await userEvent.type(screen.getByLabelText(words.messages[message]), `tmpl_${i}`)
}

describe('SMS on Integrations', () => {
  it('starts with no accounts and DripFunnel’s not enabled: no route sends, and each provider offers its set up', async () => {
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(words.fallback)).toBeTruthy()
    expect(screen.getByText(words.on)).toBeTruthy()
    expect(screen.getAllByText(words.unsent)).toHaveLength(2)
    for (const provider of ['MSG91', 'Twilio', 'AWS SNS']) expect(screen.getByRole('button', { name: fill(words.setUp, { provider }) })).toBeTruthy()
    expect(screen.getAllByText(words.notSetUp)).toHaveLength(3)
    expect(screen.queryByRole('button', { name: fill(words.change, { route: words.routes.india }) })).toBeNull()
    expect(screen.getByRole('button', { name: words.turnOff })).toBeTruthy()
  })

  it('won’t save MSG91 without all seven template ids, saves it with them, and shows only the last four', async () => {
    const toast = vi.fn()
    render(<SmsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.setUp, { provider: 'MSG91' }) }))
    await userEvent.type(screen.getByLabelText(words.fields.authKey), authKey)
    await userEvent.type(screen.getByLabelText(words.messages['code.second_factor']), 'tmpl_0')
    expect(screen.getByText(words.dialog.incomplete.msg91)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.dialog.save }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText(words.messages['code.second_factor']))
    await typeTemplates()
    current = status({ accounts: [account('msg91')] })
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.toasts.saved, { provider: 'MSG91' })))
    expect(variablesOf('saveSmsAccount')).toEqual({ provider: 'msg91', authKey, templates: messageIds.map((message, i) => ({ message, templateId: `tmpl_${i}` })) })
    expect(await screen.findByText('…m2Zp')).toBeTruthy()
    expect(screen.queryByText(authKey)).toBeNull()
    expect(screen.getByText(words.statuses.ok)).toBeTruthy()
    expect(screen.getByText(words.india.complete)).toBeTruthy()
    expect(screen.getByText(sentBy('MSG91'))).toBeTruthy()
    expect(screen.getByText(words.unsent)).toBeTruthy()
  })

  it('says in words why the provider refused, and keeps the dialog open', async () => {
    answers.saveSmsAccount = refused('KEY_REJECTED')
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.setUp, { provider: 'Twilio' }) }))
    await userEvent.type(screen.getByLabelText(words.fields.accountSid), `AC${'0'.repeat(32)}`)
    await userEvent.type(screen.getByLabelText(words.fields.authToken), 'a'.repeat(32))
    await userEvent.type(screen.getByLabelText(words.fields.messagingServiceSid), `MG${'1'.repeat(32)}`)
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(fill(words.refusals.KEY_REJECTED, { provider: 'Twilio' }))).toBeTruthy()
    expect(variablesOf('saveSmsAccount')).toEqual({ provider: 'twilio', accountSid: `AC${'0'.repeat(32)}`, authToken: 'a'.repeat(32), messagingServiceSid: `MG${'1'.repeat(32)}` })
    answers.saveSmsAccount = refused('PROVIDER_UNAVAILABLE')
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(fill(words.refusals.PROVIDER_UNAVAILABLE, { provider: 'Twilio' }))).toBeTruthy()
  })

  it('saves SNS for numbers outside India alone, and holds back a half-filled India part', async () => {
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.setUp, { provider: 'AWS SNS' }) }))
    await userEvent.type(screen.getByLabelText(words.fields.accessKeyId), 'AKIAABCDEFGHIJKLMNOP')
    await userEvent.type(screen.getByLabelText(words.fields.secretAccessKey), snsSecret)
    await userEvent.type(screen.getByLabelText(words.fields.region), 'ap-south-1')
    await userEvent.type(screen.getByLabelText(words.fields.senderId), 'NSTAR')
    expect(screen.getByText(words.dialog.incomplete.sns)).toBeTruthy()
    await userEvent.clear(screen.getByLabelText(words.fields.senderId))
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    await waitFor(() => expect(variablesOf('saveSmsAccount')).toEqual({ provider: 'sns', accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: snsSecret, region: 'ap-south-1' }))
  })

  it('saves SNS with India’s sender id, entity id and seven template ids', async () => {
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.setUp, { provider: 'AWS SNS' }) }))
    await userEvent.type(screen.getByLabelText(words.fields.accessKeyId), 'AKIAABCDEFGHIJKLMNOP')
    await userEvent.type(screen.getByLabelText(words.fields.secretAccessKey), snsSecret)
    await userEvent.type(screen.getByLabelText(words.fields.region), 'ap-south-1')
    await userEvent.type(screen.getByLabelText(words.fields.senderId), 'NSTAR')
    await userEvent.type(screen.getByLabelText(words.fields.entityId), '1201160000000000001')
    await typeTemplates()
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    await waitFor(() =>
      expect(variablesOf('saveSmsAccount')).toEqual({
        provider: 'sns',
        accessKeyId: 'AKIAABCDEFGHIJKLMNOP',
        secretAccessKey: snsSecret,
        region: 'ap-south-1',
        senderId: 'NSTAR',
        entityId: '1201160000000000001',
        templates: messageIds.map((message, i) => ({ message, templateId: `tmpl_${i}` })),
      }),
    )
  })

  it('shows saving: the confirm waits for the answer', async () => {
    answers.saveSmsAccount = new Promise<Response>(() => undefined)
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.setUp, { provider: 'Twilio' }) }))
    await userEvent.type(screen.getByLabelText(words.fields.accountSid), `AC${'0'.repeat(32)}`)
    await userEvent.type(screen.getByLabelText(words.fields.authToken), 'a'.repeat(32))
    await userEvent.type(screen.getByLabelText(words.fields.messagingServiceSid), `MG${'1'.repeat(32)}`)
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect((screen.getByRole('button', { name: words.dialog.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists each account with its hint, status and last test, and says an SNS without India sends outside it only', async () => {
    current = status({ accounts: [account('twilio', { status: 'untested', lastTestedAt: null, hint: '…a1b2' }), account('sns', { status: 'rejected', templatesComplete: false, hint: '…WXYZ' })] })
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText('…a1b2')).toBeTruthy()
    expect(card('Twilio').getByText(words.statuses.untested)).toBeTruthy()
    expect(card('Twilio').getByText(words.neverTested)).toBeTruthy()
    expect(card('AWS SNS').getByText('…WXYZ')).toBeTruthy()
    expect(card('AWS SNS').getByText(words.statuses.rejected)).toBeTruthy()
    expect(card('AWS SNS').getByText(words.india.incomplete)).toBeTruthy()
    expect(card('AWS SNS').getByText(fill(words.rejectedNote, { provider: 'AWS SNS' }))).toBeTruthy()
    expect(screen.getByText(sentBy('Twilio'))).toBeTruthy()
    expect(screen.getByText(words.unsent)).toBeTruthy()
  })

  it('tests an account: Working, Rejected, or the refusal in words', async () => {
    current = status({ accounts: [account('msg91')] })
    const toast = vi.fn()
    render(<SmsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.test, { provider: 'MSG91' }) }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.toasts.ok, { provider: 'MSG91' })))
    expect(variablesOf('testSmsAccount')).toEqual({ provider: 'msg91' })
    let release: (r: Response) => void = () => undefined
    answers.testSmsAccount = new Promise<Response>((resolve) => (release = resolve))
    await userEvent.click(screen.getByRole('button', { name: fill(words.test, { provider: 'MSG91' }) }))
    expect(screen.getByRole('button', { name: words.testing })).toBeTruthy()
    expect((screen.getByRole('button', { name: words.turnOff }) as HTMLButtonElement).disabled).toBe(true)
    current = status({ accounts: [account('msg91', { status: 'rejected' })] })
    release(new Response(JSON.stringify({ data: { testSmsAccount: { ok: true, reason: null, status: 'rejected' } } })))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.toasts.rejected, { provider: 'MSG91' })))
    expect(await screen.findByText(words.statuses.rejected)).toBeTruthy()
    answers.testSmsAccount = refused('NOT_FOUND')
    await userEvent.click(screen.getByRole('button', { name: fill(words.test, { provider: 'MSG91' }) }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.refusals.NOT_FOUND, { provider: 'MSG91' })))
  })

  it('removes an account after saying which account sends its routes next', async () => {
    current = status({ accounts: [account('msg91'), account('sns')] })
    const toast = vi.fn()
    render(<SmsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.remove, { provider: 'MSG91' }) }))
    expect(screen.getByText([words.removeDialog.deleted, fill(words.removeDialog.route, { numbers: words.routeNumbers.india, who: fill(words.sentBy.yours, { provider: 'AWS SNS' }) })].join(' '))).toBeTruthy()
    answers.removeSmsAccount = refused('NOT_FOUND')
    await userEvent.click(screen.getByRole('button', { name: words.removeDialog.confirm }))
    expect(await screen.findByText(fill(words.refusals.NOT_FOUND, { provider: 'MSG91' }))).toBeTruthy()
    answers.removeSmsAccount = ok
    current = status({ accounts: [account('sns')] })
    await userEvent.click(screen.getByRole('button', { name: words.removeDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.toasts.removed, { provider: 'MSG91' })))
    expect(variablesOf('removeSmsAccount')).toEqual({ provider: 'msg91' })
    expect(await screen.findAllByText(sentBy('AWS SNS'))).toHaveLength(2)
  })

  it('says no texts go when a route’s only account goes, or that DripFunnel’s takes it where Admin enabled it (#1543)', async () => {
    current = status({ accounts: [account('twilio')] })
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.remove, { provider: 'Twilio' }) }))
    expect(screen.getByText([words.removeDialog.deleted, fill(words.noneTo, { numbers: words.routeNumbers.rest })].join(' '))).toBeTruthy()
    cleanup()
    current = status({ accounts: [account('twilio')], ours: ['india', 'rest'] })
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.remove, { provider: 'Twilio' }) }))
    expect(screen.getByText([words.removeDialog.deleted, fill(words.removeDialog.route, { numbers: words.routeNumbers.rest, who: words.sentBy.ours })].join(' '))).toBeTruthy()
  })

  it('offers DripFunnel’s per route where Admin enabled it, and says what turning it off would do (#1544)', async () => {
    current = status({ accounts: [account('msg91')], ours: ['india', 'rest'] })
    const toast = vi.fn()
    render(<SmsPanel mayChange blocked={null} onToast={toast} />)
    expect(await screen.findByText(words.available)).toBeTruthy()
    expect(screen.queryByText(words.fallback)).toBeNull()
    expect(screen.getByText(sentBy('MSG91'))).toBeTruthy()
    expect(screen.getByText(fill(words.sentByLine, { who: words.sentBy.ours }))).toBeTruthy()
    expect(screen.getByRole('button', { name: fill(words.change, { route: words.routes.rest }) })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: fill(words.change, { route: words.routes.india }) }))
    expect(screen.getByText(fill(words.routeDialog.oursHint, { numbers: words.routeNumbers.india }))).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${words.routeDialog.ours}`) }))
    expect(screen.getByText(fill(words.routeDialog.consequence, { numbers: words.routeNumbers.india, who: words.sentBy.ours }))).toBeTruthy()
    current = status({ india: 'dripfunnel', accounts: [account('msg91')], ours: ['india', 'rest'] })
    await userEvent.click(screen.getByRole('button', { name: words.routeDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.toasts.route, { numbers: words.routeNumbers.india, who: words.sentBy.ours })))
    expect(variablesOf('setSmsRoute')).toEqual({ route: 'india', provider: 'dripfunnel' })
    expect(await screen.findAllByText(fill(words.sentByLine, { who: words.sentBy.ours }))).toHaveLength(2)
  })

  it('offers DripFunnel’s only on a route it serves, and says when it went away meanwhile', async () => {
    current = status({ accounts: [account('msg91'), account('twilio')], ours: ['rest'] })
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.change, { route: words.routes.india }) }))
    expect(screen.queryByRole('radio', { name: new RegExp(`^${words.routeDialog.ours}`) })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: messages.settings.integrations.cancel }))
    await userEvent.click(screen.getByRole('button', { name: fill(words.change, { route: words.routes.rest }) }))
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${words.routeDialog.ours}`) }))
    answers.setSmsRoute = refused('DRIPFUNNEL_UNAVAILABLE')
    await userEvent.click(screen.getByRole('button', { name: words.routeDialog.confirm }))
    expect(await screen.findByText(words.refusals.DRIPFUNNEL_UNAVAILABLE)).toBeTruthy()
  })

  it('sends through its own account once Admin turns DripFunnel’s off, and starts the dialog on “whichever”', async () => {
    current = status({ india: 'dripfunnel', accounts: [account('msg91')] })
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(sentBy('MSG91'))).toBeTruthy()
    expect(screen.getByText(words.fallback)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: fill(words.change, { route: words.routes.india }) }))
    expect((screen.getByRole('radio', { name: new RegExp(fill(words.routeDialog.automatic, { first: 'MSG91', second: 'AWS SNS' })) }) as HTMLInputElement).checked).toBe(true)
  })

  it('picks who sends a route, and won’t pick an account that can’t send it', async () => {
    current = status({ accounts: [account('msg91'), account('sns', { templatesComplete: false })] })
    const toast = vi.fn()
    render(<SmsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: fill(words.change, { route: words.routes.india }) }))
    await userEvent.click(screen.getByRole('radio', { name: /^AWS SNS/ }))
    expect(screen.getByText(fill(words.refusals.ACCOUNT_INCOMPLETE, { provider: 'AWS SNS' }))).toBeTruthy()
    expect((screen.getByRole('button', { name: words.routeDialog.confirm }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('radio', { name: /^MSG91/ }))
    expect(screen.getByText(fill(words.routeDialog.consequence, { numbers: words.routeNumbers.india, who: fill(words.sentBy.yours, { provider: 'MSG91' }) }))).toBeTruthy()
    current = status({ india: 'msg91', accounts: [account('msg91'), account('sns', { templatesComplete: false })] })
    await userEvent.click(screen.getByRole('button', { name: words.routeDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(fill(words.toasts.route, { numbers: words.routeNumbers.india, who: fill(words.sentBy.yours, { provider: 'MSG91' }) })))
    expect(variablesOf('setSmsRoute')).toEqual({ route: 'india', provider: 'msg91' })
  })

  it('hands a route back to whichever is set up', async () => {
    current = status({ rest: 'sns', accounts: [account('twilio'), account('sns')] })
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findAllByText(sentBy('AWS SNS'))).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: fill(words.change, { route: words.routes.rest }) }))
    expect((screen.getByRole('radio', { name: /^AWS SNS/ }) as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(fill(words.routeDialog.automatic, { first: 'Twilio', second: 'AWS SNS' })) }))
    await userEvent.click(screen.getByRole('button', { name: words.routeDialog.confirm }))
    await waitFor(() => expect(variablesOf('setSmsRoute')).toEqual({ route: 'rest', provider: null }))
  })

  it('turns SMS off after restating what stops, and back on', async () => {
    const toast = vi.fn()
    render(<SmsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.turnOff }))
    expect(screen.getByText(words.offDialog.consequence)).toBeTruthy()
    current = status({ enabled: false })
    await userEvent.click(screen.getByRole('button', { name: words.offDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.off))
    expect(variablesOf('setSmsEnabled')).toEqual({ enabled: false })
    expect(await screen.findByText(words.offNote)).toBeTruthy()
    expect(screen.getByText(words.off)).toBeTruthy()
    expect(screen.getAllByText(words.offRoute)).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: words.turnOn }))
    expect(screen.getByText(words.onDialog.consequence)).toBeTruthy()
    sent.length = 0
    current = status()
    await userEvent.click(screen.getByRole('button', { name: words.onDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.on))
    expect(variablesOf('setSmsEnabled')).toEqual({ enabled: true })
  })

  it('shows a read-only console the accounts without a single change', async () => {
    current = status({ accounts: [account('msg91'), account('twilio')] })
    render(<SmsPanel mayChange={false} blocked={null} onToast={vi.fn()} />)
    expect(await screen.findAllByText('…m2Zp')).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows an impersonation the panel disabled with the reason, and never asks the API', async () => {
    const reason = fill(words.blocked, { user: 'Ana' })
    render(<SmsPanel mayChange blocked={reason} onToast={vi.fn()} />)
    expect(screen.getByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.blockedAction }) as HTMLButtonElement).disabled).toBe(true)
    await Promise.resolve()
    expect(sent).toHaveLength(0)
  })

  it('shows loading, then says it couldn’t load, and tries again', async () => {
    current = 'fail'
    render(<SmsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(screen.getByText(words.loading)).toBeTruthy()
    expect(await screen.findByText(words.error.title)).toBeTruthy()
    current = status()
    await userEvent.click(screen.getByRole('button', { name: words.error.retry }))
    expect(await screen.findByText(words.fallback)).toBeTruthy()
    expect(loads).toBe(2)
  })
})
