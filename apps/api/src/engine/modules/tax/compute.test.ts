import { describe, expect, it } from 'vitest'
import { computeTax, rateFor, taxIn, type TaxSetting } from './compute'

const india: TaxSetting = {
  inclusive: true,
  defaultClassId: 'standard',
  storeCountry: 'IN',
  storeRegion: 'Rajasthan',
  rates: [
    { taxClassId: 'standard', countries: ['IN'], regions: [], rateBps: 1800 },
    { taxClassId: 'clothing', countries: ['IN'], regions: [], rateBps: 500 },
    { taxClassId: 'exempt', countries: ['IN'], regions: [], rateBps: 0 },
  ],
}

describe('tax on a cart’s lines (CATALOG facts 37–38)', () => {
  it('carves GST out of an inclusive Indian price, split CGST and SGST within the store’s state', () => {
    // ₹1,180.00 at 18% included is ₹1,000.00 plus ₹180.00 of tax.
    const result = computeTax([{ id: 'a', amount: 118000n, taxClassId: null }], { country: 'IN', region: 'rajasthan' }, india)
    expect(result.lines[0]).toEqual({ id: 'a', rateBps: 1800, amount: 18000n, components: [{ name: 'CGST', rateBps: 900, amount: 9000n }, { name: 'SGST', rateBps: 900, amount: 9000n }] })
    expect(result.total).toBe(18000n)
  })

  it('charges IGST across states, each class at its rate, an exempt line none', () => {
    const result = computeTax(
      [{ id: 'a', amount: 105000n, taxClassId: 'clothing' }, { id: 'b', amount: 50000n, taxClassId: 'exempt' }],
      { country: 'IN', region: 'Maharashtra' },
      india,
    )
    expect(result.lines.map((l) => [l.id, l.amount, l.components.map((c) => c.name)])).toEqual([['a', 5000n, ['IGST']], ['b', 0n, []]])
  })

  it('adds a US store’s own state rate to an exclusive price, the state’s beating the country’s, none elsewhere', () => {
    const us: TaxSetting = {
      inclusive: false,
      defaultClassId: 'general',
      storeCountry: 'US',
      storeRegion: 'OH',
      rates: [
        { taxClassId: 'general', countries: ['US'], regions: ['OH'], rateBps: 575 },
        { taxClassId: 'general', countries: ['US'], regions: [], rateBps: 100 },
      ],
    }
    expect(computeTax([{ id: 'a', amount: 2000n, taxClassId: null }], { country: 'US', region: 'OH' }, us).lines[0]).toMatchObject({ rateBps: 575, amount: 115n, components: [{ name: 'Tax', rateBps: 575, amount: 115n }] })
    expect(rateFor('general', { country: 'US', region: 'CA' }, us.rates)).toBe(100)
    expect(rateFor('general', { country: 'CA', region: 'ON' }, us.rates)).toBe(0)
  })

  it('rounds an inclusive price’s tax so the price itself never moves', () => {
    expect(taxIn(999n, 1800, true)).toBe(152n)
    expect(taxIn(999n, 1800, false)).toBe(180n)
    expect(taxIn(0n, 1800, true)).toBe(0n)
  })

  it('splits an odd rate in whole basis points, the halves adding up to the rate and the tax', () => {
    const quarter: TaxSetting = { ...india, inclusive: false, rates: [{ taxClassId: 'standard', countries: ['IN'], regions: [], rateBps: 25 }] }
    // 0.25% of ₹1,000.01 is ₹2.50 rounded half up: halves of 125 paise, at 12 and 13 basis points.
    const [line] = computeTax([{ id: 'a', amount: 100001n, taxClassId: null }], { country: 'IN', region: 'Rajasthan' }, quarter).lines
    expect(line?.components).toEqual([{ name: 'CGST', rateBps: 12, amount: 125n }, { name: 'SGST', rateBps: 13, amount: 125n }])
  })
})
