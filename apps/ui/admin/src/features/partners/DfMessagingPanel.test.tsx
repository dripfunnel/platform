// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fill, messages } from '../../messages'
import { stubApiSequence } from '../../testing/apiStub'
import { DfMessagingPanel } from './DfMessagingPanel'

// A partner's DripFunnel's SMS, WhatsApp and Google Maps key switches (#1544, #1613): Super admin and Partner manager change them with a reason.

const words = messages.partner.overview.dfMessaging
const partner = { id: '0a1b2c3d-0000-4000-8000-000000000001', name: 'Northstar' }
const switches = (sms: boolean, whatsapp: boolean, maps = false) => ({ sms, whatsapp, maps })

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DripFunnel’s messaging on a partner’s page', () => {
  it('turns DripFunnel’s SMS on with a reason, after saying what that lets the partner do', async () => {
    const api = stubApiSequence({ data: { partnerDfMessaging: switches(false, true) } }, { data: { setPartnerDfMessaging: switches(true, true) } })
    const onToast = vi.fn()
    render(<DfMessagingPanel partner={partner} mayChange onToast={onToast} />)
    const turnOn = await screen.findByRole('button', { name: `${words.turnOn}: ${words.channels.sms}` })
    expect(screen.getByRole('button', { name: `${words.turnOff}: ${words.channels.whatsapp}` })).toBeTruthy()
    fireEvent.click(turnOn)
    expect(screen.getByText(fill(words.dialogs.sms.onConsequence, { name: 'Northstar' }))).toBeTruthy()
    const confirm = screen.getByRole('button', { name: words.turnOn, hidden: true })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(words.reason.label), { target: { value: 'Pilot partner' } })
    await act(async () => fireEvent.click(confirm))
    expect(api.calls[1]?.variables).toEqual({ partnerId: partner.id, channel: 'sms', enabled: true, reason: 'Pilot partner' })
    expect(onToast).toHaveBeenCalledWith(fill(words.done.on, { channel: words.channels.sms, name: 'Northstar' }))
    expect(await screen.findByRole('button', { name: `${words.turnOff}: ${words.channels.sms}` })).toBeTruthy()
  })

  it('turns DripFunnel’s Google Maps key on with a reason, after saying what the partner’s stores will do', async () => {
    const api = stubApiSequence({ data: { partnerDfMessaging: switches(false, false, false) } }, { data: { setPartnerDfMessaging: switches(false, false, true) } })
    const onToast = vi.fn()
    render(<DfMessagingPanel partner={partner} mayChange onToast={onToast} />)
    fireEvent.click(await screen.findByRole('button', { name: `${words.turnOn}: ${words.channels.maps}` }))
    expect(screen.getByText(fill(words.dialogs.maps.onConsequence, { name: 'Northstar' }))).toBeTruthy()
    fireEvent.change(screen.getByLabelText(words.reason.label), { target: { value: 'Pilot partner' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: words.turnOn, hidden: true })))
    expect(api.calls[1]?.variables).toEqual({ partnerId: partner.id, channel: 'maps', enabled: true, reason: 'Pilot partner' })
    expect(onToast).toHaveBeenCalledWith(fill(words.done.on, { channel: words.channels.maps, name: 'Northstar' }))
    expect(await screen.findByRole('button', { name: `${words.turnOff}: ${words.channels.maps}` })).toBeTruthy()
  })

  it('keeps the dialog open when a Partner manager turns it off for a partner not assigned to them', async () => {
    stubApiSequence({ data: { partnerDfMessaging: switches(false, false, true) } }, { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }], data: null })
    render(<DfMessagingPanel partner={partner} mayChange onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: `${words.turnOff}: ${words.channels.maps}` }))
    expect(screen.getByText(fill(words.dialogs.maps.offConsequence, { name: 'Northstar' }))).toBeTruthy()
    fireEvent.change(screen.getByLabelText(words.reason.label), { target: { value: 'Contract ended' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: words.turnOff, hidden: true })))
    expect(await screen.findByText(messages.common.failures.FORBIDDEN)).toBeTruthy()
  })

  it('says what turning WhatsApp off does, and keeps the dialog open on a refusal', async () => {
    stubApiSequence({ data: { partnerDfMessaging: switches(false, true) } }, { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }], data: null })
    render(<DfMessagingPanel partner={partner} mayChange onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: `${words.turnOff}: ${words.channels.whatsapp}` }))
    expect(screen.getByText(fill(words.dialogs.whatsapp.offConsequence, { name: 'Northstar' }))).toBeTruthy()
    fireEvent.change(screen.getByLabelText(words.reason.label), { target: { value: 'Contract ended' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: words.turnOff, hidden: true })))
    expect(await screen.findByText(messages.common.failures.FORBIDDEN)).toBeTruthy()
  })

  it('shows other staff the state, each change disabled with the reason', async () => {
    stubApiSequence({ data: { partnerDfMessaging: switches(true, false) } })
    render(<DfMessagingPanel partner={partner} mayChange={false} onToast={vi.fn()} />)
    expect(await screen.findByText(words.on)).toBeTruthy()
    expect(screen.getAllByText(words.off)).toHaveLength(2)
    expect(screen.getAllByText(words.denied)).toHaveLength(3)
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  it('says when the switches didn’t load, and tries again', async () => {
    stubApiSequence({ errors: [{ message: 'down', extensions: { code: 'INTERNAL' } }], data: null }, { data: { partnerDfMessaging: switches(false, false) } })
    render(<DfMessagingPanel partner={partner} mayChange onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: words.retry }))
    expect(await screen.findByRole('button', { name: `${words.turnOn}: ${words.channels.sms}` })).toBeTruthy()
  })
})
