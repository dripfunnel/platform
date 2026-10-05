import type { StoreInfo, StoreLocale } from '../../api/settings'

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
      examples: [
        { currency: 'USD', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
        { currency: 'AED', from: { amount: '10000', currency: 'INR' }, none: { amount: '400' }, nearest: { amount: '400' }, ends99: { amount: '499' } },
      ],
    }
  : null
