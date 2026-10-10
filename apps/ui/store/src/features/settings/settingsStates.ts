import type { CustomerAccounts } from '../../api/customerAccounts'
import type { ApiKey, ApiKeyChoices, WebhookDelivery, WebhookEndpoint } from '../../api/developers'
import type { Gateway } from '../../api/payments'
import type { ShippingSettings } from '../../api/shipping'
import type { StoreInfo, StoreLocale } from '../../api/settings'
import type { Market } from '../../api/markets'
import type { ProductBasics } from '../../api/productEditor'
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
  catalogue: () => Promise<ProductBasics>
  gateways: () => Promise<Gateway[]>
  shipping: () => Promise<ShippingSettings>
  customerAccounts: () => Promise<CustomerAccounts>
  apiKeys: () => Promise<ApiKey[]>
  apiKeyChoices: () => Promise<ApiKeyChoices>
  webhooks: () => Promise<WebhookEndpoint[]>
  webhookEvents: () => Promise<string[]>
  deliveries: (endpointId: string) => Promise<WebhookDelivery[]>
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

const gateway = (g: Pick<Gateway, 'provider' | 'label' | 'kind'> & Partial<Gateway>): Gateway => ({ live: false, bankDetails: null, connectable: true, connections: [], ...g })

const sampleGateways: Gateway[] = harness
  ? [
      gateway({ provider: 'razorpay', label: 'Razorpay', kind: 'gateway', live: true, connections: [{ mode: 'live', live: true, webhookUrl: 'https://hooks.dripfunnel.com/payments/razorpay/3f2a9c' }] }),
      gateway({ provider: 'cashfree', label: 'Cashfree', kind: 'gateway', connections: [{ mode: 'test', live: true, webhookUrl: null }] }),
      gateway({ provider: 'phonepe', label: 'PhonePe', kind: 'gateway', connectable: false }),
      gateway({ provider: 'cod', label: 'Cash on delivery', kind: 'other', live: true, connections: [{ mode: 'live', live: true, webhookUrl: null }] }),
      gateway({ provider: 'bank_transfer', label: 'Bank transfer', kind: 'other' }),
    ]
  : []

const sampleShipping: ShippingSettings = {
  revision: 3,
  savedAt: '2026-10-01T09:00:00Z',
  currency: 'INR',
  courierRate: true,
  flatRate: false,
  flatAmount: '9900',
  pickup: true,
  pickupHours: 'Mon–Sat, 10 am – 6 pm',
  pickupAddress: '14 Johari Bazaar, Jaipur',
  freeMode: 'over',
  freeThresholdAmount: '99900',
  areaMode: 'everywhere',
  areaFileName: null,
  areaCount: 0,
  areaSample: [],
  labelSizes: ['a6', 'a4'],
  couriers: [{ provider: 'shiprocket', status: 'pricing', offered: true, pickupMode: 'scheduled', labelSize: 'a6', trackingEmails: true, lastTestedAt: '2026-10-09T08:30:00Z', lastTestResult: 'ok' }],
}

const sampleKeys: ApiKey[] = harness
  ? [
      { id: 'k1', name: 'Warehouse stock sync', prefix: 'dfk_7Hq2LmX9', scopes: ['catalog.read', 'stock.read'], supplier: null, createdByName: 'Farhan Ali', createdByHere: true, createdAt: '2026-10-01T18:05:00Z', expiresAt: '2027-01-01T18:05:00Z', lastUsedAt: '2026-10-11T09:30:00Z', previousWorksUntil: null },
      { id: 'k2', name: 'Northwind feed', prefix: 'dfk_Pz81QwE3', scopes: ['catalog.read'], supplier: { id: 'v1', name: 'Northwind Textiles' }, createdByName: 'Meera Joshi', createdByHere: false, createdAt: '2026-08-12T10:00:00Z', expiresAt: '2026-10-14T10:00:00Z', lastUsedAt: null, previousWorksUntil: null },
      { id: 'k3', name: 'Accounts export', prefix: 'dfk_Ab4CdEf5', scopes: ['orders.read', 'customers.read'], supplier: null, createdByName: 'Farhan Ali', createdByHere: true, createdAt: '2026-06-02T08:00:00Z', expiresAt: null, lastUsedAt: '2026-10-10T02:00:00Z', previousWorksUntil: '2026-10-12T08:00:00Z' },
    ]
  : []

const sampleHooks: WebhookEndpoint[] = harness
  ? [
      { id: 'h1', url: 'https://erp.kesarithreads.in/hooks/dripfunnel', events: ['order.placed', 'order.paid', 'order.shipped'], status: 'active', failingSince: null, disabledAt: null, createdAt: '2026-09-01T09:00:00Z' },
      { id: 'h2', url: 'https://old-crm.example.com/events', events: ['order.placed'], status: 'disabled', failingSince: '2026-09-30T09:12:00Z', disabledAt: '2026-10-03T09:12:00Z', createdAt: '2026-07-01T09:00:00Z' },
    ]
  : []

const delivery = (d: Pick<WebhookDelivery, 'id' | 'event' | 'status' | 'createdAt'> & Partial<WebhookDelivery>): WebhookDelivery => ({ attempts: 1, responseCode: null, error: null, durationMs: null, ...d })

const sampleDeliveries = (endpointId: string): WebhookDelivery[] =>
  endpointId === 'h2'
    ? [
        delivery({ id: 'd4', event: 'order.placed', status: 'held', createdAt: '2026-10-05T11:00:00Z' }),
        delivery({ id: 'd5', event: 'order.placed', status: 'failed', error: 'status', responseCode: 500, durationMs: 1200, attempts: 8, createdAt: '2026-10-03T09:12:00Z' }),
        delivery({ id: 'd6', event: 'order.placed', status: 'failed', error: 'timeout', durationMs: 5000, attempts: 8, createdAt: '2026-10-02T18:03:00Z' }),
      ]
    : [
        delivery({ id: 'd1', event: 'order.placed', status: 'delivered', responseCode: 200, durationMs: 182, createdAt: '2026-10-11T10:44:00Z' }),
        delivery({ id: 'd2', event: 'order.paid', status: 'delivered', responseCode: 200, durationMs: 164, createdAt: '2026-10-11T10:44:30Z' }),
        delivery({ id: 'd3', event: 'order.shipped', status: 'delivered', responseCode: 200, durationMs: 201, createdAt: '2026-10-11T09:02:00Z' }),
      ]

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
  gateways: async () => sampleGateways,
  shipping: async () => sampleShipping,
  customerAccounts: async () => ({ mode: 'both', customers: 1284, withEmail: 812, withPhone: 686, phoneOnly: 214 }),
  apiKeys: async () => sampleKeys,
  apiKeyChoices: async () => ({ scopes: ['catalog.read', 'stock.read', 'orders.read', 'customers.read'], expiresInDays: [30, 90, 365], requestsPerMinute: 60, requestsPerMonth: 100000 }),
  webhooks: async () => sampleHooks,
  webhookEvents: async () => ['order.placed', 'order.paid', 'order.shipped', 'order.refunded', 'product.updated', 'stock.changed'],
  deliveries: async (endpointId) => sampleDeliveries(endpointId),
  catalogue: async () => ({
    pricingCurrency: 'INR',
    unitSystem: 'metric',
    mainLanguage: 'en-IN',
    translationLanguages: [],
    features: ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video'].map((key) => ({ key, enabled: ['sizeCharts', 'specs', 'highlights', 'badges'].includes(key), inPlan: key !== 'video' })),
    badges: [
      { id: 'b-new', label: 'New', rule: 'new_30_days', tone: 'ok', position: 0 },
      { id: 'b-handmade', label: 'Handmade', rule: 'manual', tone: 'neutral', position: 1 },
    ],
  }),
}
