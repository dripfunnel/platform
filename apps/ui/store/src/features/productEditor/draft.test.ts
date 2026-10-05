import { describe, expect, it } from 'vitest'
import type { EditorProduct } from '../../api/productEditor'
import { blankDraft, boxOf, combinationsOf, draftOf, gramsOf, inputOf, isDirty, newVersionCount, priceRange, problemsOf, syncVersions, type Draft } from './draft'

const product = (p: Partial<EditorProduct> = {}): EditorProduct => ({
  id: 'p1',
  revision: 3,
  name: 'Mara Linen Shirt',
  description: 'Soft linen.',
  productType: 'physical',
  visible: true,
  approval: null,
  sentBackReason: null,
  supplier: null,
  slug: 'mara-linen-shirt',
  seoTitle: null,
  seoDescription: null,
  pricingCurrency: 'INR',
  photos: [{ id: 'ph1', assetId: 'a1', url: '/api/assets/a1', alt: 'Front', versionId: null }],
  options: [{ id: 'o1', name: 'Size', values: [{ id: 'v-s', name: 'S' }, { id: 'v-m', name: 'M' }] }],
  versions: [
    { id: 'ver-s', choices: ['S'], name: null, sku: 'MARA-S', barcode: null, visible: true, prices: [{ currency: 'INR', amount: '249900', compareAtAmount: '299900' }, { currency: 'USD', amount: '3000', compareAtAmount: null }], cost: { currency: 'INR', amount: '90000' }, weightGrams: 400, lengthMm: 250, widthMm: 200, heightMm: 30, hsCode: '6205', taxClassId: 'tc5', trackStock: true },
    { id: 'ver-m', choices: ['M'], name: null, sku: null, barcode: null, visible: false, prices: [{ currency: 'INR', amount: '279900', compareAtAmount: null }], cost: null, weightGrams: 400, lengthMm: 250, widthMm: 200, heightMm: 30, hsCode: '6205', taxClassId: 'tc5', trackStock: true },
  ],
  readiness: [],
  ...p,
})

const named = (d: Draft, name: string): Draft => ({ ...d, name })

describe('the editor’s draft (CatEditor)', () => {
  it('reads a product as typed text in the pricing currency, keeping other currencies aside', () => {
    const d = draftOf(product(), 'INR')
    expect(d.versions.map((v) => [v.choices, v.price, v.compareAt, v.cost, v.sku, v.visible])).toEqual([
      [['S'], '2499.00', '2999.00', '900.00', 'MARA-S', true],
      [['M'], '2799.00', '', '', '', false],
    ])
    expect(d.versions[0]?.otherPrices).toEqual([{ currency: 'USD', amount: '3000', compareAtAmount: null }])
    expect([d.weight, d.box, d.hsCode, d.taxClassId]).toEqual(['0.4', '25 × 20 × 3', '6205', 'tc5'])
  })

  it('makes every combination of the choices, keeping the versions that match and pricing new ones like the first', () => {
    const d = draftOf(product(), 'INR')
    const colours: Draft = { ...d, options: [...d.options, { id: null, name: 'Colour', values: [{ id: null, name: 'Sand' }, { id: null, name: 'Ink' }] }] }
    expect(combinationsOf(colours.options)).toEqual([['S', 'Sand'], ['S', 'Ink'], ['M', 'Sand'], ['M', 'Ink']])
    expect(newVersionCount(colours)).toBe(4)
    const synced = syncVersions(colours)
    expect(synced.map((v) => [v.choices.join('/'), v.id, v.price])).toEqual([
      ['S/Sand', null, '2499.00'],
      ['S/Ink', null, '2499.00'],
      ['M/Sand', null, '2499.00'],
      ['M/Ink', null, '2499.00'],
    ])
    // Matching is by name whatever the case, so a renamed value's version stays.
    expect(syncVersions({ ...d, options: [{ id: 'o1', name: 'Size', values: [{ id: 'v-s', name: 's' }] }] }).map((v) => [v.id, v.choices])).toEqual([['ver-s', ['s']]])
  })

  it('asks for a name, a price above zero for each version made, and versions that match the choices', () => {
    const blank = blankDraft()
    expect(problemsOf(blank, 'INR')).toEqual(['name', 'price'])
    const priced = named({ ...blank, versions: blank.versions.map((v) => ({ ...v, price: '499' })) }, 'Kurta')
    expect(problemsOf(priced, 'INR')).toEqual([])
    expect(problemsOf({ ...priced, versions: priced.versions.map((v) => ({ ...v, compareAt: '400' })) }, 'INR')).toEqual(['compare'])
    expect(problemsOf({ ...priced, options: [{ id: null, name: 'Size', values: [{ id: null, name: 'S' }] }] }, 'INR')).toEqual(['versions'])
    expect(problemsOf({ ...priced, options: [{ id: null, name: 'Size', values: [] }] }, 'INR')).toContain('options')
    expect(problemsOf({ ...priced, weight: 'heavy' }, 'INR')).toEqual(['weight'])
    // A version not made needs no price.
    const d = draftOf(product(), 'INR')
    expect(problemsOf({ ...d, versions: d.versions.map((v, i) => (i === 1 ? { ...v, price: '', removed: true } : v)) }, 'INR')).toEqual([])
  })

  it('refuses more than 100 versions before the API has to', () => {
    const many = (n: number) => ({ id: null, name: `K${n}`, values: Array.from({ length: 5 }, (_, i) => ({ id: null, name: `${n}-${i}` })) })
    expect(problemsOf({ ...blankDraft(), name: 'x', options: [many(1), many(2), many(3)] }, 'INR')).toContain('tooMany')
  })

  it('builds the save: minor units, shipping on every version, nothing a supplier may not set, a photo by its version’s place', () => {
    const d = draftOf(product({ photos: [{ id: 'ph1', assetId: 'a1', url: '', alt: 'Front', versionId: null }, { id: 'ph2', assetId: 'a2', url: '', alt: '', versionId: 'ver-m' }] }), 'INR')
    const merchant = inputOf({ ...d, versions: d.versions.map((v, i) => (i === 0 ? { ...v, removed: true } : v)) }, 'INR', 'merchant')
    expect(merchant.versions).toEqual([
      { id: 'ver-m', choices: ['M'], sku: null, visible: false, prices: [{ currency: 'INR', amount: '279900' }], weightGrams: 400, lengthMm: 250, widthMm: 200, heightMm: 30, hsCode: '6205', taxClassId: 'tc5' },
    ])
    expect(merchant.photos).toEqual([{ assetId: 'a1', alt: 'Front' }, { assetId: 'a2', version: 0 }])
    expect(merchant.visible).toBe(true)
    const supplier = inputOf(d, 'INR', 'supplier')
    expect('visible' in supplier).toBe(false)
    expect(supplier.versions.every((v) => !('taxClassId' in v))).toBe(true)
    expect(supplier.versions[0]?.prices).toEqual([{ currency: 'INR', amount: '249900', compareAtAmount: '299900' }, { currency: 'USD', amount: '3000' }])
    // A download or a service has no parcel.
    expect(inputOf({ ...d, kind: 'digital' }, 'INR', 'merchant').versions[0]).toMatchObject({ weightGrams: null, lengthMm: null, hsCode: null })
  })

  it('reads weight and box as typed, in the store’s units, with a point or a comma', () => {
    expect([gramsOf('0.4'), gramsOf('0,4'), gramsOf(''), gramsOf('a')]).toEqual([400, 400, null, 'invalid'])
    expect([boxOf('25 × 20 × 3'), boxOf('25x20x3.5'), boxOf(''), boxOf('25 × 20')]).toEqual([[250, 200, 30], [250, 200, 35], null, 'invalid'])
    expect([gramsOf('2', 'imperial'), boxOf('10 × 8 × 1', 'imperial')]).toEqual([907, [254, 203, 25]])
    const d = draftOf(product(), 'INR', { units: 'imperial' })
    expect([d.weight, d.box]).toEqual(['0.882', '9.8 × 7.9 × 1.2'])
  })

  it('keeps each version’s own shipping unless the field is changed, then gives it to every version', () => {
    const two = product({ versions: product().versions.map((v, i) => ({ ...v, weightGrams: i === 0 ? 400 : 650, hsCode: '6205' })) })
    const d = draftOf(two, 'INR')
    expect([d.weight, d.hsCode]).toEqual(['', '6205'])
    expect(inputOf(d, 'INR', 'merchant').versions.map((v) => v.weightGrams)).toEqual([400, 650])
    const set = { ...d, weight: '1', shippingChanged: { ...d.shippingChanged, weight: true } }
    expect(inputOf(set, 'INR', 'merchant').versions.map((v) => v.weightGrams)).toEqual([1000, 1000])
  })

  it('sends back a cost kept in another currency unless a cost is typed', () => {
    const p = product({ versions: product().versions.map((v) => ({ ...v, cost: { currency: 'USD', amount: '1100' } })) })
    const d = draftOf(p, 'INR')
    expect(d.versions[0]?.cost).toBe('')
    expect(inputOf(d, 'INR', 'merchant').versions[0]?.cost).toEqual({ currency: 'USD', amount: '1100' })
    const typed = { ...d, versions: d.versions.map((v) => ({ ...v, cost: '900' })) }
    expect(inputOf(typed, 'INR', 'merchant').versions[0]?.cost).toEqual({ currency: 'INR', amount: '90000' })
  })

  it('knows when it has changed, and the range of its prices', () => {
    const d = draftOf(product(), 'INR')
    expect(isDirty(d, draftOf(product(), 'INR'))).toBe(false)
    expect(isDirty(named(d, 'Other'), d)).toBe(true)
    expect(priceRange(d, 'INR')).toEqual({ low: 249900, high: 279900 })
    expect(priceRange(blankDraft(), 'INR')).toBeNull()
  })
})
