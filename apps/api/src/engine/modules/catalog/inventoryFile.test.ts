import { describe, expect, it } from 'vitest'
import { shopifyInventoryCsv, shopifyProductsCsv, shopifyVariantsCsv } from '../../../../tests/support/shopifyExports'
import { planImport, type ImportPlan, type PlanOptions } from './importFile'
import { applyInventory, readInventory } from './inventoryFile'

const o = { currency: 'INR', languages: [], manualCurrencies: [], supplier: false }
const plan = (text: string, options: Partial<PlanOptions> = {}) => planImport(text, { ...o, ...options }) as ImportPlan
const read = (text: string) => {
  const result = readInventory(text)
  if (typeof result === 'string') throw new Error(result)
  return result
}

describe('readInventory, Shopify’s inventory export', () => {
  it('reads each item at each location with its Available count, and says which rows it skipped as not stocked', () => {
    const { rows, problems } = read(shopifyInventoryCsv)
    expect(problems).toEqual([{ line: 7, column: 'Available (not editable)', code: 'NOT_STOCKED', file: 'inventory' }])
    expect(rows.map((r) => [r.line, r.handle, r.location, r.available])).toEqual([
      [2, 'everyday-ground-coffee-250-g', '#9,Matha pitru nivasa', 20],
      [3, 'everyday-ground-coffee-250-g', 'Indiranagar', 40],
      [4, 'everyday-chocolate-bar-100-g', '#9,Matha pitru nivasa', 40],
      [5, 'everyday-chocolate-bar-100-g', 'Indiranagar', 80],
      [6, 'everyday-dark-chocolate-bar-100-g', '#9,Matha pitru nivasa', 59],
    ])
  })

  it('lists a bad count and a missing location by line, in the inventory file', () => {
    const { rows, problems } = read('Handle,Option1 Value,SKU,Location,Available (not editable)\na,,,Shop,x\nb,,,,3\nc,,,Shop,-2\nd,,,Shop,4')
    expect(rows.map((r) => r.handle)).toEqual(['d'])
    expect(problems).toEqual([
      { line: 2, column: 'Available (not editable)', code: 'BAD_NUMBER', file: 'inventory' },
      { line: 3, column: 'Location', code: 'LOCATION_REQUIRED', file: 'inventory' },
      { line: 4, column: 'Available (not editable)', code: 'BAD_NUMBER', file: 'inventory' },
    ])
  })

  it('refuses a file that isn’t an inventory export', () => {
    expect(readInventory(shopifyProductsCsv)).toBe('NOT_INVENTORY_FILE')
    expect(readInventory('')).toBe('NOT_INVENTORY_FILE')
  })
})

describe('applyInventory, onto the products file’s versions', () => {
  it('puts each location’s count on its version, drops the products file’s own counts, and names an unmatched row', () => {
    const planned = plan(shopifyProductsCsv)
    const { locations, problems } = applyInventory(planned.products, read(shopifyInventoryCsv).rows, new Set())
    expect(locations).toEqual(['#9,Matha pitru nivasa', 'Indiranagar'])
    expect(problems).toEqual([{ line: 6, column: 'Handle', code: 'INVENTORY_UNMATCHED', file: 'inventory' }])
    const chocolate = planned.products.find((p) => p.handle === 'everyday-chocolate-bar-100-g')
    expect(chocolate?.stockAt).toEqual({ '#9,Matha pitru nivasa': [40], Indiranagar: [80] })
    expect(chocolate?.stock).toEqual([null])
  })

  it('matches by SKU when the row has one, and by option values otherwise', () => {
    const planned = plan(shopifyVariantsCsv)
    const rows = read('Handle,Option1 Value,Option2 Value,Option3 Value,SKU,Location,Available (not editable)\nribbed-tee,x,x,x,TEE-M-R,Shop,9\nribbed-tee,S,Red,Cotton,,Shop,6\nribbed-tee,L,Red,Cotton,,Shop,1').rows
    const { problems } = applyInventory(planned.products, rows, new Set())
    expect(planned.products[0]?.stockAt).toEqual({ Shop: [6, 9] })
    expect(problems.map((p) => [p.line, p.code])).toEqual([[4, 'INVENTORY_UNMATCHED']])
  })

  it('leaves rows of a product the check refused alone', () => {
    const planned = plan(shopifyProductsCsv)
    const rows = read('Handle,Location,Available (not editable)\nbroken-one,Shop,3').rows
    expect(applyInventory(planned.products, rows, new Set(['broken-one'])).problems).toEqual([])
  })
})

describe('planImport, Shopify’s real exports', () => {
  it('reads every product: name, description, price, barcode, weight, photo, SEO and status', () => {
    const { products, problems, source } = plan(shopifyProductsCsv)
    expect(source).toBe('shopify')
    expect(problems).toEqual([])
    expect(products.map((p) => p.handle)).toEqual(['everyday-chocolate-bar-100-g', 'everyday-ground-coffee-250-g'])
    const [bar] = products
    expect(bar?.input).toMatchObject({
      name: 'Everyday Chocolate Bar – 100 g',
      visible: true,
      seoTitle: 'Chocolate Bar – 100 g | Everyday Chocolate',
      options: [],
      versions: [{ choices: [], sku: null, weightGrams: 0, prices: [{ currency: 'INR', amount: '19900', compareAtAmount: null }] }],
    })
    expect(bar?.input.description).toContain('Format: Chocolate bar')
    expect(bar?.photos.map((p) => p.line)).toEqual([2])
    expect(bar?.stock).toEqual([null])
  })

  it('reads options, versions, photos in Shopify’s order, a barcode, cost, compare-at and a draft', () => {
    const { products, problems } = plan(shopifyVariantsCsv)
    expect(problems).toEqual([])
    const [tee, sketch] = products
    expect(tee?.input.options.map((x) => [x.name, x.values.map((v) => v.name)])).toEqual([['Size', ['S', 'M']], ['Color', ['Red']], ['Fabric', ['Cotton']]])
    expect(tee?.input.versions[0]).toMatchObject({ choices: ['S', 'Red', 'Cotton'], sku: 'TEE-S-R', barcode: '4006381333931', weightGrams: 180, cost: { amount: '21000' }, prices: [{ amount: '49900', compareAtAmount: '59900' }] })
    expect(tee?.stock).toEqual([5, 2])
    expect(tee?.photos.map((p) => [p.url, p.alt])).toEqual([
      ['https://cdn.example/tee-1.png', 'Front'],
      ['https://cdn.example/tee-2.png', 'Back'],
      ['https://cdn.example/tee-3.png', 'Side'],
    ])
    expect(tee?.input).toMatchObject({ seoTitle: 'Tee | Shop', seoDescription: 'A soft tee' })
    expect(sketch?.input.visible).toBe(false)
  })
})

describe('planImport, a file priced in another currency', () => {
  const convert = { from: 'USD', perEuroFrom: '1.25', perEuroTo: '100', on: '2026-11-02' }

  it('converts price, compare-at and cost to the pricing currency at the rates held, and says so', () => {
    const result = plan(shopifyVariantsCsv, { convert })
    expect(result.conversion).toEqual({ from: 'USD', to: 'INR', on: '2026-11-02' })
    expect(result.problems).toEqual([])
    expect(result.products[0]?.input.versions[0]).toMatchObject({ prices: [{ currency: 'INR', amount: '3992000', compareAtAmount: '4792000' }], cost: { currency: 'INR', amount: '1680000' } })
  })

  it('rounds half up to the pricing currency’s minor unit', () => {
    const result = plan('Handle,Title,Variant Price\nx,X,1.00', { convert: { ...convert, perEuroFrom: '1.3' } })
    expect(result.products[0]?.input.versions[0]?.prices[0]?.amount).toBe('7692')
  })

  it('leaves prices alone when no conversion is asked for', () => {
    const result = plan(shopifyVariantsCsv)
    expect(result.conversion).toBeUndefined()
    expect(result.products[0]?.input.versions[0]?.prices[0]).toMatchObject({ currency: 'INR', amount: '49900' })
  })
})

describe('planImport, naming what a product was refused for', () => {
  const header = 'Handle,Title,Body (HTML),Variant SKU,Variant Barcode,Variant Price,Variant Compare At Price,SEO Title'
  const problemsOf = (rows: string) => plan(`${header}\n${rows}`).problems.map((p) => [p.line, p.column, p.code])

  it('names a description, a name, an SEO title and a SKU over their limits, by column', () => {
    expect(problemsOf(`a,A,${'x'.repeat(20_001)},,,10,,`)).toEqual([[2, 'Body (HTML)', 'DESCRIPTION_TOO_LONG']])
    expect(problemsOf(`a,${'n'.repeat(256)},,,,10,,`)).toEqual([[2, 'Title', 'NAME_TOO_LONG']])
    expect(problemsOf(`a,A,,,,10,,${'s'.repeat(121)}`)).toEqual([[2, 'SEO Title', 'SEO_TITLE_TOO_LONG']])
    expect(problemsOf(`a,A,,${'k'.repeat(65)},,10,,`)).toEqual([[2, 'Variant SKU', 'SKU_TOO_LONG']])
  })

  it('names a barcode that is too long, and a compare-at price that is not above the price', () => {
    expect(problemsOf('a,A,,,123456789012345,10,,')).toEqual([[2, 'Variant Barcode', 'INVALID_BARCODE']])
    expect(problemsOf('a,A,,,,10,10,')).toEqual([[2, 'Variant Compare At Price', 'COMPARE_BELOW_PRICE']])
  })

  it('puts a version’s problem on that version’s own row', () => {
    const result = plan('Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Compare At Price\na,A,Size,S,S1,10,\na,,Size,M,S2,10,5')
    expect(result.problems.map((p) => [p.line, p.column, p.code])).toEqual([[3, 'Variant Compare At Price', 'COMPARE_BELOW_PRICE']])
  })
})

describe('planImport, which kind of file it was given', () => {
  it('refuses a Shopify file said to be a spreadsheet, and ours said to be Shopify’s', () => {
    expect(planImport(shopifyProductsCsv, { ...o, expect: 'csv' })).toBe('SHOPIFY_FILE')
    expect(planImport('handle,name,price\na,A,1', { ...o, expect: 'shopify' })).toBe('NOT_SHOPIFY_FILE')
  })

  it('reads either when nothing was said, and each when it matches', () => {
    expect(plan(shopifyProductsCsv).source).toBe('shopify')
    expect(plan('handle,name,price\na,A,1').source).toBe('csv')
    expect(plan(shopifyProductsCsv, { expect: 'shopify' }).source).toBe('shopify')
    expect(plan('handle,name,price\na,A,1', { expect: 'csv' }).source).toBe('csv')
  })
})
