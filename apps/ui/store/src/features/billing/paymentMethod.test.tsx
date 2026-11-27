// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { noPlanPayments, type Subscription } from '../../api/billing'
import { messages } from '../../messages'
import { PaymentMethodCard } from './PaymentMethodCard'

// Card that pays for your plan on a partner's own billing (#1744): what the Owner sees of the method its Razorpay
// subscription charges. It is saved with the first plan payment, and changing it isn't offered yet.
const words = messages.billing.card
const sub: Subscription = {
  plan: { id: 'growth', name: 'Growth' },
  status: 'trial',
  interval: 'MONTH',
  price: { amount: '99900', currency: 'INR' },
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  trialEndsAt: '2026-11-15T00:00:00.000Z',
  cancelAt: null,
  scheduled: null,
  card: null,
  upiAutoPay: null,
  collectedBy: 'partner',
  partnerName: 'Kesari Commerce',
  asOf: null,
}

afterEach(cleanup)

describe('the card that pays for the plan', () => {
  it('says the partner hasn’t set up card payments while it has no Razorpay', () => {
    render(<PaymentMethodCard sub={sub} payments={noPlanPayments} />)
    expect(screen.getByText(words.none)).toBeTruthy()
    expect(screen.getByText(words.unavailable.replaceAll('{partner}', 'Kesari Commerce'))).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says the method is saved with the first plan payment, before there is one', () => {
    render(<PaymentMethodCard sub={sub} payments={{ available: true, mode: 'test', subscribed: false }} />)
    expect(screen.getByText(words.savedWithPlan)).toBeTruthy()
    expect(screen.getByText(words.testMode)).toBeTruthy()
  })

  it('shows the saved method as Razorpay names it, and nothing to change for now', () => {
    render(<PaymentMethodCard sub={{ ...sub, upiAutoPay: 'ma••••@okhdfc' }} payments={{ available: true, mode: 'live', subscribed: true }} />)
    expect(screen.getByText('UPI AutoPay · ma••••@okhdfc')).toBeTruthy()
    expect(screen.queryByText(words.testMode)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
