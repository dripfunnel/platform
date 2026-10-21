import { describe, expect, it } from 'vitest'
import { checkoutProblems, cleanAddress, cleanContact, cleanGift, priceLine } from './rules'

const inr = (amount: bigint) => ({ amount, currency: 'INR' })
const item = { price: inr(99900n), available: 3, inStock: true, continueSelling: false, soldHere: true }

describe('a cart’s lines', () => {
  it('prices a line at today’s price times its quantity', () => {
    expect(priceLine({ versionId: 'v', quantity: 2, item })).toMatchObject({ unitPrice: inr(99900n), lineTotal: inr(199800n), problem: null })
  })

  it('says what stops a line being bought: gone, not sold here, unpriced, more than is left', () => {
    expect(priceLine({ versionId: 'v', quantity: 1, item: null }).problem).toBe('unavailable')
    expect(priceLine({ versionId: 'v', quantity: 1, item: { ...item, soldHere: false } }).problem).toBe('not_sold_here')
    expect(priceLine({ versionId: 'v', quantity: 1, item: { ...item, price: null } }).problem).toBe('not_priced')
    expect(priceLine({ versionId: 'v', quantity: 4, item }).problem).toBe('short')
    expect(priceLine({ versionId: 'v', quantity: 4, item: { ...item, continueSelling: true } }).problem).toBeNull()
    expect(priceLine({ versionId: 'v', quantity: 40, item: { ...item, available: null } }).problem).toBeNull()
  })
})

describe('an address and a contact', () => {
  const address = { name: ' Asha Rao ', line1: '12 MG Road', city: 'Pune', country: 'in', postalCode: '411001', phone: '+91 98450 22113' }

  it('keeps what an address needs, trimmed, the country as its code and the phone in E.164', () => {
    expect(cleanAddress(address)).toEqual({ name: 'Asha Rao', line1: '12 MG Road', line2: null, city: 'Pune', region: null, postalCode: '411001', country: 'IN', phone: '+919845022113' })
  })

  it('refuses one missing a name, a street or a city, with an unknown country, a bad phone or too long a part', () => {
    expect(cleanAddress({ ...address, name: ' ' })).toBeNull()
    expect(cleanAddress({ ...address, country: 'XX' })).toBeNull()
    expect(cleanAddress({ ...address, phone: '12345' })).toBeNull()
    expect(cleanAddress({ ...address, line1: 'x'.repeat(201) })).toBeNull()
    expect(cleanAddress({ ...address, postalCode: '1'.repeat(21) })).toBeNull()
  })

  it('reads an email in lower case and a phone in E.164, refusing either malformed', () => {
    expect(cleanContact({ email: ' Asha@Example.com ', phone: '+1 614-555-0100' })).toEqual({ email: 'asha@example.com', phone: '+16145550100' })
    expect(cleanContact({ email: 'not-an-email' })).toBeNull()
    expect(cleanContact({ phone: '0614555' })).toBeNull()
  })
})

describe('what stands between a cart and payment', () => {
  const ready = { lines: [priceLine({ versionId: 'v', quantity: 1, item })], hasContact: true, needsShipping: true, shippingOption: 'flat' as const, hasShippingAddress: true, optionOffered: true, taxKnown: true }

  it('is nothing for a cart with everything in place, and no address for collection in person', () => {
    expect(checkoutProblems(ready)).toEqual([])
    expect(checkoutProblems({ ...ready, shippingOption: 'pickup', hasShippingAddress: false })).toEqual([])
  })

  it('asks no address or delivery of a cart with nothing to send (CATALOG T14)', () => {
    expect(checkoutProblems({ ...ready, needsShipping: false, shippingOption: null, hasShippingAddress: false, optionOffered: false })).toEqual([])
  })

  it('names every gap in checkout’s order', () => {
    expect(checkoutProblems({ ...ready, lines: [], hasContact: false, shippingOption: null, hasShippingAddress: false, optionOffered: false, taxKnown: false })).toEqual(['EMPTY', 'NO_CONTACT', 'NO_ADDRESS', 'NO_SHIPPING', 'TAX_UNAVAILABLE'])
    expect(checkoutProblems({ ...ready, optionOffered: false })).toEqual(['SHIPPING_UNAVAILABLE'])
    expect(checkoutProblems({ ...ready, lines: [priceLine({ versionId: 'v', quantity: 9, item })] })).toEqual(['LINE_PROBLEM'])
  })
})

describe('a gift card’s recipient', () => {
  const today = new Date('2026-10-10T12:00:00Z')
  it('takes a name, an email, a short message and today or a day within a year', () => {
    expect(cleanGift({ recipientName: ' Meera ', recipientEmail: 'Meera@Example.com', message: ' ', sendOn: '2026-10-10' }, today)).toEqual({ recipientName: 'Meera', recipientEmail: 'meera@example.com', message: null, sendOn: '2026-10-10' })
    expect(cleanGift({ recipientName: 'Meera', recipientEmail: 'meera@example.com' }, today)?.sendOn).toBeNull()
    expect(cleanGift({ recipientName: '', recipientEmail: 'meera@example.com' }, today)).toBeNull()
    expect(cleanGift({ recipientName: 'Meera', recipientEmail: 'meera' }, today)).toBeNull()
    expect(cleanGift({ recipientName: 'Meera', recipientEmail: 'meera@example.com', sendOn: '2026-10-07' }, today)).toBeNull()
    expect(cleanGift({ recipientName: 'Meera', recipientEmail: 'meera@example.com', sendOn: '2027-12-01' }, today)).toBeNull()
    expect(cleanGift({ recipientName: 'Meera', recipientEmail: 'meera@example.com', sendOn: '14/01/2027' }, today)).toBeNull()
  })
})
