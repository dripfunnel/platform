import type { StorefrontBrand, StorefrontDomains, StorefrontSeo } from '../../api/storefront'

// Storefront's states under ?state= (ui/README.md §6): loading, error, denied (Staff), brand (the Owner's first visit),
// list (brand saved, own domain live), manager and readOnly (past due) look only, waiting and failed (an own domain on its
// way or refused by DNS), and free (a plan without an own domain).
export const storefrontStates = ['loading', 'error', 'denied', 'brand', 'list', 'manager', 'readOnly', 'waiting', 'failed', 'free'] as const
export type StorefrontState = (typeof storefrontStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const savedBrand: StorefrontBrand | null = harness
  ? {
      brandReady: true,
      shopName: 'Kesari Threads',
      logoAssetId: 'sample-logo',
      faviconAssetId: null,
      primaryColour: '#b8541f',
      secondaryColour: '#0a2a4a',
      tagline: 'Handloom from Jaipur',
      description: 'Block-printed clothing and homeware, made by hand in Jaipur and made to last.',
      social: { instagram: 'https://www.instagram.com/kesarithreads', facebook: null, x: null, youtube: null, tiktok: null, whatsapp: 'https://wa.me/919829012345' },
      contactEmail: 'hello@kesarithreads.in',
      contactPhone: '+91 98290 12345',
      contactAddress: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
      voice: 'Warm and friendly',
    }
  : null

/** The first visit: Store info's name and contact, nothing of the brand's own yet. */
export const sampleBrand = (state: StorefrontState): StorefrontBrand | null =>
  savedBrand && state === 'brand'
    ? { ...savedBrand, brandReady: false, logoAssetId: null, primaryColour: null, secondaryColour: null, tagline: null, description: null, voice: null, social: { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null } }
    : savedBrand

export const sampleSeo = (state: StorefrontState): StorefrontSeo =>
  state === 'brand' || !harness
    ? { title: null, description: null, shareImageAssetId: null }
    : { title: 'Kesari Threads — Everyday clothes and homeware, made to last', description: 'Everyday clothes and homeware, made to last. Free returns within 30 days.', shareImageAssetId: 'sample-photo-1' }

const free = { id: null, host: 'kesari-threads.shops.dripfunnel.com', kind: 'free' as const, checkedAt: null, records: [] }
const own = { id: 'sample-own', host: 'www.kesarithreads.in', kind: 'custom' as const }
const records = (found: string | null) => [
  { type: 'CNAME', name: 'www.kesarithreads.in', value: 'shops.edge.dripfunnel.com', found },
  { type: 'TXT', name: '_df-verify.www.kesarithreads.in', value: 'df-verify=3f9c2a71', found: null },
]

export const sampleDomains = (state: StorefrontState): StorefrontDomains => {
  if (!harness || state === 'brand' || state === 'free') return { customDomainAllowed: state !== 'free', domains: harness ? [{ ...free, status: 'live', primary: true }] : [] }
  const checkedAt = '2026-10-12T08:40:00Z'
  if (state === 'waiting') return { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }, { ...own, status: 'waiting', primary: false, checkedAt, records: records(null) }] }
  if (state === 'failed') return { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }, { ...own, status: 'failed', primary: false, checkedAt, records: records('kesarithreads.wixdns.net') }] }
  return { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: false }, { ...own, status: 'live', primary: true, checkedAt, records: records('shops.edge.dripfunnel.com') }] }
}
