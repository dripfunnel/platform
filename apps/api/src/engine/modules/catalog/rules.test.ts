import { describe, expect, it } from 'vitest'
import { cleanProduct, isBarcode, slugFrom, type ProductInput, type VersionInput } from './rules'

const version = (choices: string[] = [], extra: Partial<VersionInput> = {}): VersionInput => ({ choices, prices: [{ currency: 'INR', amount: '129900' }], ...extra })
const simple = (extra: Partial<ProductInput> = {}): ProductInput => ({ name: 'Cotton shirt', options: [], versions: [version()], ...extra })

describe('a product before it is written', () => {
  it('makes a simple product one version with no choices', () => {
    const clean = cleanProduct(simple(), 'INR')
    expect(clean).toMatchObject({ name: 'Cotton shirt', slug: 'cotton-shirt', productType: 'physical', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '129900', compareAt: null }] }] })
  })

  it('needs a name, a version, and the pricing currency’s price', () => {
    expect(cleanProduct(simple({ name: '  ' }), 'INR')).toBe('NAME_REQUIRED')
    expect(cleanProduct(simple({ versions: [] }), 'INR')).toBe('VERSION_REQUIRED')
    expect(cleanProduct(simple({ versions: [version([], { prices: [{ currency: 'USD', amount: '1000' }] })] }), 'INR')).toBe('PRICE_REQUIRED')
    expect(cleanProduct(simple({ versions: [version(), version()] }), 'INR')).toBe('VERSION_CHOICES')
  })

  it('refuses bad money: unknown currencies, two prices in one, and a “was” price not above the price', () => {
    expect(cleanProduct(simple({ versions: [version([], { prices: [{ currency: 'INR', amount: '-5' }] })] }), 'INR')).toBe('INVALID_PRICE')
    expect(cleanProduct(simple({ versions: [version([], { prices: [{ currency: 'INR', amount: '100' }, { currency: 'INR', amount: '200' }] })] }), 'INR')).toBe('INVALID_PRICE')
    expect(cleanProduct(simple({ versions: [version([], { prices: [{ currency: 'INR', amount: '100', compareAtAmount: '100' }] })] }), 'INR')).toBe('INVALID_PRICE')
    expect(cleanProduct(simple({ versions: [version([], { prices: [{ currency: 'INR', amount: '100', compareAtAmount: '150' }] })] }), 'INR')).toMatchObject({ versions: [{ prices: [{ compareAt: '150' }] }] })
  })

  it('holds options to three, versions to one per combination, and every version to a value per option', () => {
    const sizes = { name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }
    const ok = cleanProduct(simple({ options: [sizes], versions: [version(['S']), version(['m'])] }), 'INR')
    expect(ok).toMatchObject({ versions: [{ choices: ['S'] }, { choices: ['m'] }] })
    expect(cleanProduct(simple({ options: [sizes, { ...sizes, name: 'B' }, { ...sizes, name: 'C' }, { ...sizes, name: 'D' }], versions: [version(['S', 'S', 'S', 'S'])] }), 'INR')).toBe('TOO_MANY_OPTIONS')
    expect(cleanProduct(simple({ options: [sizes, { ...sizes, name: 'size' }], versions: [version(['S', 'S'])] }), 'INR')).toBe('DUPLICATE_OPTION')
    expect(cleanProduct(simple({ options: [{ name: 'Size', values: [{ name: 'S' }, { name: 's' }] }], versions: [version(['S'])] }), 'INR')).toBe('DUPLICATE_VALUE')
    expect(cleanProduct(simple({ options: [{ name: 'Size', values: [] }], versions: [version([''])] }), 'INR')).toBe('OPTION_VALUES_REQUIRED')
    expect(cleanProduct(simple({ options: [sizes], versions: [version(['XL'])] }), 'INR')).toBe('VERSION_CHOICES')
    expect(cleanProduct(simple({ options: [sizes], versions: [version(['S']), version(['s'])] }), 'INR')).toBe('DUPLICATE_VERSION')
    const many = { name: 'N', values: Array.from({ length: 101 }, (_, i) => ({ name: `v${i}` })) }
    expect(cleanProduct(simple({ options: [many], versions: many.values.map((v) => version([v.name])) }), 'INR')).toBe('INVALID_INPUT')
    const tens = { name: 'N', values: Array.from({ length: 11 }, (_, i) => ({ name: `v${i}` })) }
    const both = { name: 'M', values: Array.from({ length: 10 }, (_, i) => ({ name: `w${i}` })) }
    const versions = tens.values.flatMap((a) => both.values.map((b) => version([a.name, b.name])))
    expect(cleanProduct(simple({ options: [tens, both], versions }), 'INR')).toBe('TOO_MANY_VERSIONS')
  })

  it('refuses the categories decided on #337, a repeated SKU and a barcode whose check digit fails', () => {
    expect(cleanProduct(simple({ category: 'weapons' }), 'INR')).toBe('CATEGORY_REFUSED')
    expect(cleanProduct(simple({ category: 'alcohol' }), 'INR')).toMatchObject({ category: 'alcohol' })
    const sizes = { name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }
    expect(cleanProduct(simple({ options: [sizes], versions: [version(['S'], { sku: 'A-1' }), version(['M'], { sku: 'a-1' })] }), 'INR')).toBe('DUPLICATE_SKU')
    expect(cleanProduct(simple({ versions: [version([], { barcode: '4006381333932' })] }), 'INR')).toBe('INVALID_BARCODE')
    expect(cleanProduct(simple({ productType: 'spaceship' }), 'INR')).toBe('INVALID_INPUT')
  })
})

describe('photos and video', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('keeps photos in order, each for the product or one of its versions', () => {
    expect(cleanProduct(simple({ photos: [{ assetId: id(1), alt: ' Front ' }, { assetId: id(2), version: 0 }] }), 'INR')).toMatchObject({ photos: [{ assetId: id(1), alt: 'Front', version: null }, { assetId: id(2), alt: null, version: 0 }] })
    expect(cleanProduct(simple(), 'INR')).toMatchObject({ photos: null, video: undefined })
  })

  it('refuses more than twenty photos, one twice, a version that isn’t there, and a bad id', () => {
    expect(cleanProduct(simple({ photos: Array.from({ length: 21 }, (_, i) => ({ assetId: id(i) })) }), 'INR')).toBe('TOO_MANY_PHOTOS')
    expect(cleanProduct(simple({ photos: [{ assetId: id(1) }, { assetId: id(1).toUpperCase() }] }), 'INR')).toBe('INVALID_PHOTO')
    expect(cleanProduct(simple({ photos: [{ assetId: id(1), version: 1 }] }), 'INR')).toBe('INVALID_PHOTO')
    expect(cleanProduct(simple({ photos: [{ assetId: 'not-an-id' }] }), 'INR')).toBe('INVALID_PHOTO')
  })

  it('takes a video as an upload or an https link, never both, and {} removes it', () => {
    expect(cleanProduct(simple({ video: { url: 'https://www.youtube.com/watch?v=abc' } }), 'INR')).toMatchObject({ video: { assetId: null, url: 'https://www.youtube.com/watch?v=abc' } })
    expect(cleanProduct(simple({ video: { assetId: id(3) } }), 'INR')).toMatchObject({ video: { assetId: id(3), url: null } })
    expect(cleanProduct(simple({ video: {} }), 'INR')).toMatchObject({ video: null })
    for (const video of [{ url: 'http://example.com/v' }, { url: 'javascript:alert(1)' }, { url: 'https://user:pw@example.com/v' }, { assetId: id(3), url: 'https://example.com/v' }]) {
      expect(cleanProduct(simple({ video }), 'INR')).toBe('INVALID_VIDEO')
    }
  })
})

describe('web addresses and barcodes', () => {
  it('folds accents and joins words', () => {
    expect(slugFrom('Crème brûlée — Large')).toBe('creme-brulee-large')
    expect(slugFrom('кроссовки')).toBe('')
  })

  it('checks a GTIN’s digit', () => {
    expect(isBarcode('4006381333931')).toBe(true)
    expect(isBarcode('036000291452')).toBe(true)
    expect(isBarcode('4006381333932')).toBe(false)
    expect(isBarcode('12345')).toBe(false)
  })
})
