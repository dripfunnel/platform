import { describe, expect, it } from 'vitest'
import { parcelOf } from './labels'

// A label's declared value (#1368): a once-per-line customisation extra is part of what the goods are worth.

const line = (id: string, unit: string, quantity: number, lineExtras: string) => ({ id, name: id, sku: null, hs_code: null, unit_amount: unit, line_extras_amount: lineExtras, quantity, weight_grams: 500 })

describe('parcelOf', () => {
  it('declares each unit with its share of a once-per-line extra, and nothing more for a line without one', () => {
    const parcel = parcelOf([line('engraved', '33000', 2, '1000'), line('plain', '5000', 3, '0')], [{ lineId: 'engraved', quantity: 1 }, { lineId: 'plain', quantity: 3 }])
    expect(parcel.items.map((i) => i.unitAmount)).toEqual([33500n, 5000n])
    expect(parcel.amount).toBe(33500n + 15000n)
  })
})
