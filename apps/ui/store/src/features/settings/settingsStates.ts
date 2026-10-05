import type { StoreInfo, StoreLocale } from '../../api/settings'
import type { Market } from '../../api/markets'
import type { InvoiceSettings, TaxSetupFull } from '../../api/tax'
import type { Person, Supplier } from '../../api/team'

// Settings' states under ?state= (ui/README.md §6): loading, error, list (the samples), readOnly (a store past due: look only)
// and denied (anyone but the Owner).
export const settingsStates = ['loading', 'error', 'list', 'readOnly', 'denied'] as const

export type SettingsState = (typeof settingsStates)[number]

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

export const sampleInfo: StoreInfo | null = harness
  ? {
      name: 'Kesari Threads',
      legalName: 'Kesari Threads Pvt Ltd',
      description: 'Handloom and block-print clothing from Jaipur',
      logoAssetId: null,
      address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
      contactEmail: 'hello@kesarithreads.in',
      contactPhone: '+91 98290 12345',
      country: 'IN',
      taxId: '08ABCDE1234F1Z5',
      timeZone: 'Asia/Kolkata',
      unitSystem: 'metric',
      orderPrefix: 'KT-',
      nextOrderNumber: '1042',
    }
  : null

export const sampleLocale: StoreLocale | null = harness
  ? {
      pricingCurrency: 'INR',
      mainLanguage: 'en-IN',
      offeredLanguages: ['en-IN', 'en-US', 'hi-IN'],
      currencies: [
        { code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' },
        { code: 'AED', mode: 'manual', rounding: 'none', status: 'active' },
      ],
      languages: [
        { code: 'en-IN', status: 'active' },
        { code: 'hi-IN', status: 'active' },
      ],
      rates: [
        { currency: 'INR', perEuro: '97.12', publishedOn: '2026-10-05' },
        { currency: 'USD', perEuro: '1.09', publishedOn: '2026-10-05' },
        { currency: 'AED', perEuro: '4.00', publishedOn: '2026-10-05' },
        { currency: 'GBP', perEuro: '0.84', publishedOn: '2026-10-05' },
      ],
      examples: [
        { currency: 'USD', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
        { currency: 'AED', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '400' }, nearest: { amount: '400' }, ends99: { amount: '499' } },
        { currency: 'EUR', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '100' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
        { currency: 'GBP', publishedOn: '2026-10-04', from: { amount: '10000', currency: 'INR' }, none: { amount: '84' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
      ],
    }
  : null

const samplePeople: Person[] = harness
  ? [
      { id: 'm1', kind: 'member', name: 'Farhan Ali', email: 'farhan@kesarithreads.in', role: 'owner', you: true, since: '2026-06-01T09:00:00Z', expiresAt: null, expired: false },
      { id: 'm2', kind: 'member', name: 'Meera Joshi', email: 'meera@kesarithreads.in', role: 'manager', you: false, since: '2026-07-12T09:00:00Z', expiresAt: null, expired: false },
      { id: 'm3', kind: 'member', name: 'Ravi Kumar', email: 'ravi@kesarithreads.in', role: 'staff', you: false, since: '2026-08-02T09:00:00Z', expiresAt: null, expired: false },
      { id: 'i1', kind: 'invitation', name: null, email: 'asha@example.com', role: 'staff', you: false, since: '2026-10-04T09:00:00Z', expiresAt: '2026-10-11T09:00:00Z', expired: false },
    ]
  : []

const sampleSuppliers: Supplier[] = harness
  ? [
      { id: 'v1', name: 'Northwind Textiles', accessLevel: 'vendor-catalogue', shippingMode: 'to-store', labelAccount: 'store', status: 'active', users: 2, products: 14 },
      { id: 'v2', name: 'Sanganer Prints', accessLevel: 'vendor-orders-fulfil', shippingMode: 'to-shopper', labelAccount: 'own', status: 'active', users: 1, products: 8 },
      { id: 'v3', name: 'Moradabad Brass', accessLevel: 'vendor-stock', shippingMode: 'to-store', labelAccount: 'store', status: 'suspended', users: 1, products: 3 },
    ]
  : []

/** Everything the Settings tabs read. */
export interface SettingsReads {
  storeInfo: () => Promise<StoreInfo | null>
  locale: () => Promise<StoreLocale | null>
  people: () => Promise<Person[]>
  suppliers: () => Promise<Supplier[]>
  approval: () => Promise<boolean>
  tax: () => Promise<TaxSetupFull | null>
  invoice: () => Promise<InvoiceSettings | null>
  markets: () => Promise<Market[]>
}

const market = (m: Partial<Market> & Pick<Market, 'id' | 'name' | 'countries' | 'currency'>): Market => ({
  parentId: null,
  primary: false,
  everywhereElse: false,
  active: true,
  language: 'en-IN',
  priceAdjustmentBps: 0,
  webMode: 'main',
  pathPrefix: null,
  products: 'all',
  excludedProductIds: [],
  excludedProducts: [],
  duties: { mode: 'none', rateBps: null, thresholdAmount: null },
  revision: 1,
  ...m,
})

const sampleMarkets: Market[] = harness
  ? [
      market({ id: 'mk-in', name: 'India', countries: ['IN'], currency: 'INR', primary: true }),
      market({ id: 'mk-us', name: 'United States', countries: ['US'], currency: 'USD', language: 'en-US', priceAdjustmentBps: 1000, webMode: 'path', pathPrefix: 'us', everywhereElse: true, duties: { mode: 'by_code', rateBps: null, thresholdAmount: '80000' } }),
      market({ id: 'mk-ae', name: 'UAE', countries: ['AE'], currency: 'AED', active: false }),
    ]
  : []

const sampleTax: TaxSetupFull | null = harness
  ? {
      pricesIncludeTax: true,
      classes: [
        { id: 't5', name: 'Clothing under ₹1,000', isDefault: false, taxCode: null, versions: 12 },
        { id: 't12', name: 'Clothing', isDefault: true, taxCode: null, versions: 41 },
        { id: 't18', name: 'Home décor', isDefault: false, taxCode: null, versions: 9 },
      ],
      zones: [
        { id: 'z-in', name: 'India', countries: ['IN'], regions: [], rates: [{ taxClassId: 't5', rateBps: 500 }, { taxClassId: 't12', rateBps: 1200 }, { taxClassId: 't18', rateBps: 1800 }] },
        { id: 'z-ae', name: 'UAE', countries: ['AE'], regions: [], rates: [{ taxClassId: 't12', rateBps: 500 }] },
      ],
    }
  : null

/** The tabs' reads under ?state=: the samples above. */
export const sampleReads: SettingsReads = {
  storeInfo: async () => sampleInfo,
  locale: async () => sampleLocale,
  people: async () => samplePeople,
  suppliers: async () => sampleSuppliers,
  approval: async () => true,
  tax: async () => sampleTax,
  invoice: async () => ({ taxPerLine: true, emailWithDispatch: true, footer: null, legalName: 'Kesari Threads Pvt Ltd' }),
  markets: async () => sampleMarkets,
}
