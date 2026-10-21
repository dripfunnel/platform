import { describe, expect, it } from 'vitest'
import { statusOf } from './GiftCardsIssued'
import { amountLabel } from './KindCards'

const card = (over: Record<string, unknown> = {}) => ({ id: 'g1', last4: 'AB12', recipientName: null, recipientEmail: 'a@example.com', amount: { amount: '50000', currency: 'INR' }, balance: { amount: '50000', currency: 'INR' }, sendOn: null, sentAt: '2026-08-14T08:00:00Z', expiresAt: '2027-08-14T08:00:00Z', source: 'order', status: 'active', ...over })
const now = new Date('2026-10-11T00:00:00Z')

describe('a card issued', () => {
  it('reads as disabled, expired, used up, not sent, part used or active, in that order', () => {
    expect(statusOf(card({ status: 'disabled', expiresAt: '2026-01-01T00:00:00Z' }), now)).toBe('disabled')
    expect(statusOf(card({ expiresAt: '2026-10-10T00:00:00Z' }), now)).toBe('expired')
    expect(statusOf(card({ balance: { amount: '0', currency: 'INR' } }), now)).toBe('usedUp')
    expect(statusOf(card({ sentAt: null, last4: null }), now)).toBe('unsent')
    expect(statusOf(card({ balance: { amount: '100', currency: 'INR' } }), now)).toBe('partUsed')
    expect(statusOf(card({ expiresAt: null }), now)).toBe('active')
  })
})

describe('an amount’s name', () => {
  it('drops the decimals of a whole amount, and keeps them otherwise', () => {
    expect(amountLabel(50000, 'INR')).toBe('₹500')
    expect(amountLabel(100000, 'INR')).toBe('₹1,000')
    expect(amountLabel(1250, 'USD')).toBe('$12.50')
    expect(amountLabel(1000, 'JPY')).toBe('¥1,000')
  })
})
