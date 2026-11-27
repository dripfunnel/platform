// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { RazorpayAccount } from './RazorpayAccount'

// Billing › Razorpay account (#1744): what the partner sees of its keys, and what the console sends when it connects them.
const words = messages.billing.razorpay
const account = {
  webhookUrl: 'https://hooks.example/razorpay/partner/p1',
  modes: [
    { mode: 'live', connected: false, keyHint: null, checkedAt: null },
    { mode: 'test', connected: true, keyHint: 'rzp_test_••••3456', checkedAt: '2026-11-20T10:00:00Z' },
  ],
}
const sent: { query: string; variables?: Record<string, unknown> }[] = []
let connectAnswer: { ok: boolean; reason: string | null } = { ok: true, reason: null }

beforeEach(() => {
  sent.length = 0
  connectAnswer = { ok: true, reason: null }
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables?: Record<string, unknown> }
    sent.push(body)
    const data = body.query.includes('connectRazorpay') ? { connectRazorpay: connectAnswer } : body.query.includes('disconnectRazorpay') ? { disconnectRazorpay: { ok: true, reason: null } } : { razorpayAccount: account }
    return Promise.resolve(new Response(JSON.stringify({ data })))
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

describe('the Razorpay account', () => {
  it('shows each mode, a connected key only as its mode and last four, and the webhook address', async () => {
    render(<RazorpayAccount mayChange onToast={vi.fn()} />)
    expect(await screen.findByText('rzp_test_••••3456')).toBeTruthy()
    expect(screen.getByText(account.webhookUrl)).toBeTruthy()
    expect(screen.getAllByText(words.notConnected)).toHaveLength(1)
    expect(screen.getByRole('button', { name: words.connect })).toBeTruthy()
    expect(screen.getByRole('button', { name: words.disconnect })).toBeTruthy()
  })

  it('offers nothing to change to anyone but Owners and Finance', async () => {
    render(<RazorpayAccount mayChange={false} onToast={vi.fn()} />)
    expect(await screen.findByText(words.ownersAndFinance)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.connect })).toBeNull()
    expect(screen.queryByRole('button', { name: words.disconnect })).toBeNull()
  })

  it('sends a live key of the live shape with its secrets once, and words Razorpay’s refusal', async () => {
    const user = userEvent.setup()
    const toast = vi.fn()
    render(<RazorpayAccount mayChange onToast={toast} />)
    await user.click(await screen.findByRole('button', { name: words.connect }))
    await user.type(screen.getByLabelText(words.fields.keyId), 'rzp_test_wrongmode1')
    await user.type(screen.getByLabelText(words.fields.keySecret), 's3cret')
    await user.type(screen.getByLabelText(words.fields.webhookSecret), 'hook')
    expect(screen.getByText(words.incomplete.replace('{mode}', 'live'))).toBeTruthy()
    await user.clear(screen.getByLabelText(words.fields.keyId))
    await user.type(screen.getByLabelText(words.fields.keyId), 'rzp_live_AbCdEf123456')
    connectAnswer = { ok: false, reason: 'KEY_REJECTED' }
    await user.click(screen.getByRole('button', { name: words.connectCta }))
    expect(await screen.findByText(words.refusals.KEY_REJECTED)).toBeTruthy()
    connectAnswer = { ok: true, reason: null }
    await user.click(screen.getByRole('button', { name: words.connectCta }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Razorpay Live keys connected.'))
    const connects = sent.filter((s) => s.query.includes('connectRazorpay'))
    expect(connects[1]?.variables).toEqual({ mode: 'live', keyId: 'rzp_live_AbCdEf123456', keySecret: 's3cret', webhookSecret: 'hook' })
  })
})
