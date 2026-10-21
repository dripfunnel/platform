import type { ProductCounts, ProductRow } from '../../api/products'
import { chipsOf, priceText, readyText, statusOf, stockText, subText } from './productView'
import { canAddProduct, productAccessOf } from './access'

const row = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p-1',
  name: 'Mara Linen Shirt',
  visible: true,
  approval: null,
  productType: 'physical',
  supplier: null,
  supplierRemoved: false,
  versionCount: 1,
  minPrice: { amount: '249900', currency: 'INR' },
  maxPrice: { amount: '249900', currency: 'INR' },
  photoUrl: null,
  stock: 12,
  lowStock: false,
  readiness: [{ marketName: 'India', ready: true, missing: [] }],
  ...over,
})

const counts: ProductCounts = { all: 9, visible: 5, hidden: 0, pending: 2, sentBack: 0, lowStock: 1, missingInfo: 0, fromSuppliers: 3, outOfStock: 1 }

describe('a list row says what the API sent', () => {
  it('reads the status from approval first, then visibility', () => {
    expect(statusOf(row())).toBe('visible')
    expect(statusOf(row({ visible: false }))).toBe('hidden')
    expect(statusOf(row({ approval: 'pending', visible: false }))).toBe('pending')
    expect(statusOf(row({ approval: 'sent_back', visible: false }))).toBe('sent_back')
    expect(statusOf(row({ approval: 'approved' }))).toBe('visible')
  })

  it('formats a price, or a range of them, from minor units in the product’s currency', () => {
    expect(priceText(row())).toBe('₹2,499.00')
    expect(priceText(row({ maxPrice: { amount: '279900', currency: 'INR' } }))).toBe('₹2,499.00 – ₹2,799.00')
    expect(priceText(row({ minPrice: { amount: '2499', currency: 'USD' }, maxPrice: { amount: '2499', currency: 'USD' } }))).toBe('$24.99')
    expect(priceText(row({ minPrice: null, maxPrice: null }))).toBe('No price')
  })

  it('words the stock, with Low from the API’s own test and Not tracked for anything but a physical item', () => {
    expect(stockText(row())).toEqual({ text: '12 in stock', tone: 'neutral' })
    expect(stockText(row({ stock: 0 }))).toEqual({ text: 'Out of stock', tone: 'danger' })
    expect(stockText(row({ stock: 3, lowStock: true }))).toEqual({ text: 'Low: 3', tone: 'warning' })
    expect(stockText(row({ productType: 'digital', stock: 0 }))).toEqual({ text: 'Not tracked', tone: 'neutral' })
  })

  it('says how many versions, or what kind, and a removed supplier’s name', () => {
    expect(subText(row({ versionCount: 4 }))).toBe('4 versions')
    expect(subText(row())).toBe('No choices')
    expect(subText(row({ productType: 'gift_card' }))).toBe('Gift card')
    expect(subText(row({ supplier: { id: 's', name: 'Northwind' }, supplierRemoved: true }))).toBe('No choices · From Northwind, removed')
  })

  it('says whether it is ready to sell, and nothing for a seat that reads no market', () => {
    expect(readyText(row())).toEqual({ text: 'Ready', ready: true })
    expect(readyText(row({ readiness: [{ marketName: 'India', ready: false, missing: ['fibre', 'care'] }] }))).toEqual({ text: '2 details missing', ready: false })
    expect(readyText(row({ readiness: [{ marketName: 'India', ready: true, missing: [] }, { marketName: 'US', ready: false, missing: ['care'] }] }))).toEqual({ text: 'Ready in 1 of 2 markets', ready: false })
    expect(readyText(row({ readiness: null }))).toBeNull()
  })

  it('shows All always, and the other chips only with something in them, or while chosen', () => {
    expect(chipsOf(counts, 'all').map((chip) => chip.key)).toEqual(['all', 'visible', 'pending', 'low_stock'])
    expect(chipsOf(counts, 'hidden').map((chip) => chip.key)).toContain('hidden')
    expect(chipsOf(null, 'all')).toHaveLength(7)
    expect(chipsOf(counts, 'all')[2]).toEqual({ key: 'pending', count: 2 })
  })
})

describe('what a seat may do with products, from the permissions the API lists', () => {
  const owner = { permissions: ['catalog.read', 'catalog.write', 'stock.write', 'approve'], supplier: false }
  const staff = { permissions: ['catalog.read', 'stock.read'], supplier: false }
  const catalogue = { permissions: ['catalog.read', 'catalog.write', 'stock.write', 'catalog.propose'], supplier: true }
  const stockOnly = { permissions: ['catalog.read', 'stock.write', 'catalog.propose'], supplier: true }

  it('lets an Owner edit, count and approve, and a read-only store do none of it', () => {
    expect(productAccessOf(owner, false, false)).toMatchObject({ side: 'merchant', canEdit: true, canStock: true, canApprove: true, storeFields: true, viewOnly: false })
    expect(productAccessOf(owner, true, false)).toMatchObject({ canEdit: false, canStock: false, canApprove: false, readOnlyStore: true })
  })

  it('lets Staff look only', () => {
    expect(productAccessOf(staff, false, false)).toMatchObject({ canEdit: false, canStock: false, canApprove: false, viewOnly: true })
  })

  it('lets a supplier edit its own but never set what is the store’s, nor approve', () => {
    expect(productAccessOf(catalogue, false, false)).toMatchObject({ side: 'supplier', canEdit: true, storeFields: false, canApprove: false })
  })

  it('lets a Stock-only supplier count, and propose a new product but not edit one', () => {
    expect(productAccessOf(stockOnly, false, false)).toMatchObject({ canEdit: false, canStock: true, proposes: true })
    expect(productAccessOf(stockOnly, false, true)).toMatchObject({ canEdit: true, proposes: true })
  })

  it('offers Add to a seat that writes or proposes, unless the store is read-only', () => {
    expect(canAddProduct(owner, false)).toBe(true)
    expect(canAddProduct(stockOnly, false)).toBe(true)
    expect(canAddProduct(staff, false)).toBe(false)
    expect(canAddProduct(owner, true)).toBe(false)
  })
})
