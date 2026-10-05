import { describe, expect, it } from 'vitest'
import type { ProductRow } from '../../api/products'
import { priceText, readyOf, reviewChecks, statusOf, stockOf, subOf, summaryOf } from './productView'

const row = (r: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1',
  name: 'Kurta',
  visible: true,
  approval: null,
  productType: 'physical',
  supplier: null,
  supplierRemoved: false,
  versionCount: 1,
  minPrice: { amount: '129900', currency: 'INR' },
  maxPrice: { amount: '129900', currency: 'INR' },
  photoUrl: null,
  stock: 24,
  readiness: [{ marketName: 'India', ready: true, missing: [] }],
  ...r,
})

describe('a Products list row in words (CatList)', () => {
  it('puts approval before visibility', () => {
    expect(statusOf(row({ approval: 'pending', visible: false }))).toBe('pending')
    expect(statusOf(row({ approval: 'sent_back' }))).toBe('sent_back')
    expect(statusOf(row({ approval: 'approved', visible: false }))).toBe('hidden')
  })

  it('shows one price, a range across versions, or none', () => {
    expect(priceText(row())).toBe('₹1,299.00')
    expect(priceText(row({ maxPrice: { amount: '149900', currency: 'INR' } }))).toBe('₹1,299.00 – ₹1,499.00')
    expect(priceText(row({ minPrice: null, maxPrice: null }))).toBe('No price')
  })

  it('counts stock for physical products only, out at nothing and low at five', () => {
    expect(stockOf(row({ stock: 0 }))).toEqual({ text: 'Out of stock', tone: 'out' })
    expect(stockOf(row({ stock: 5 }))).toEqual({ text: 'Low: 5', tone: 'low' })
    expect(stockOf(row({ stock: 6 }))).toEqual({ text: '6 in stock', tone: 'normal' })
    expect(stockOf(row({ productType: 'gift_card', stock: 0 }))).toEqual({ text: 'Not tracked', tone: 'normal' })
  })

  it('says what it is under its name, and marks a removed supplier’s', () => {
    expect(subOf(row({ versionCount: 6 }))).toBe('6 versions')
    expect(subOf(row())).toBe('No choices')
    expect(subOf(row({ productType: 'digital' }))).toBe('Download')
    expect(subOf(row({ supplier: { id: 'v', name: 'Moradabad Brass' }, supplierRemoved: true }))).toBe('No choices · From Moradabad Brass, removed')
  })

  it('reads readiness for one market and for several, and nothing for a supplier', () => {
    expect(readyOf(row())).toEqual({ text: 'Ready', ready: true })
    expect(readyOf(row({ readiness: [{ marketName: 'India', ready: false, missing: ['origin', 'compare'] }] }))).toEqual({ text: '2 details missing', ready: false })
    const two = [
      { marketName: 'India', ready: true, missing: [] },
      { marketName: 'UAE', ready: false, missing: ['origin'] },
    ]
    expect(readyOf(row({ readiness: two }))).toEqual({ text: '1 of 2 markets', ready: false })
    expect(readyOf(row({ readiness: null }))).toBeNull()
  })

  it('sums up the whole catalogue from the API’s counts, never the page’s rows', () => {
    const counts = { all: 120, visible: 100, hidden: 20, pending: 1, sentBack: 0, lowStock: 0, missingInfo: 0, fromSuppliers: 30, outOfStock: 4 }
    expect(summaryOf(counts, false)).toBe('120 products · 30 from suppliers · 4 out of stock')
    expect(summaryOf({ ...counts, fromSuppliers: 0 }, false)).toBe('120 products · 4 out of stock')
    expect(summaryOf(counts, true)).toBe('120 products · 1 waiting for approval · 0 sent back')
  })

  it('lists what a review checks, each market’s missing details in words', () => {
    expect(reviewChecks(row({ readiness: [{ marketName: 'India', ready: false, missing: ['origin'] }] }))).toEqual([
      { ok: false, label: 'No photo yet' },
      { ok: true, label: 'Price filled in' },
      { ok: false, label: 'Not ready in India — country of origin missing' },
    ])
  })
})
