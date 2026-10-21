import type { EditorProduct, TaxSetup } from '../../api/productEditor'
import type { IssuedGiftCard, ProductKindView } from '../../api/productKinds'
import type { StockLevel, Warehouse } from '../../api/stock'
import type { CardList } from './GiftCardsIssued'
import type { EditorExtras } from './ListingSections'

// The editor's states under ?state= (ui/README.md §6): loading, error, notFound, new, product (with choices),
// simple (no choices), theirs (a supplier's product, as the merchant sees it), supplier, stockOnly, sentBack,
// staff, readOnly; the other kinds (#328): download, downloadEmpty (no file yet), keys, keysEmpty, service, kindsStaff
// (a key pool, Staff), kindsReadOnly (a key pool, read-only store), kindsSupplier (a supplier's new product: physical only),
// giftCard, and its cards issued as giftCardEmpty, giftCardLoading, giftCardError and giftCardStaff (Staff: no Issue).
export const editorStates = ['loading', 'error', 'notFound', 'new', 'product', 'simple', 'theirs', 'supplier', 'stockOnly', 'sentBack', 'staff', 'readOnly', 'download', 'downloadEmpty', 'keys', 'keysEmpty', 'service', 'kindsStaff', 'kindsReadOnly', 'kindsSupplier', 'giftCard', 'giftCardEmpty', 'giftCardLoading', 'giftCardError', 'giftCardStaff'] as const

export type EditorState = (typeof editorStates)[number]

export interface EditorSample {
  product: EditorProduct | null
  currency: string
  tax: TaxSetup | null
  seat: { permissions: string[]; seller: { id: string; name: string } | null }
  readOnly: boolean
  approvalRequired: boolean
  warehouses: Warehouse[]
  levels: Map<string, StockLevel[]>
  extras: EditorExtras
  kind: ProductKindView | null
  cards: CardList | null
}

const inr = (amount: string, compareAtAmount: string | null = null) => ({ currency: 'INR', amount, compareAtAmount })
const version = (id: string, choices: string[], amount: string, visible = true) => ({
  id,
  choices,
  name: null,
  sku: `MARA-${choices.join('-')}`,
  barcode: null,
  visible,
  prices: [inr(amount)],
  cost: { currency: 'INR', amount: '90000' },
  weightGrams: 400,
  lengthMm: 250,
  widthMm: 200,
  heightMm: 30,
  hsCode: '6205',
  taxClassId: null,
  trackStock: true, continueSelling: false,
})

const owner = { permissions: ['catalog.read', 'catalog.write', 'stock.read', 'stock.write', 'approve', 'manage-vendors', 'tax.configure'], seller: null }
const northwind = { id: 'seller-northwind', name: 'Northwind Textiles' }
const tax: TaxSetup = {
  pricesIncludeTax: true,
  classes: [
    { id: 'tc-18', name: 'GST 18%', isDefault: true },
    { id: 'tc-5', name: 'GST 5% · clothing', isDefault: false },
    { id: 'tc-0', name: 'Exempt', isDefault: false },
  ],
}

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const shirt: EditorProduct | null =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        id: 'p-mara',
        revision: 4,
        name: 'Mara Linen Shirt',
        description: 'Soft washed linen with a relaxed fit. Pre-washed, so it won’t shrink.',
        productType: 'physical',
        visible: true,
        approval: null,
        sentBackReason: null,
        supplier: null,
        slug: 'mara-linen-shirt',
        seoTitle: null,
        seoDescription: null,
        pricingCurrency: 'INR', listing: { specs: [], highlights: [], faqs: [], relatedIds: [], related: [], badgeIds: [], compliance: [], ageRestricted: null, hazardous: null }, filterValues: [], sizeChartId: null, 
        photos: [],
        options: [
          { id: 'o-size', name: 'Size', values: ['S', 'M', 'L'].map((name) => ({ id: `v-${name}`, name })) },
          { id: 'o-colour', name: 'Colour', values: ['Sand', 'Ink'].map((name) => ({ id: `v-${name}`, name })) },
        ],
        versions: [
          version('ver-1', ['S', 'Sand'], '249900'),
          version('ver-2', ['S', 'Ink'], '249900'),
          version('ver-3', ['M', 'Sand'], '249900'),
          version('ver-4', ['M', 'Ink'], '249900', false),
          version('ver-5', ['L', 'Sand'], '279900'),
          version('ver-6', ['L', 'Ink'], '279900'),
        ],
        readiness: [
          { marketId: 'm-in', marketName: 'India', ready: true, missing: [] },
          { marketId: 'm-us', marketName: 'United States', ready: false, missing: ['fibre', 'care'] },
        ],
      }
    : null

const warehouses: Warehouse[] = [
  { id: 'w-jaipur', name: 'Jaipur studio', isDefault: true },
  { id: 'w-delhi', name: 'Delhi godown', isDefault: false },
]
const level = (onHand: number, reserved = 0, w: Warehouse = warehouses[0] ?? { id: 'w', name: 'w', isDefault: true }): StockLevel => ({ warehouseId: w.id, warehouseName: w.name, isDefault: w.isDefault, onHand, reserved })
const levels = new Map<string, StockLevel[]>([
  ['ver-1', [level(12, 2)]],
  ['ver-2', [level(4)]],
  ['ver-3', [level(20)]],
  ['ver-4', [level(0)]],
  ['ver-5', [level(7)]],
  ['ver-6', [level(3)]],
  ['ver-c', [level(18, 3), level(6, 0, warehouses[1])]],
])

const merchantExtras: EditorExtras = {
  languages: { main: 'en-IN', others: ['hi-IN'] },
  currencies: [{ code: 'USD', mode: 'auto' }, { code: 'AED', mode: 'manual' }],
  converted: new Map([['ver-c', [{ currency: 'USD', amount: '1599', compareAtAmount: null, source: 'converted' }]]]),
  choices: {
    shown: new Set(['specs', 'highlights', 'badges', 'sizeCharts', 'filters', 'legal']),
    facets: [
      { id: 'f-fabric', name: 'Fabric', shopperVisible: true, values: ['Linen', 'Cotton', 'Silk'].map((name) => ({ id: `fv-${name}`, name })) },
      { id: 'f-occasion', name: 'Occasion', shopperVisible: true, values: ['Everyday', 'Festive'].map((name) => ({ id: `fv-${name}`, name })) },
    ],
    sizeCharts: [{ id: 'sc-shirts', name: 'Men’s shirts' }],
    aplus: 'on',
    unavailable: new Set(),
    collections: { handPicked: [{ id: 'c-summer', name: 'Summer edit' }, { id: 'c-gifts', name: 'Gifts under ₹3,000' }], automatic: [{ id: 'c-linen', name: 'All linen', kind: 'automatic' }] },
  },
  badges: [
    { id: 'b-new', label: 'New', rule: 'new', tone: 'ok', position: 0 },
    { id: 'b-handmade', label: 'Handmade', rule: 'manual', tone: 'neutral', position: 1 },
  ],
  memberships: [{ id: 'c-summer', name: 'Summer edit', kind: 'manual' }, { id: 'c-linen', name: 'All linen', kind: 'automatic' }],
}
const supplierExtras: EditorExtras = { languages: merchantExtras.languages, currencies: [], converted: new Map(), choices: { ...merchantExtras.choices, collections: null }, badges: null, memberships: [] }

const kindOf = (productId: string, productType: string, over: Partial<ProductKindView>): ProductKindView => ({ productId, productType, revision: 3, download: null, service: null, giftCard: null, ...over })
const pool = (left: number) => ({ mode: 'keys' as const, file: null, limit: 5, days: 30, keysLeft: left, keysSold: 12 })
const card = (id: string, last4: string | null, to: string, balance: string, expiresAt: string | null, sentAt: string | null = '2026-08-14T08:00:00Z'): IssuedGiftCard => ({
  id,
  last4,
  recipientName: to,
  recipientEmail: `${to.split(' ')[0]?.toLowerCase() ?? 'card'}@example.com`,
  amount: { amount: '100000', currency: 'INR' },
  balance: { amount: balance, currency: 'INR' },
  sendOn: null,
  sentAt,
  expiresAt,
  source: 'issued',
  status: 'active',
})
const cards: CardList = {
  kind: 'ready',
  rows: [card('g1', '91MX', 'Meera Iyer', '100000', '2027-08-14T08:00:00Z'), card('g2', '4QK2', 'Rohan Mehta', '25000', '2027-01-02T08:00:00Z'), card('g3', 'Z7PD', 'Kabir Singh', '0', '2026-03-09T08:00:00Z'), card('g4', null, 'Anya Rao', '100000', null, null)],
  next: 'more',
  more: 'idle',
}

export const editorSample = (state: EditorState | null): EditorSample | null => {
  if (!shirt || !state || state === 'loading' || state === 'error') return null
  const base: EditorSample = { product: shirt, currency: 'INR', tax, seat: owner, readOnly: false, approvalRequired: true, warehouses, levels, extras: merchantExtras, kind: null, cards: null }
  const single = (id: string, name: string, productType: string, amount: string) => ({ ...shirt, id, name, productType, options: [], versions: [{ ...version(`${id}-v`, [], amount), weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, trackStock: null, continueSelling: null }] })
  const download = single('p-patterns', 'Sanganeri pattern pack', 'digital', '49900')
  const keys = single('p-fonts', 'Devanagari font licence', 'digital', '99900')
  const service = single('p-fitting', 'Tailoring and fitting', 'service', '150000')
  const giftCard: EditorProduct = {
    ...shirt,
    id: 'p-gift',
    name: 'Kesari gift card',
    productType: 'gift_card',
    options: [{ id: 'o-amount', name: 'Amount', values: ['₹500', '₹1,000', '₹2,000'].map((name, i) => ({ id: `v-a${i}`, name })) }],
    versions: [['₹500', '50000'], ['₹1,000', '100000'], ['₹2,000', '200000']].map(([name = '', amount = ''], i) => ({ ...version(`ver-g${i}`, [name], amount), weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, cost: null, trackStock: null, continueSelling: null })),
  }
  const giftKind = kindOf('p-gift', 'gift_card', { giftCard: { expiryMonths: 12, shortestMonths: 12 } })
  const simple: EditorProduct = { ...shirt, id: 'p-cushion', name: 'Block-print Cushion Cover', options: [], versions: [{ ...version('ver-c', [], '129900'), prices: [inr('129900', '159900')] }] }
  switch (state) {
    case 'notFound':
      return { ...base, product: null }
    case 'new':
      return { ...base, product: null }
    case 'simple':
      return { ...base, product: simple }
    case 'theirs':
      return { ...base, product: { ...shirt, supplier: northwind } }
    case 'supplier':
      return { ...base, extras: supplierExtras, tax: null, seat: { permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: northwind }, product: { ...shirt, supplier: northwind, readiness: null } }
    case 'stockOnly':
      return { ...base, extras: supplierExtras, tax: null, seat: { permissions: ['catalog.read', 'stock.write', 'catalog.propose'], seller: northwind }, product: { ...shirt, supplier: northwind, readiness: null } }
    case 'sentBack':
      return { ...base, extras: supplierExtras, tax: null, seat: { permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: northwind }, product: { ...shirt, supplier: northwind, readiness: null, approval: 'sent_back', visible: false, sentBackReason: 'The main photo is blurry — please upload a sharper one.' } }
    case 'staff':
      return { ...base, seat: { permissions: ['catalog.read', 'stock.read'], seller: null } }
    case 'readOnly':
      return { ...base, readOnly: true }
    case 'download':
      return { ...base, product: download, kind: kindOf(download.id, 'digital', { download: { mode: 'file', file: { id: 'f-patterns', mime: 'application/pdf', bytes: 18_400_000 }, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }) }
    case 'downloadEmpty':
      return { ...base, product: download, kind: kindOf(download.id, 'digital', { download: { mode: 'file', file: null, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }) }
    case 'keys':
      return { ...base, product: keys, kind: kindOf(keys.id, 'digital', { download: pool(3) }) }
    case 'keysEmpty':
      return { ...base, product: keys, kind: kindOf(keys.id, 'digital', { download: pool(0) }) }
    case 'kindsReadOnly':
      return { ...base, readOnly: true, product: keys, kind: kindOf(keys.id, 'digital', { download: pool(40) }) }
    case 'service':
      return { ...base, product: service, kind: kindOf(service.id, 'service', { service: { duration: '2 hours', location: 'Our Jaipur studio, MI Road' } }) }
    case 'giftCard':
      return { ...base, product: giftCard, kind: giftKind, cards }
    case 'giftCardEmpty':
      return { ...base, product: giftCard, kind: giftKind, cards: { kind: 'ready', rows: [], next: null, more: 'idle' } }
    case 'giftCardLoading':
      return { ...base, product: giftCard, kind: giftKind, cards: { kind: 'loading' } }
    case 'giftCardError':
      return { ...base, product: giftCard, kind: giftKind, cards: { kind: 'failed' } }
    case 'kindsStaff':
      return { ...base, seat: { permissions: ['catalog.read', 'stock.read'], seller: null }, product: keys, kind: kindOf(keys.id, 'digital', { download: pool(40) }) }
    case 'giftCardStaff':
      return { ...base, seat: { permissions: ['catalog.read', 'stock.read'], seller: null }, product: giftCard, kind: giftKind, cards }
    case 'kindsSupplier':
      return { ...base, extras: supplierExtras, tax: null, seat: { permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: northwind }, product: null }
    default:
      return base
  }
}
