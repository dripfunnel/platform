import { describe, expect, it } from 'vitest'
import { planImport, textOfHtml, type ImportPlan } from './importFile'

const o = { currency: 'INR', languages: ['hi-IN'], manualCurrencies: ['USD'], supplier: false }
const plan = (text: string, options = o) => planImport(text, options) as ImportPlan

describe('planImport, our own columns', () => {
  const file = [
    'handle,name,description,type,visible,option1 name,option1 value,option2 name,option2 value,option3 name,option3 value,sku,barcode,price,compare at price,cost,weight grams,stock,name:hi-IN,description:hi-IN,price:USD',
    `kurta,Kurta,"'=cotton, handloomed",physical,yes,Size,S,,,,,KU-S,,1299.50,1499.00,600.00,300,7,कुर्ता,,15.99`,
    'kurta,,,,,,M,,,,,KU-M,,1299.50,,,,0,,,',
    '',
    'lamp,Lamp,,,no,,,,,,,LAMP,,50,,,,,,,',
  ].join('\n')

  it('reads an export back as the products it wrote, in minor units', () => {
    const { products, problems, source } = plan(file)
    expect(source).toBe('csv')
    expect(problems).toEqual([])
    const [kurta, lamp] = products
    expect(kurta?.lines).toEqual([2, 3])
    expect(kurta?.input).toMatchObject({ name: 'Kurta', description: '=cotton, handloomed', visible: true, productType: 'physical', options: [{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }] })
    expect(kurta?.input.versions[0]).toMatchObject({ choices: ['S'], sku: 'KU-S', weightGrams: 300, cost: { currency: 'INR', amount: '60000' }, prices: [{ currency: 'INR', amount: '129950', compareAtAmount: '149900' }, { currency: 'USD', amount: '1599' }] })
    expect(kurta?.stock).toEqual([7, 0])
    expect(kurta?.translations).toEqual({ 'hi-IN': { name: 'कुर्ता' } })
    // A blank line between them doesn't move the line numbers a spreadsheet shows.
    expect(lamp?.lines).toEqual([5])
    expect(lamp?.input.visible).toBe(false)
  })

  it('lists each problem by line and column, keeping the products that have none', () => {
    const result = plan(['handle,name,sku,price,stock,name:fr-FR,price:EUR', 'a,A,X1,12.5x,,,', 'b,B,X1,10,-3,,', 'c,C,X2,10,4,,', ',,,,,,'].join('\n'))
    expect(result.problems).toEqual([
      { line: 1, column: 'name:fr-FR', code: 'UNKNOWN_LANGUAGE' },
      { line: 1, column: 'price:EUR', code: 'NOT_MANUAL_CURRENCY' },
      { line: 2, column: 'price', code: 'BAD_PRICE' },
      { line: 3, column: 'stock', code: 'BAD_NUMBER' },
      { line: 3, column: 'sku', code: 'SKU_IN_FILE' },
    ])
    expect(result.products.map((p) => p.handle)).toEqual(['c'])
    expect(result.refused).toBe(2)
  })

  it('checks each product as a save would', () => {
    expect(plan('handle,name,price\nfree,Free,\n').problems).toEqual([{ line: 2, column: 'price', code: 'PRICE_REQUIRED' }])
  })

  it('leaves a supplier’s visibility to approval and its prices in the store’s currency', () => {
    const result = plan('handle,name,visible,price,price:USD\nmug,Mug,no,200,3\n', { ...o, supplier: true })
    expect(result.problems).toEqual([{ line: 1, column: 'price:USD', code: 'SUPPLIER_CURRENCY' }])
    expect(result.products[0]?.input.visible).toBeNull()
    expect(result.products[0]?.input.versions[0]?.prices).toEqual([{ currency: 'INR', amount: '20000', compareAtAmount: null }])
  })

  it('refuses a file it can’t read, an empty one, and one with nothing to name a product by', () => {
    expect(planImport('a,"b\n', o)).toBe('UNREADABLE')
    expect(planImport('handle,name\n', o)).toBe('EMPTY')
    expect(planImport('colour,size\nred,S\n', o)).toBe('NO_NAME_COLUMN')
  })
})

describe('planImport, Shopify’s product CSV', () => {
  const file = [
    'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Variant Compare At Price,Variant Barcode,Image Src,Image Alt Text,Cost per item,Status',
    'tee,Tee,<p>Soft &amp; light</p><br>Cotton,Acme,Shirts,,TRUE,Size,S,TEE-S,180,5,499.00,,036000291452,https://cdn.example/tee.jpg,Front,200.00,active',
    'tee,,,,,,,,M,TEE-M,190,2,499.00,,,https://cdn.example/tee-back.jpg,Back,,',
    'mug,Mug,,Acme,,,FALSE,Title,Default Title,MUG,350,,250.00,,,,,,draft',
  ].join('\n')

  it('reads variants, HTML, images and Shopify’s simple product', () => {
    const { source, products, problems } = plan(file)
    expect(source).toBe('shopify')
    expect(problems).toEqual([])
    const [tee, mug] = products
    expect(tee?.input).toMatchObject({ name: 'Tee', description: 'Soft & light\n\nCotton', visible: true, productType: null, options: [{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }] })
    expect(tee?.input.versions.map((v) => v.sku)).toEqual(['TEE-S', 'TEE-M'])
    expect(tee?.stock).toEqual([5, 2])
    expect(tee?.photos).toEqual([{ url: 'https://cdn.example/tee.jpg', alt: 'Front', line: 2 }, { url: 'https://cdn.example/tee-back.jpg', alt: 'Back', line: 3 }])
    expect(mug?.input).toMatchObject({ visible: false, options: [], versions: [{ choices: [], sku: 'MUG', weightGrams: 350 }] })
  })

  it('turns HTML into text', () => {
    expect(textOfHtml('<h2>Care</h2><ul><li>Hand wash</li><li>Dry flat</li></ul>&lt;3')).toBe('Care\nHand wash\nDry flat\n<3')
  })

  it('leaves out a photo too long for the photo job, on its own line, and still imports the product', () => {
    const long = `https://cdn.example/${'a'.repeat(2048)}.jpg`
    const p = plan(`handle,name,price,image,image alt\npot,Pot,10,${long},\npot,,,https://cdn.example/b.jpg,${'x'.repeat(501)}\npot,,,https://cdn.example/c.jpg,Side\n`)
    expect(p.products.map((x) => x.photos.map((ph) => ph.url))).toEqual([['https://cdn.example/c.jpg']])
    expect(p.problems).toEqual([
      { line: 2, column: 'image', code: 'PHOTO_TOO_LONG' },
      { line: 3, column: 'image alt', code: 'PHOTO_TOO_LONG' },
    ])
    expect(p.refused).toBe(0)
  })
})

describe('planImport, a product past the photo limit', () => {
  it('takes its first 20 photos and says the rest were left out', () => {
    const rows = Array.from({ length: 21 }, (_, i) => `many,${i === 0 ? 'Many photos' : ''},${i === 0 ? '10' : ''},https://cdn.example/${i}.jpg`)
    const result = planImport(['handle,name,price,image', ...rows].join('\n'), { currency: 'INR', languages: [], manualCurrencies: [], supplier: false }) as ImportPlan
    expect(result.products[0]?.photos).toHaveLength(20)
    expect(result.problems).toEqual([{ line: 22, column: 'image', code: 'TOO_MANY_PHOTOS' }])
  })
})
