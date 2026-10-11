import type { StorefrontBrand, StorefrontSeo } from '../../api/storefront'

// Storefront's states under ?state= (ui/README.md §6): loading, error, denied (Staff), brand (the Owner's first visit),
// list (the brand saved), and manager and readOnly (past due), which look only.
export const storefrontStates = ['loading', 'error', 'denied', 'brand', 'list', 'manager', 'readOnly'] as const
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
