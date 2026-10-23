import type { EditorProduct } from '../../../api/products'
import { minorOf, moneyText } from '@dripfunnel/mobile-shared/format'
import { addKindToVersions, blankDraft, combinationsOf, draftOf, inputOf, moveOptionUp, newVersionCount, problemsOf, quantityOf, removeChoice, removeKind, stockChangesOf, syncVersions, versionKey, versionsMade, type Draft } from './draft'

const product = (overrides: Partial<EditorProduct> = {}): EditorProduct => ({
  id: 'p-1',
  revision: 4,
  name: 'Mara Linen Shirt',
  description: 'Soft washed linen.',
  productType: 'physical',
  visible: true,
  approval: null,
  sentBackReason: null,
  supplier: null,
  shared: false,
  slug: 'mara-linen-shirt',
  sizeChartId: null,
  category: 'Shirts',
  warrantyText: 'One year',
  returnsText: '30 days',
  seoTitle: 'Linen shirt',
  seoDescription: 'A shirt.',
  pricingCurrency: 'INR',
  photos: [],
  options: [{ id: 'o-size', name: 'Size', values: [{ id: 'v-s', name: 'S' }, { id: 'v-m', name: 'M' }] }],
  versions: ['S', 'M'].map((size, i) => ({
    id: `ver-${size}`,
    choices: [size],
    name: null,
    sku: `MARA-${size}`,
    barcode: '4006381333931',
    visible: true,
    prices: [
      { amount: '249900', compareAtAmount: null, currency: 'INR' },
      { amount: '2999', compareAtAmount: null, currency: 'USD' },
    ],
    cost: { amount: '90000', currency: 'INR' },
    weightGrams: 400 + i,
    lengthMm: 250,
    widthMm: 200,
    heightMm: 30,
    hsCode: '6205',
    customsDescription: 'Linen shirt',
    taxClassId: 'tc-18',
    trackStock: true,
    continueSelling: false,
  })),
  readiness: null,
  ...overrides,
})

const priced = (price: string, change: Partial<Draft['versions'][number]> = {}): Draft => {
  const draft = blankDraft()
  return { ...draft, name: 'Tee', versions: [{ ...(draft.versions[0] as Draft['versions'][number]), price, ...change }] }
}

describe('a price typed in major units goes to the API in minor units', () => {
  it.each([
    ['INR', '499', '49900'],
    ['INR', '499.5', '49950'],
    ['INR', '1299.05', '129905'],
    ['USD', '24.99', '2499'],
    ['USD', '24,99', '2499'],
    ['USD', '10', '1000'],
    ['JPY', '500', '500'],
  ])('%s %s is %s', (currency, typed, minor) => {
    expect(inputOf(priced(typed), currency, 'merchant', true).versions[0]?.prices[0]).toEqual({ currency, amount: minor })
  })

  it.each([
    ['INR', '499.999'],
    ['USD', '1,299.00'],
    ['USD', 'free'],
    ['JPY', '500.5'],
    ['INR', '-5'],
  ])('refuses %s %s as typed, before anything is sent', (currency, typed) => {
    expect(minorOf(typed, currency)).toBe('invalid')
    expect(problemsOf(priced(typed), currency)).toContain('price')
  })

  it('reads empty as unpriced, and a price shown for editing is the one that was saved', () => {
    expect(minorOf('  ', 'INR')).toBeNull()
    expect(moneyText({ amount: '129905', currency: 'INR' })).toBe('1299.05')
    expect(moneyText({ amount: '500', currency: 'JPY' })).toBe('500')
    expect(draftOf(product(), 'INR').versions[0]?.price).toBe('2499.00')
  })

  it('gives back a price an untouched save would resend exactly, even past what a float holds', () => {
    const big = '9007199254740993'
    const loaded = draftOf(product({ versions: [{ ...(product().versions[0] as EditorProduct['versions'][number]), prices: [{ amount: big, compareAtAmount: null, currency: 'INR' }] }] }), 'INR')
    expect(loaded.versions[0]?.price).toBe('90071992547409.93')
    expect(inputOf(loaded, 'INR', 'merchant', false).versions[0]?.prices[0]).toEqual({ currency: 'INR', amount: big })
    expect(moneyText({ amount: '5', currency: 'INR' })).toBe('0.05')
  })

  it('sends a compare-at price and a cost in minor units too, and asks that compare-at is above the price', () => {
    const draft = priced('499', { compareAt: '599', cost: '250.50' })
    expect(inputOf(draft, 'INR', 'merchant', true).versions[0]).toMatchObject({ prices: [{ currency: 'INR', amount: '49900', compareAtAmount: '59900' }], cost: { currency: 'INR', amount: '25050' } })
    expect(problemsOf(priced('499', { compareAt: '499' }), 'INR')).toContain('compare')
    expect(problemsOf(priced('499', { compareAt: '599' }), 'INR')).not.toContain('compare')
  })

  it('lets a product with no choices be free (the sheet asks), but never a version with choices', () => {
    expect(problemsOf(priced('0'), 'INR')).not.toContain('price')
    expect(problemsOf(priced(''), 'INR')).toContain('price')
    const optioned = { ...draftOf(product(), 'INR'), versions: draftOf(product(), 'INR').versions.map((version) => ({ ...version, price: '0' })) }
    expect(problemsOf(optioned, 'INR')).toContain('price')
  })
})

describe('what the phone does not edit goes back as it came', () => {
  const loaded = draftOf(product(), 'INR')

  it('carries the product text, address and every version field the form has no control for', () => {
    const input = inputOf(loaded, 'INR', 'merchant', false)
    expect(input).toMatchObject({ slug: 'mara-linen-shirt', category: 'Shirts', warrantyText: 'One year', returnsText: '30 days', seoTitle: 'Linen shirt', seoDescription: 'A shirt.', productType: 'physical', visible: true })
    expect(input.versions[0]).toMatchObject({ id: 'ver-S', barcode: '4006381333931', weightGrams: 400, lengthMm: 250, hsCode: '6205', customsDescription: 'Linen shirt', taxClassId: 'tc-18', trackStock: true, continueSelling: false })
  })

  it('sends a merchant’s prices in other currencies as they were, and a supplier none of the store’s fields', () => {
    expect(inputOf(loaded, 'INR', 'merchant', false).versions[0]?.prices).toEqual([{ currency: 'INR', amount: '249900' }, { currency: 'USD', amount: '2999' }])
    const supplier = inputOf(loaded, 'INR', 'supplier', false)
    expect(supplier).not.toHaveProperty('visible')
    expect(supplier.versions[0]).not.toHaveProperty('taxClassId')
    expect(supplier.versions[0]?.prices).toEqual([{ currency: 'INR', amount: '249900' }])
  })

  it('sends the size chart only when it was changed: left out keeps it, null takes it off', () => {
    const attached = draftOf(product({ sizeChartId: 'sc-tops' }), 'INR')

    expect(inputOf(loaded, 'INR', 'merchant', false)).not.toHaveProperty('sizeChartId')
    expect(inputOf(attached, 'INR', 'merchant', false)).not.toHaveProperty('sizeChartId')
    expect(inputOf({ ...loaded, sizeChart: { ...loaded.sizeChart, id: 'sc-tops' } }, 'INR', 'merchant', false)).toMatchObject({ sizeChartId: 'sc-tops' })
    expect(inputOf({ ...attached, sizeChart: { ...attached.sizeChart, id: null } }, 'INR', 'merchant', false)).toMatchObject({ sizeChartId: null })
    expect(inputOf({ ...loaded, sizeChart: { ...loaded.sizeChart, id: 'sc-tops' } }, 'INR', 'supplier', false)).not.toHaveProperty('sizeChartId')
  })

  it('names no address for a new product, so the API makes one from the name', () => {
    expect(inputOf(priced('10'), 'INR', 'merchant', true)).not.toHaveProperty('slug')
  })

  it('leaves out a photo that is still uploading or failed, and one of a version no longer made', () => {
    const photo = { key: 'k', assetId: 'a-1', path: null, localUri: null, alt: '', versionChoices: null, status: 'ready' as const, code: null }
    const draft: Draft = {
      ...loaded,
      photos: [
        { ...photo, assetId: 'a-1', alt: ' Front ' },
        { ...photo, key: 'u', assetId: null, status: 'uploading' },
        { ...photo, key: 'f', assetId: 'a-2', status: 'failed' },
        { ...photo, key: 'v', assetId: 'a-3', versionChoices: ['S'] },
        { ...photo, key: 'g', assetId: 'a-4', versionChoices: ['XL'] },
      ],
    }
    expect(inputOf(draft, 'INR', 'merchant', false).photos).toEqual([{ assetId: 'a-1', alt: 'Front' }, { assetId: 'a-3', version: 0 }])
    expect(problemsOf(draft, 'INR')).toContain('photosBusy')
  })

  it('leaves a combination the seller doesn’t make out of the save', () => {
    const draft = { ...loaded, versions: loaded.versions.map((version, i) => (i === 1 ? { ...version, removed: true } : version)) }
    expect(inputOf(draft, 'INR', 'merchant', false).versions.map((version) => version.choices)).toEqual([['S']])
  })
})

describe('choices and versions', () => {
  const blank = blankDraft()
  const sizeColour: Draft = {
    ...blank,
    options: [
      { id: null, name: 'Size', values: ['S', 'M'].map((name) => ({ id: null, name })) },
      { id: null, name: 'Colour', values: ['Sand', 'Ink'].map((name) => ({ id: null, name })) },
    ],
    versions: [{ ...(blank.versions[0] as Draft['versions'][number]), price: '499' }],
  }

  it('makes one version for every combination, priced like the first, and says how many', () => {
    expect(combinationsOf(sizeColour.options)).toHaveLength(4)
    const versions = syncVersions(sizeColour)
    expect(versions.map((version) => version.choices.join('/'))).toEqual(['S/Sand', 'S/Ink', 'M/Sand', 'M/Ink'])
    expect(versions.every((version) => version.price === '499' && version.id === null)).toBe(true)
    expect(newVersionCount(sizeColour)).toBe(4)
  })

  it('asks for "Update versions" while the choices and versions disagree, and not once they agree', () => {
    expect(problemsOf(sizeColour, 'INR')).toContain('versions')
    const made = { ...sizeColour, versions: syncVersions(sizeColour) }
    expect(versionsMade(made)).toBe(true)
    expect(problemsOf(made, 'INR')).not.toContain('versions')
  })

  it('keeps a version, its id and its typed stock when a choice is added', () => {
    const loaded = draftOf(product(), 'INR', new Map([['ver-S', [{ warehouseId: 'w-1', warehouseName: 'Main', isDefault: true, onHand: 12, reserved: 2 }]]]))
    const more = { ...loaded, options: [{ ...(loaded.options[0] as Draft['options'][number]), values: [...(loaded.options[0]?.values ?? []), { id: null, name: 'L' }] }] }
    const versions = syncVersions(more)
    expect(versions.map((version) => [version.choices.join(), version.id])).toEqual([['S', 'ver-S'], ['M', 'ver-M'], ['L', null]])
    expect(more.stock[versionKey(['S'])]).toEqual({ 'w-1': '12' })
  })

  it('removes a choice with its versions, and a kind by merging versions and adding the typed stock', () => {
    const made: Draft = { ...sizeColour, versions: syncVersions(sizeColour), stock: { [versionKey(['S', 'Sand'])]: { w: '3' }, [versionKey(['S', 'Ink'])]: { w: '4' }, [versionKey(['M', 'Sand'])]: { w: '5' } } }
    const lessSand = removeChoice(made, 1, 'Sand')
    expect(lessSand.versions.map((version) => version.choices.join('/'))).toEqual(['S/Ink', 'M/Ink'])
    expect(lessSand.stock).toEqual({ [versionKey(['S', 'Ink'])]: { w: '4' } })

    const noColour = removeKind(made, 1)
    expect(noColour.options.map((option) => option.name)).toEqual(['Size'])
    expect(noColour.versions.map((version) => version.choices.join())).toEqual(['S', 'M'])
    expect(noColour.stock).toEqual({ [versionKey(['S'])]: { w: '7' }, [versionKey(['M'])]: { w: '5' } })
  })

  it('moves a kind up with the versions’ choices and typed stock following it', () => {
    const made: Draft = { ...sizeColour, versions: syncVersions(sizeColour), stock: { [versionKey(['S', 'Sand'])]: { w: '3' } } }
    const moved = moveOptionUp(made, 1)
    expect(moved.options.map((option) => option.name)).toEqual(['Colour', 'Size'])
    expect(moved.versions[0]?.choices).toEqual(['Sand', 'S'])
    expect(moved.stock).toEqual({ [versionKey(['Sand', 'S'])]: { w: '3' } })
  })

  it('gives versions that exist the first choice of a kind added to them', () => {
    const loaded = draftOf(product(), 'INR')
    const added = addKindToVersions(loaded, 'Colour', 'Sand')
    expect(added.versions.map((version) => version.choices)).toEqual([['S', 'Sand'], ['M', 'Sand']])
    expect(added.versions.map((version) => version.id)).toEqual(['ver-S', 'ver-M'])
  })

  it('refuses more than 100 versions', () => {
    const many = { ...blank, options: [{ id: null, name: 'A', values: Array.from({ length: 11 }, (_, i) => ({ id: null, name: `a${i}` })) }, { id: null, name: 'B', values: Array.from({ length: 10 }, (_, i) => ({ id: null, name: `b${i}` })) }] }
    expect(problemsOf(many, 'INR')).toContain('tooMany')
  })
})

describe('typed stock', () => {
  it('reads whole numbers only', () => {
    expect(quantityOf('12')).toBe(12)
    expect(quantityOf('')).toBeNull()
    expect(quantityOf('1.5')).toBe('invalid')
    expect(quantityOf('-1')).toBe('invalid')
  })

  it('sends only counts typed since the last save, to the versions that have ids', () => {
    const levels = new Map([['ver-S', [{ warehouseId: 'w-1', warehouseName: 'Main', isDefault: true, onHand: 12, reserved: 0 }]]])
    const saved = draftOf(product(), 'INR', levels)
    const draft: Draft = { ...saved, stock: { ...saved.stock, [versionKey(['S'])]: { 'w-1': '15' }, [versionKey(['M'])]: { 'w-1': '3' } } }
    const ids = new Map([[versionKey(['S']), 'ver-S'], [versionKey(['M']), 'ver-M']])
    expect(stockChangesOf(draft, saved, (key) => ids.get(key))).toEqual([
      { versionId: 'ver-S', warehouseId: 'w-1', quantity: 15 },
      { versionId: 'ver-M', warehouseId: 'w-1', quantity: 3 },
    ])
    expect(stockChangesOf(saved, saved, (key) => ids.get(key))).toEqual([])
  })
})
