// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'

const words = messages.settings.payout
const stripe = {
  createToken: vi.fn(),
  createPaymentMethod: vi.fn(),
  elements: () => ({ create: () => ({ mount: vi.fn(), on: (_: string, change: (e: { complete: boolean }) => void) => change({ complete: true }), destroy: vi.fn() }) }),
}
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: () => Promise.resolve(stripe) }))

const { BankDialog, CardDialog, stripeFor } = await import('./PayoutDialogs')

// What reaches our API: every request body the console sends while a number is typed into Stripe's side.
const sent: string[] = []
beforeEach(() => {
  sent.length = 0
  stripe.createToken.mockReset()
  stripe.createPaymentMethod.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    sent.push(String(init.body))
    return Promise.resolve(new Response(JSON.stringify({ data: { setPayoutAccount: { ok: true, reason: null }, setPaymentMethod: { ok: true, reason: null } } })))
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

describe('adding a bank account', () => {
  it('asks Stripe.js for a token and sends only that token to the API', async () => {
    stripe.createToken.mockResolvedValue({ token: { id: 'btok_1Abc23XyZ' } })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<BankDialog changing={false} country="US" currency="USD" stripe={stripeFor('pk_test_a')} onSaved={onSaved} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(words.account.holder), 'Northstar Commerce LLC')
    await user.type(screen.getByLabelText(words.account.routing), '110000000')
    await user.type(screen.getByLabelText(words.account.number), '000123456789')
    await user.click(screen.getByRole('button', { name: words.account.save }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(stripe.createToken).toHaveBeenCalledWith('bank_account', expect.objectContaining({ account_number: '000123456789', routing_number: '110000000' }))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('btok_1Abc23XyZ')
    for (const secret of ['000123456789', '110000000', 'Northstar']) expect(sent[0]).not.toContain(secret)
  })

  it('says what Stripe refused and sends nothing', async () => {
    stripe.createToken.mockResolvedValue({ error: { message: 'Invalid routing number' } })
    const user = userEvent.setup()
    render(<BankDialog changing country="US" currency="USD" stripe={stripeFor('pk_test_a')} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(words.account.holder), 'A')
    await user.type(screen.getByLabelText(words.account.routing), '1234')
    await user.type(screen.getByLabelText(words.account.number), '12345678')
    await user.click(screen.getByRole('button', { name: words.account.save }))
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid routing number')
    expect(sent).toHaveLength(0)
  })

  it('words the API’s refusal by its code', async () => {
    stripe.createToken.mockResolvedValue({ token: { id: 'btok_1Abc23XyZ' } })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ data: { setPayoutAccount: { ok: false, reason: 'TOKEN_REFUSED' } } }))))
    const user = userEvent.setup()
    render(<BankDialog changing={false} country="DE" currency="EUR" stripe={stripeFor('pk_test_a')} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(words.account.holder), 'Kappa GmbH')
    await user.type(screen.getByLabelText(words.account.iban), 'DE89370400440532013000')
    await user.click(screen.getByRole('button', { name: words.account.save }))
    expect((await screen.findByRole('alert')).textContent).toBe(messages.billing.refusals.TOKEN_REFUSED)
  })
})

describe('adding a card', () => {
  it('sends only the payment method Stripe’s field made', async () => {
    stripe.createPaymentMethod.mockResolvedValue({ paymentMethod: { id: 'pm_1Abc23XyZ' } })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<CardDialog changing={false} stripe={stripeFor('pk_test_a')} onSaved={onSaved} onCancel={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: words.card.save }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: words.card.save }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('pm_1Abc23XyZ')
    expect(screen.queryByLabelText(/card number/i)).toBeNull()
  })
})
