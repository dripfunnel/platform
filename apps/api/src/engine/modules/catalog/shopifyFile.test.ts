import { describe, expect, it } from 'vitest'
import { planImport, type ImportPlan } from './importFile'
import { shopifyHeader, shopifyRows } from './shopifyFile'

describe('shopifyRows', () => {
  it('writes a connected shop’s product as Shopify’s CSV, which the import reads back', () => {
    const csv = [
      shopifyHeader.join(','),
      ...shopifyRows({
        id: 'gid://shopify/Product/1',
        handle: 'tee',
        title: 'Tee',
        descriptionHtml: '<p>Soft</p>',
        status: 'ACTIVE',
        options: ['Size'],
        images: [{ url: 'https://cdn.shopify.com/a.jpg', alt: 'Front' }, { url: 'https://cdn.shopify.com/b.jpg', alt: null }, { url: 'https://cdn.shopify.com/c.jpg', alt: null }],
        variants: [
          { sku: 'TEE-S', barcode: null, price: '499.00', compareAtPrice: null, cost: '200.00', grams: 180, quantity: 5, values: ['S'] },
          { sku: 'TEE-M', barcode: null, price: '499.00', compareAtPrice: '599.00', cost: null, grams: null, quantity: -2, values: ['M'] },
        ],
      }),
    ].join('\n')
    const plan = planImport(csv, { currency: 'INR', languages: [], manualCurrencies: [], supplier: false }) as ImportPlan
    expect(plan.problems).toEqual([])
    const [tee] = plan.products
    expect(tee?.input).toMatchObject({ name: 'Tee', description: 'Soft', visible: true, options: [{ name: 'Size' }] })
    expect(tee?.input.versions.map((v) => [v.sku, v.prices[0]?.amount, v.cost?.amount ?? null])).toEqual([['TEE-S', '49900', '20000'], ['TEE-M', '49900', null]])
    expect(tee?.stock).toEqual([5, 0])
    expect(tee?.photos.map((p) => p.line)).toEqual([2, 3, 4])
  })
})
