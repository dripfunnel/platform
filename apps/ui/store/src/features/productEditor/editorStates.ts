import type { EditorProduct, TaxSetup } from '../../api/productEditor'

// The editor's states under ?state= (ui/README.md §6): loading, error, notFound, new, product (with choices),
// simple (no choices), theirs (a supplier's product, as the merchant sees it), supplier, stockOnly, sentBack,
// staff, readOnly.
export const editorStates = ['loading', 'error', 'notFound', 'new', 'product', 'simple', 'theirs', 'supplier', 'stockOnly', 'sentBack', 'staff', 'readOnly'] as const

export type EditorState = (typeof editorStates)[number]

export interface EditorSample {
  product: EditorProduct | null
  currency: string
  tax: TaxSetup | null
  seat: { permissions: string[]; seller: { id: string; name: string } | null }
  readOnly: boolean
  approvalRequired: boolean
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
  trackStock: true,
})

const owner = { permissions: ['catalog.read', 'catalog.write', 'approve', 'manage-vendors', 'tax.configure'], seller: null }
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
        pricingCurrency: 'INR',
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

export const editorSample = (state: EditorState | null): EditorSample | null => {
  if (!shirt || !state || state === 'loading' || state === 'error') return null
  const base: EditorSample = { product: shirt, currency: 'INR', tax, seat: owner, readOnly: false, approvalRequired: true }
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
      return { ...base, tax: null, seat: { permissions: ['catalog.read', 'catalog.write'], seller: northwind }, product: { ...shirt, supplier: northwind, readiness: null } }
    case 'stockOnly':
      return { ...base, tax: null, seat: { permissions: ['catalog.read', 'stock.write', 'catalog.propose'], seller: northwind }, product: { ...shirt, supplier: northwind, readiness: null } }
    case 'sentBack':
      return { ...base, tax: null, seat: { permissions: ['catalog.read', 'catalog.write'], seller: northwind }, product: { ...shirt, supplier: northwind, readiness: null, approval: 'sent_back', visible: false, sentBackReason: 'The main photo is blurry — please upload a sharper one.' } }
    case 'staff':
      return { ...base, seat: { permissions: ['catalog.read'], seller: null } }
    case 'readOnly':
      return { ...base, readOnly: true }
    default:
      return base
  }
}
