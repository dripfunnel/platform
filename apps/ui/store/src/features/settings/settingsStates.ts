import type { StoreInfo, StoreLocale } from '../../api/settings'
import type { Person, Supplier } from '../../api/team'

// Settings' states under ?state= (ui/README.md §6): loading, error, ready, readOnly (a store past due: look only)
// and denied (anyone but the Owner).
export const settingsStates = ['loading', 'error', 'ready', 'readOnly', 'denied'] as const

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
}

/** The tabs' reads under ?state=: the samples above. */
export const sampleReads: SettingsReads = {
  storeInfo: async () => sampleInfo,
  locale: async () => sampleLocale,
  people: async () => samplePeople,
  suppliers: async () => sampleSuppliers,
  approval: async () => true,
}
